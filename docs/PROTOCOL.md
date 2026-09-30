# Thunderbird AI Bridge protocol

This document describes the localhost transport expected by the Thunderbird extension in the current `0.9.21` implementation.

## Transport

Default host:

```text
http://127.0.0.1:47831
```

The extension is the polling side. The host process owns a small request queue and file-transfer storage.

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

### Mutating operations

- `create_folder`
- `rename_folder`
- `delete_folder`
- `compact_folder`
- `import_msg`
- `move`
- `trash`
- `restore`
- `empty_trash`
- `purge`
- `delete_permanently`

Mutating operations require the JSON boolean `confirm: true`. Strings such as `"true"` or `"false"`, numbers and other truthy values are rejected.

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
- `limit`

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

Long messages can be paged using `nextStartChar` returned by the previous call. Reading through this operation does not intentionally change the Thunderbird read/unread state.

## Attachments

Use `attachments` to list metadata. Then use `get_attachment` with `message_id` and either `part_name` or an unambiguous `attachment_name`.

The extension uploads the attachment to `/attachment-file` and returns a `transferId` plus metadata. What happens next is host-specific: a vision model may inspect an image, a document pipeline may parse a PDF, or a CLI may simply save the file.

## Folder operations

`create_folder`, `rename_folder` and `delete_folder` use Thunderbird APIs plus a native experiment layer for IMAP cases where Thunderbird's high-level extension API needs explicit refresh/verification.

System/root folders are protected from rename/delete actions.

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
be exceeded, a new request is left unadmitted and unexecuted, with no result
posted; its caller may time out. Sending a terminal rejection without remembering
its ID would be unsafe, because a later same-ID arrival could execute after that
rejection. A never-admitted ID has no completed operation to replay and may be
admitted later. Polling continues so retained IDs can still recover at capacity. Results exceeding the
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
