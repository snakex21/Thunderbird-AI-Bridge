# Thunderbird AI Bridge protocol

This document describes protocol 2 (`tb-bridge/2`), implemented by the extension since `0.10.0`. Protocol 1 (a constant token in the URL, CORS `*`) is gone: any local process knew the token, so any program that took the port could drive the mailbox. A protocol 2 extension never talks to a protocol 1 host, and a protocol 2 host answers protocol 1 requests with `426 Upgrade Required`.

## Transport

```text
http://127.0.0.1:47831
```

The extension is the polling side. The host owns a request queue and file-transfer storage. Only a host that the user paired with this Thunderbird profile, and that proves it on every connection, receives polls or results.

### Host requirements

A host **MUST**:

- listen on `127.0.0.1` only;
- refuse a request whose `Host` header is not exactly the bridge address (`127.0.0.1:47831`), so DNS-rebinding pages cannot reach it (SuperCli answers `421`);
- refuse every request that carries a web `Origin` (`http:`, `https:`, `file:`, `null`, another browser's extension scheme) with `403` and without CORS headers. Requests without `Origin` (non-browser clients) still have to authenticate;
- never send `Access-Control-Allow-Origin: *`. For `/v2/hello`, `/v2/pair/*` and `/v2/auth` it may echo any `moz-extension://` origin (so an unpaired or outdated extension can read why it was refused); for every other endpoint it echoes only the exact origin recorded at pairing. With the echoed origin send `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, X-TB-Session, X-TB-Ts, X-TB-Nonce, X-TB-Mac`, `Access-Control-Expose-Headers: X-TB-Ts, X-TB-Mac` and `Vary: Origin`, and answer `OPTIONS` with `204`;
- keep the pairing secret out of URLs and logs, and store it protected (SuperCli: DPAPI for the current Windows user, file restricted to that account).

A host that is not paired and has no active pairing code **SHOULD NOT** listen at all, so a second copy of the host cannot shadow the paired one. A host that cannot bind the port must not take over in any other way; SuperCli reports which instance holds it (from `/v2/hello`).

### Encoding

All binary values are unpadded base64url. A *MAC* is HMAC-SHA256 over its fields joined with `\n`, sent as base64url. A *body hash* is the base64url SHA-256 of the exact body bytes (the empty string for no body). MACs are compared in constant time.

## Pairing

The host shows a one-time code of 16 characters from the Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, displayed as `XXXX-XXXX-XXXX-XXXX` (80 bits). It is valid for 5 minutes and for 5 wrong attempts; afterwards the host closes the window. The user types it into the extension's options page. Input is normalized: upper case, spaces and dashes removed, `O`→`0`, `I`/`L`→`1`.

```text
codeKey    = SHA-256("tb-bridge/2 pairing code\n" + normalizedCode)
transcript = b64u(SHA-256("tb-bridge/2 pair\n" + hostId + "\n" + extPub + "\n" + hostPub + "\n" + extNonce + "\n" + hostNonce))
K          = HKDF-SHA256(ikm = ECDH-P256(shared x), salt = codeKey, info = "tb-bridge/2 pairing key\n" + transcript, 32 bytes)
```

1. `GET /v2/hello` → `{ proto: 2, hostId, app, appVersion, pid, paired, challenge? }`. `hostId` is a stable random identifier of the host installation (not secret).
2. `POST /v2/pair/start` `{ proto: 2, extPub, extNonce, extVersion, mac: MAC(codeKey, "pair-start", extPub, extNonce) }` where `extPub` is the extension's ephemeral uncompressed P-256 public key and `extNonce` 32 random bytes. The host checks the MAC (a wrong code counts as an attempt), generates its own ephemeral key and nonce and answers `{ proto, hostId, hostPub, hostNonce, app, appVersion, mac: MAC(K, "pair-host", transcript) }`.
3. The extension derives `K`, verifies the host MAC (proves the host knows the code and took part in the ECDH) and sends `POST /v2/pair/finish` `{ hostId, mac: MAC(K, "pair-ext", transcript) }`.
4. The host verifies it, stores `K` with a new `pairingId`, the request's `Origin` and the extension version, discards every earlier pairing and session, closes the window and answers `{ ok: true, pairingId, mac: MAC(K, "pair-done", transcript, pairingId) }`. The extension verifies this MAC before storing `{ hostId → pairingId, K }`.

Neither the code nor `K` ever appears in a URL. An observer of the pairing traffic who later learns the code still cannot compute `K` (ECDH). A host keeps **one** pairing: two Thunderbird profiles polling one queue would let a request run in whichever mailbox answered first. An extension may keep pairings with several hosts (keyed by `hostId`) and uses the one matching the host currently on the port.

Errors use `{ ok: false, error, message }` with `error` one of `pairing_not_active`, `pairing_code_invalid`, `pairing_failed`, `rate_limited`, `bad_request`.

## Connection: mutual authentication

1. `GET /v2/hello`. A paired host includes a fresh single-use `challenge` (32 random bytes, valid 30 s). If `hostId` matches no stored pairing the extension stops: **nothing is sent to that host**. A `404` means a host without protocol 2 (outdated); the extension stops too.
2. `POST /v2/auth` `{ hostId, pairingId, hostNonce: challenge, extNonce, extVersion, mac: MAC(K, "auth-ext", hostId, pairingId, challenge, extNonce) }`.
3. The host consumes the challenge, checks the pairing id, the origin and the MAC, and answers `{ ok: true, sessionId, idleTimeoutMs, mac: MAC(K, "auth-host", hostId, pairingId, challenge, extNonce, sessionId) }`.
4. The extension verifies the host MAC. **Only then** does it poll. A host on the port that copied `hostId` but does not know `K` fails here and gets no poll and no result.

```text
sessionKey = HMAC-SHA256(K, "session\n" + challenge + "\n" + extNonce + "\n" + sessionId)
```

Refusals: `401` with `error` `not_paired`, `wrong_host`, `pairing_revoked` (the host was unpaired or paired again: pair again), `challenge_invalid`, `origin_mismatch`, `bad_proof`; `429 rate_limited` after many failures. Sessions expire after 10 minutes without a signed request.

## Signed requests and responses

Every request after authentication carries:

```text
X-TB-Session: sessionId
X-TB-Ts:      milliseconds since the Unix epoch
X-TB-Nonce:   16 random bytes (base64url)
X-TB-Mac:     MAC(sessionKey, "req", METHOD, pathAndQuery, ts, nonce, bodyHash)
```

`pathAndQuery` is the request target exactly as sent (as the URL parser serializes it). The host rejects (`401`, error `session_invalid`, `origin_mismatch`, `stale`, `bad_nonce`, `replay`, `bad_signature`) a missing or expired session, an `Origin` other than the session's, a timestamp more than 60 s off, a nonce already used in the session, or a wrong MAC. Nonces are remembered longer than timestamps stay valid.

Every response to a signed request carries:

```text
X-TB-Ts:  milliseconds since the Unix epoch
X-TB-Mac: MAC(sessionKey, "res", status, requestNonce, ts, responseBodyHash)
```

The extension discards any response whose MAC is missing or wrong or whose timestamp is stale, drops the session and authenticates again. Because the MAC includes the request nonce, an old signed response (for example an earlier command) cannot be replayed to a new poll. A `401` without a valid MAC only causes re-authentication.

### `GET /v2/poll`

Signed long-poll. The host keeps it open (SuperCLI: 20 s) and answers `200` with the next request, or `204` when none is waiting. The extension polls again immediately after a `200` and after 250 ms after a `204`; after a network error it re-authenticates after 1 s.

```json
{
  "id": "req-123",
  "op": "search",
  "args": { "subject": "invoice", "limit": 20 }
}
```

`id` must uniquely identify the request until its result has been received.

### `POST /v2/result`

Signed. Body (`Content-Type: application/json; charset=utf-8`, always valid UTF-8; a lone UTF-16 surrogate is escaped as `\udXXX`):

```json
{ "id": "req-123", "ok": true, "data": {} }
{ "id": "req-123", "ok": false, "error": "Human-readable error" }
```

The host answers `204` (signed). A retried identical result for an accepted request is acknowledged again (`204`); a different body for it is `409`.

### `POST /v2/attachment-file?id=...&filename=...&content_type=...`

Used by `get_attachment`. Signed; the body hash covers the raw attachment bytes and the query is part of the signed path. The host accepts the upload only after the MAC over the complete body verified, and deletes it otherwise.

### `GET /v2/message-file?id=...`

Used by `import_msg`. Signed; the host returns a previously prepared RFC 822 / `.eml` payload with a signed response.

### Outdated extensions

A protocol 2 host answers `/poll`, `/result`, `/health`, `/message-file` and `/attachment-file` (protocol 1) with `426` and `error: extension_outdated` and never dispatches a request to them. SuperCli tells the user to update the extension to 0.10.0 or newer and pair it.

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
- `verify_move`
- `address_books`
- `contacts`
- `contact_candidates`

### Mutating operations

- `create_folder`
- `rename_folder`
- `delete_folder`
- `compact_folder`
- `repair_folder`
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
- `include_duplicates` — `count`, `search`, `senders`, `largest`: JSON `true` returns one entry per Thunderbird record instead of one per `Message-ID` (see Duplicate messages)

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

**Duplicate messages.** `count`, `search`, `senders` and `largest` count each `Message-ID` once:

- within one folder, duplicate index records of the same message (Thunderbird keeps them after some IMAP moves; seen live as 75 records for 67 messages) are merged, keeping the record with the highest Thunderbird ID;
- on Gmail, where a message appears once per label plus All Mail, an account-wide (or multi-folder) scan counts it once and returns a label copy rather than the All Mail copy. Other servers keep the same `Message-ID` in different folders as real copies.

Messages without a `Message-ID` are never merged. Results include `deduplicatedByMessageId: true`, `crossFolderDeduplication` (Gmail), `scannedRecords`, `duplicatesSkipped` (total), `duplicateRecords` (same folder) and `crossFolderDuplicates` (Gmail labels). `search` deduplicates before applying `limit`. Pass `include_duplicates: true` for the raw per-record behaviour (`deduplicatedByMessageId: false`). Bulk mutations always select every record.

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

`folders` returns `totalMessageCount` and `unreadMessageCount` for each folder from `messenger.folders.getFolderInfo`, plus `folderInfoAvailable`. Counts are `null` when the API is missing or one folder cannot be read; the listing itself does not fail. `totalMessageCount` counts index records and can include duplicate records of one message. `include_unique_counts: true` scans headers and adds `messageRecords`, `uniqueMessageCount` and `duplicateRecords` per folder (or only for the folder given in `folder`). This is opt-in because it reads every header, which is slow on a large Gmail All Mail. The result says `uniqueCountsIncluded`.

`repair_folder` requires `folder` and `confirm: true`. It does what Folder Properties > Repair Folder does in Thunderbird: for IMAP it removes the local offline cache file (messages stay on the server), invalidates and backs up the folder index (`.msf`) and rebuilds it from the server; for a local mbox folder it reparses the mbox. Messages are never deleted. It is refused before anything changes, with a Polish error, when the folder is busy ("inny proces ma do niego dostęp", retry in a few minutes), Thunderbird is offline, the folder has pending offline operations, the folder is open in a Thunderbird tab, or it is a saved search, a maildir store or the account root. Gmail All Mail needs `allow_all_mail: true`. The result has `repaired`, `completed`, `offlineStoreRemoved`, `before`/`after` (`records`, `uniqueMessages`, `duplicateRecords`) and `messagesDeleted: false`. Thunderbird can report the rebuild as done before the new index is filled from the server (live: 0 records after 185 ms, 67 a few seconds later), so the bridge then re-counts the folder with a backoff (250 ms doubling to 5 s, at most 60 s) until the record count is the same in two consecutive checks and, when `before.records > 0`, non-zero. The result also has `rebuildInProgress`, `lastObservedRecords` (equal to `after.records`), `settleChecks` and `settleMs`. If the count does not settle in time the result is `completed: false`, `repaired: false`, `rebuildInProgress: true` and a `warning` starting with "Przebudowa indeksu trwa — sprawdź ponownie za chwilę" that includes the last observed count; `after.records: 0` is never reported as final for a folder that had records before without this warning. When Thunderbird is still rebuilding after 5 minutes it likewise returns `completed: false`, `rebuildInProgress: true` with a `warning`; re-check later with `count` or `folders`. `status.nativeRepairFolderAvailable` tells whether the experiment is present.

`delete_folder` returns `deleted: true, movedToTrash: false` when the folder is gone. On Local Folders (and servers that behave the same way) Thunderbird moves the folder into Trash instead; the result is then `deleted: false, movedToTrash: true` with `newPath` and `trashedFolder`.

`largest` counts each `Message-ID` once as described under Duplicate messages.

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

The result includes `verified`, `immediateVerified`, `destinationVerified`, `sourceVerified`, `settleMs`, `refreshed`, `movedButUnverified`, `missingInDestination` (up to 20 Message-IDs), `destinationDuplicates`, `status` (`verified_moved` or `moved_but_unverified`) and `warning`. On Gmail, a destination label that already held the message only has to contain it; elsewhere each moved message must add a copy. An unverified batch returns no `continuation` even when `more: true`; check the destination and All Mail before continuing.

Gmail can still drop a label later than the settle window. IMAP move results therefore also include `messageIds` (the moved `Message-ID`s), `recheckAfterMs` (180000 on Gmail, 60000 on other IMAP, `null` for Local Folders) and `recheck`, a ready request `{op: "verify_move", args: {account, source, destination, header_message_ids}}`. Hosts should send it after `recheckAfterMs`, with a new request `id`.

`verify_move` is read-only. Arguments: `destination` (required), `header_message_ids` (required, up to 500), optional `source`, `account`, and `refresh` (default `true`: ask Thunderbird to refresh both folders from the server first). It returns `checked`, `inDestination`, `missingInDestinationCount`, `stillInSourceCount`, `missingInDestination`, `stillInSource`, `destinationDuplicates` (up to 50 each), `locations` (for up to 20 missing IDs: `foundIn` folder paths, `onlyInAllMail` when Gmail dropped the label, and `notFound`), `labelDropped`, `refreshed`, `verified`, `status` (`verified_moved` / `moved_but_unverified`), `readOnly: true` and a Polish `warning` when unverified.

### Gmail label safety

On Gmail a label folder is a view of one message. `trash` or `move` from a label other than Inbox, Trash, Spam or All Mail is rejected without changes (also for `dry_run`) when any selected `Message-ID` also exists in Inbox or another label, because trashing it would remove it from there too. Messages without a `Message-ID` are rejected for the same reason. Run the operation from Inbox, or select messages that only carry that label. For `move`, `allow_other_labels: true` accepts removing just the source label. Gmail All Mail sources keep their separate protection.

## Permanent deletion

Permanent deletion is deliberately restricted to Thunderbird's default Trash folder. On IMAP accounts the bridge uses Thunderbird's native compact/EXPUNGE behavior and verifies mailbox state before reporting final success where possible.

`empty_trash` uses Thunderbird's native server-side Empty Trash operation. If messages remain after refresh, it returns `serverVerified: false` and `status: "verification_failed"`.

A purge whose native compaction was skipped cannot confirm server EXPUNGE: it returns `serverVerified: false`, `pendingExpunge: true` and, when matching messages are locally gone, `status: "server_expunge_not_confirmed"`. A refresh error also leaves `pendingExpunge: true`. Hosts must inspect verification/status fields rather than treating transport `ok: true` as proof of permanent deletion.

## Host implementation guidance

A minimal host needs these pieces:

1. pairing (`/v2/hello`, `/v2/pair/start`, `/v2/pair/finish`), a UI that shows the one-time code, and protected storage for the pairing secret,
2. mutual authentication (`/v2/auth`) and verification of every signed request (session, timestamp, nonce, MAC) plus signing of every response,
3. a queue for bridge requests and `/v2/poll` to give them to Thunderbird,
4. `/v2/result` to receive responses,
5. temporary file storage for attachment/message transfer if those features are used.

`extension/bridge-auth.js` is a compact reference for every derivation and canonical string; the SuperCLI host implements the same in Go (`internal/tools/mail/thunderbird_bridge_*.go`), and both repositories test the same known-answer vector.

The host is free to expose any interface on its other side: CLI commands, MCP tools, model function calling, a desktop app, REST, or something else entirely.

## Compatibility

The protocol is experimental until `1.0`. If you build another host implementation, pin the extension version and expect small field/operation changes while the API is being cleaned up. Protocol 2 (extension 0.10.0) is deliberately incompatible with protocol 1 hosts and extensions in both directions: each side fails closed and says which side to update.

## Result delivery and uncertain outcomes

### Operation timeouts

The extension limits how long it waits for one operation: 120 s for reads, 10 minutes for mutations, 20 minutes for `compact_folder`, `empty_trash` and `repair_folder`. A timeout cannot stop Thunderbird's own work. A timed-out mutation returns `ok: false` with an error containing `outcome unknown` (it may have executed or still be running; do not retry automatically). A timed-out read says nothing changed. The extension logs a `console.warn` with the operation name and continues with the next request, so a later operation may run while a timed-out one is still finishing. Hosts usually time out earlier (SuperCLI: 20–120 s) and must treat that as outcome unknown too.

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
