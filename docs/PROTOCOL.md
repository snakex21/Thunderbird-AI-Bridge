# Thunderbird AI Bridge protocol

This document describes the localhost transport expected by the Thunderbird extension in the current `0.9.18` implementation.

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
- `import_msg`
- `move`
- `trash`
- `restore`
- `empty_trash`
- `purge`
- `delete_permanently`

Mutating operations that can change or destroy user data require `confirm: true` where enforced by the extension.

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

## Bulk message operations

`move`, `trash`, `restore` and permanent deletion operate in bounded batches. Large jobs may return:

```json
{
  "more": true,
  "continuation": "..."
}
```

The host should send the returned continuation token with the same operation and filters to process the next batch. Continuation tokens expire and are tied to an operation fingerprint to reduce accidental filter changes during a destructive job.

`dry_run: true` can be used by supported bulk operations to inspect how many messages would be affected before performing the mutation.

## Permanent deletion

Permanent deletion is deliberately restricted to Thunderbird's default Trash folder. On IMAP accounts the bridge uses Thunderbird's native compact/EXPUNGE behavior and verifies mailbox state before reporting final success where possible.

`empty_trash` uses Thunderbird's native server-side Empty Trash operation.

## Host implementation guidance

A minimal host needs four pieces:

1. a queue for bridge requests,
2. `/poll` to give requests to Thunderbird,
3. `/result` to receive responses,
4. temporary file storage for attachment/message transfer if those features are used.

The host is free to expose any interface on its other side: CLI commands, MCP tools, model function calling, a desktop app, REST, or something else entirely.

## Compatibility

The protocol is experimental until `1.0`. If you build another host implementation, pin the extension version and expect small field/operation changes while the API is being cleaned up.
