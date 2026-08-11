# Security

Thunderbird AI Bridge can read and modify mailbox data. Treat any host process that can queue bridge requests as highly trusted software.

## Local-only design

The current extension communicates with `127.0.0.1`. Keep the host bound to loopback. Do not expose the bridge transport directly to a LAN or the public Internet.

The current static compatibility token is not a substitute for real authentication. It mainly reduces accidental cross-talk with unrelated local services.

## Destructive actions

The extension requires explicit confirmation for sensitive operations and places additional restrictions on permanent deletion. Host applications should also obtain clear user confirmation before deleting messages, emptying Trash, moving large sets of mail, importing mail or changing folders.

## Testing

Use a disposable or non-critical mailbox when testing new versions, especially IMAP folder CRUD and permanent deletion behavior.

## Reporting a vulnerability

Do not publish mailbox contents, access credentials, tokens or private attachments in a public issue. Report the minimum information needed to reproduce the problem and redact personal data.
