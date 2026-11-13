# Thunderbird AI Bridge protocol

This document describes the localhost transport expected by the Thunderbird extension in the current `0.9.32` implementation.

## Transport

Default host:

```text
http://127.0.0.1:47831
```

The extension is the polling side. The host process owns a small request queue and file-transfer storage.

### Host requirements (CORS and long-poll)

The extension runs in Thunderbird's background page, so every host endpoint is a cross-origin request. A host **MUST**:

- send `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS` and `Access-Control-Allow-Headers: Content-Type` on every response (including errors), and
- answer an `OPTIONS` preflight with `204 No Content` and the same headers.

Without these headers Thunderbird rejects the response and the bridge looks disconnected.

`/poll` **SHOULD** be a long-poll: keep the request open (SuperCLI uses 20 s) until a request is queued, then answer immediately. The extension polls again right after each answer. Since 0.9.32 it waits 250 ms after a `204` before polling again, so a host that answers `204` immediately does not cause a busy loop, but a new request may then wait up to 250 ms before Thunderbird sees it. After a network error the extension waits 1 s.

### `GET /poll?token=...`

Returns the next queued request as JSON, or HTTP `204 No Content` when no request is waiting.

Request envelope:

```json
{
  "id": "req-123",
  "op": "search",
  "args": {
    "subject": "invoice",
    "limit": 20
  }
}
```

`id` must uniquely identify the request until its result has been received.

### `POST /result?token=...`

The extension posts the completed result as JSON.

Success:

```json
{
  "id": "req-123",
  "ok": true,
  "data": {}
}
```

Failure:

```json
{
  "id": "req-123",
  "ok": false,
  "error": "Human-readable error"
}
```

### `POST /attachment-file?...`

Used by `get_attachment`. The extension uploads raw attachment bytes to the host.

Query parameters:

- `token`
- `id` — transfer identifier
- `filename`
- `content_type`

The body contains the raw file.

### `GET /message-file?token=...&id=...`

Used by `import_msg`. The host returns a previously prepared RFC 822 / `.eml` payload. A host may, for example, convert an Outlook `.msg` file before queueing the Thunderbird import operation.

## Authentication token

The current source contains a static compatibility token inherited from the original local SuperCLI implementation. It prevents accidental cross-talk between unrelated localhost services, but **it should not be treated as strong authentication**.

Keep the host bound to loopback. Endpoint/token configuration and generated per-install secrets are planned improvements before a stable `1.0` protocol.

## Operations

### Read-only operations

- `status`
- `accounts`
- `folders`
- `senders`
- `count`
- `search`
- `read`
- `attachments`
- `get_attachment`
- `largest`
- `address_books`
- `contacts`
- `contact_candidates`

### Mutating operations

- `create_folder`
- `rename_folder`
- `delete_folder`
- `compact_folder`
- `create_address_book`
- `add_contacts`
- `update_contact`
- `import_msg`
- `move`
- `copy`
- `trash`
- `restore`
- `empty_trash`
- `purge`
- `delete_permanently`

Mutating operations require the JSON boolean `confirm: true`. Strings such as `"true"` or `"false"`, numbers and other truthy values are rejected.

### Address books and contacts

`address_books` and `contacts` inspect Thunderbird's current address books. `contact_candidates` scans only message headers and aggregates sender/recipient addresses, excluding the selected mailbox owner's own address.

`create_address_book` creates a separate local book after `confirm:true`. `add_contacts` accepts up to 200 explicit `{name,email}` objects after `confirm:true`, skips invalid addresses and deduplicates email addresses within the selected destination book. This keeps retries safe while allowing a dedicated book to contain an address already present elsewhere. `update_contact` corrects the name or email of an exact `contact_id` after `confirm:true`. Hosts should filter automated, newsletter, store and `noreply` candidates before import.

## Common search arguments

Depending on the operation, the bridge accepts:

- `account` / `accountId`
- `folder`
- `scope` — normally `inbox` or `account`
- `includeSubFolders`
- `from` / `author`
- `to` / `recipient`
- `address` — searches both sender and recipient sides
- `subject`
- `fullText` / `text`
- `since` — `YYYY-MM-DD`
- `until` — `YYYY-MM-DD`
- `limit` — `search` returns 1–100 results (default 20)
- `include_attachments` — `search` only, JSON boolean, default `false` (see Attachments)
- `header_message_id` — one exact RFC `Message-ID` (angle brackets optional)
- `header_message_ids` — mutations only: up to 100 exact `Message-ID` values, selected in one local header scan; any missing value aborts without changes
- `message_ids` — mutations only: up to 100 exact numeric Thunderbird message IDs (from `search`); every ID must still be in the selected source folder or the operation aborts without changes. Use this when Gmail holds several records with one `Message-ID`.
- `local_backup_verified` — `trash` only: JSON `true` together with exact `message_ids`/`header_message_ids` and no other filters allows a Gmail All Mail cleanup after the host has verified a local backup. Every selected `Message-ID` must resolve to exactly one message.
- `allow_other_labels` — `move` only, see Gmail label safety

Example:

```json
{
  "id": "req-search-1",
  "op": "search",
  "args": {
    "scope": "account",
    "address": "person@example.com",
    "subject": "project",
    "since": "2026-01-01",
    "limit": 25
  }
}
```

Account and folder selectors must be unambiguous. Automatic Inbox/Trash resolution also rejects multiple special-use matches or ambiguous fallback names. Exact account/folder IDs take precedence over display names; exact folder paths take precedence over name matching. If multiple accounts or folders match a friendly name, use an ID from `accounts`/`folders` or an exact full folder path. A missing Inbox is an error, not an implicit account-wide search; use `scope: "account"` explicitly for account-wide reads.

`address` performs a sender-or-recipient search and overrides `from`/`author` and `to`/`recipient`. Other filters (subject, text and dates) still apply. The same matching semantics apply to bulk mutations.

**Domain filters.** `from`, `to` and `address` accept a domain. `@example.com` matches only mailboxes at `example.com` or a subdomain (`mail.example.com`), case-insensitively. A bare `example.com` matches the same mailboxes and also a display name containing that text. `notexample.com` and `example.com.evil.org` do not match. The extension matches domains against the parsed mailbox (`to` covers To and Cc), because Thunderbird's own query only matches full addresses or names. This applies to `search`, `count`, `senders`, `largest`, `contact_candidates` and bulk mutation selection (`move`, `copy`, `trash`, `restore`, `purge`). A domain filter scans all headers in the selected folder, so keep the default Inbox scope or add dates where possible.

**Ordering.** `search` results are always newest-first (message date descending, then Thunderbird ID descending), for plain, `address` and domain searches alike. A limited search scans all matching headers and returns the newest `limit`. Bulk mutations select batches in Thunderbird's folder order.

**Account selection.** When `account` is omitted:

1. a folder ID such as `account2://INBOX` selects its own account;
2. with more than one mail account (Local Folders excluded), a friendly folder name that exists on several accounts is an error (`Folder "Inbox" istnieje na kilku kontach ...`); a name found on exactly one account selects that account;
3. otherwise the first IMAP account is used, as before.

Account names match exactly (case-insensitive) first, then by substring; several substring matches are an error.

## Reading a message

First obtain `message.id` from `search`, then call:

```json
{
  "id": "req-read-1",
  "op": "read",
  "args": {
    "message_id": 123,
    "max_chars": 12000,
    "start_char": 0
  }
}
```

Long messages can be paged using `nextStartChar` returned by the previous call. Reading through this operation does not intentionally change the Thunderbird read/unread state. `read` always includes attachment metadata (`hasAttachments`, `attachmentCount`, `attachments`).

## Attachments

Since 0.9.32 `search` does **not** list attachments by default: that costs one MIME parse per result (100 results took 20–27 s). The response has `attachmentsIncluded: false`, and its messages have no `hasAttachments`/`attachmentCount`/`attachments` fields. Pass `include_attachments: true` to get those fields (listed with at most 6 concurrent calls), or call `attachments`/`read` for one message.

Use `attachments` to list metadata. Then use `get_attachment` with `message_id` and either `part_name` or an unambiguous `attachment_name`.

The extension uploads the attachment to `/attachment-file` and returns a `transferId` plus metadata. What happens next is host-specific: a vision model may inspect an image, a document pipeline may parse a PDF, or a CLI may simply save the file.

## Folder operations

`create_folder`, `rename_folder` and `delete_folder` use Thunderbird APIs plus a native experiment layer for IMAP cases where Thunderbird's high-level extension API needs explicit refresh/verification.

System/root folders are protected from rename/delete actions.

`folders` returns `totalMessageCount` and `unreadMessageCount` for each folder from `messenger.folders.getFolderInfo`, plus `folderInfoAvailable`. Counts are `null` when the API is missing or one folder cannot be read; the listing itself does not fail.

`delete_folder` returns `deleted: true, movedToTrash: false` when the folder is gone. On Local Folders (and servers that behave the same way) Thunderbird moves the folder into Trash instead; the result is then `deleted: false, movedToTrash: true` with `newPath` and `trashedFolder`.

`largest` on a Gmail account counts each `Message-ID` once (a labelled copy is preferred over All Mail) and returns `deduplicatedByMessageId: true` and `duplicatesSkipped`. Other servers keep real duplicate copies.

`compact_folder` requires `folder` and `confirm: true`. It invokes Thunderbird's native compaction for one folder, skips work when Thunderbird reports no expunged bytes, and returns `beforeBytes`, `afterBytes`, `reclaimedBytes`, `beforeExpungedBytes`, `afterExpungedBytes`, `skipped` and `messagesChanged: false`. It is intended as occasional maintenance after a cleanup, not after every mutation batch.

## Bulk message operations

`move`, `trash`, `restore` and permanent deletion operate in bounded batches. Large jobs may return:

```json
{
  "more": true,
  "continuation": "..."
}
```

The host should send the returned continuation token with the same operation and filters to process the next batch. Continuation tokens expire and are tied to the operation, account, source, resolved destination ID (including default Trash/Inbox destinations), supplied destination selector, sender, recipient, address, subject, text, dates and subfolder scope to reduce accidental filter changes during a destructive job. A mismatched request is rejected without consuming its valid token. Bulk filters may use `from`/`author`, `to`/`recipient`, `address`, `subject`, `fullText`/`text`, `since` or `until`.

`dry_run: true` can be used by supported bulk operations to inspect how many messages would be affected before performing the mutation.

### Move verification

`move` uses Thunderbird's `messages.move` (IMAP `MOVE` where the server supports it, otherwise Thunderbird's own copy/expunge). The bridge does not copy and delete on its own: on Gmail a delete from Inbox goes to Trash and removes every label. After moving, the extension:

1. checks that each moved `Message-ID` is in the destination and that the original IDs left the source (up to 15 s);
2. waits a settle window (10 s on Gmail, 5 s on other IMAP, none for Local Folders), asks Thunderbird to refresh both folders from the server (`mailbridge.refreshFolder`, skipped if unavailable) and checks again.

The result includes `verified`, `immediateVerified`, `destinationVerified`, `sourceVerified`, `settleMs`, `refreshed`, `movedButUnverified`, `missingInDestination` (up to 20 Message-IDs), `destinationDuplicates`, `status` (`verified_moved` or `moved_but_unverified`) and `warning`. On Gmail, a destination label that already held the message only has to contain it; elsewhere each moved message must add a copy. An unverified batch returns no `continuation` even when `more: true`; check the destination and All Mail before continuing. Gmail can still drop a label later than the settle window, so hosts that need certainty should re-check with `search` after a few minutes.

### Gmail label safety

On Gmail a label folder is a view of one message. `trash` or `move` from a label other than Inbox, Trash, Spam or All Mail is rejected without changes (also for `dry_run`) when any selected `Message-ID` also exists in Inbox or another label, because trashing it would remove it from there too. Messages without a `Message-ID` are rejected for the same reason. Run the operation from Inbox, or select messages that only carry that label. For `move`, `allow_other_labels: true` accepts removing just the source label. Gmail All Mail sources keep their separate protection.

## Permanent deletion

Permanent deletion is deliberately restricted to Thunderbird's default Trash folder. On IMAP accounts the bridge uses Thunderbird's native compact/EXPUNGE behavior and verifies mailbox state before reporting final success where possible.

`empty_trash` uses Thunderbird's native server-side Empty Trash operation. If messages remain after refresh, it returns `serverVerified: false` and `status: "verification_failed"`.

A purge whose native compaction was skipped cannot confirm server EXPUNGE: it returns `serverVerified: false`, `pendingExpunge: true` and, when matching messages are locally gone, `status: "server_expunge_not_confirmed"`. A refresh error also leaves `pendingExpunge: true`. Hosts must inspect verification/status fields rather than treating transport `ok: true` as proof of permanent deletion.

## Host implementation guidance

A minimal host needs four pieces:

1. a queue for bridge requests,
2. `/poll` to give requests to Thunderbird,
3. `/result` to receive responses,
4. temporary file storage for attachment/message transfer if those features are used.

The host is free to expose any interface on its other side: CLI commands, MCP tools, model function calling, a desktop app, REST, or something else entirely.

## Compatibility

The protocol is experimental until `1.0`. If you build another host implementation, pin the extension version and expect small field/operation changes while the API is being cleaned up.

## Result delivery and uncertain outcomes

### Operation timeouts

The extension limits how long it waits for one operation: 120 s for reads, 10 minutes for mutations, 20 minutes for `compact_folder` and `empty_trash`. A timeout cannot stop Thunderbird's own work. A timed-out mutation returns `ok: false` with an error containing `outcome unknown` (it may have executed or still be running; do not retry automatically). A timed-out read says nothing changed. The extension logs a `console.warn` with the operation name and continues with the next request, so a later operation may run while a timed-out one is still finishing. Hosts usually time out earlier (SuperCLI: 20–120 s) and must treat that as outcome unknown too.

### Delivery

Execution and delivery are separate. The extension serializes the operation result
once, then retries only `POST /result` (up to three attempts, five-second HTTP
timeout, 250 ms then 1 s delays). A network error or lost acknowledgement never
turns successful execution into an operation-failed payload. HTTP 4xx except
408/429 stops delivery retries. Unacknowledged results remain available for a
same-ID redelivery, but there is no automatic re-execution or indefinite HTTP
retry loop.

A request ID identifies one operation. For admitted requests, while retained, duplicate IDs queued,
executing, or completed never execute again; a completed duplicate replays the
identical serialized result. Changing arguments under an existing ID does not
change that operation. A genuinely new ID is a new operation even with identical
arguments. Hosts must never generate a new ID as an automatic retry of an
uncertain mutation.

The process-local recovery cache holds at most 128 IDs and 8 MiB of UTF-8 result
payloads, reserving 4 MiB per admitted pending request. When either bound would
be exceeded, a new request is not executed and the host receives an explicit
error: `{"id": ..., "ok": false, "notExecuted": true, "error": "... NOT executed ..."}`.
The rejected ID is remembered (up to 256 IDs for ten minutes) and a same-ID
re-arrival receives the same rejection, so it can never execute after the host
accepted the failure. Hosts should retry later with a new ID. Beyond 256
retained rejections a request is dropped without a result, as before, and its
caller times out. Polling continues so retained IDs can still recover at capacity. Results exceeding the
4 MiB host transport limit, or failing serialization, produce an explicit
outcome-unknown response; the operation may already have executed. Temporary
serialization buffers and request arguments are not included in this result-byte
budget. No mailbox payloads or recovery records are persisted to disk.

Acknowledged entries expire five minutes after their first acknowledgement.
Unacknowledged entries do not expire or get evicted to admit new work; a full
cache applies backpressure. A permanently unavailable original host can therefore
leave unresolved entries until extension restart. Restart clears recovery state,
so reconcile mailbox state before repeating uncertain mutations. The endpoint
and token are immutable constants for the background process, not runtime
settings; recovery payloads are sent only to that original configured endpoint.
This is not durable exactly-once execution: restart/crash, retention expiry,
and genuinely new IDs are outside the deduplication guarantee.

SuperCLI's host acknowledges an identical repeated result for a recently completed
ID (up to 256 SHA-256 digests, five-minute window). A conflicting result receives
409 and an unknown/expired ID receives 404. A late result after the caller has
timed out may therefore be unacknowledged. The host removes cancelled queued
requests before dispatch; after dispatch a timeout/cancellation is reported as
outcome unknown with the request ID and a warning against automatic mutation
retries. An HTTP acknowledgement means the host accepted the result, not that a
caller definitely displayed it. Neither host nor extension can infer that a
mailbox operation failed just because its caller stopped waiting.
