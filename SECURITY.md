# Security

Thunderbird AI Bridge can read and modify mailbox data. Treat any host process that can queue bridge requests as highly trusted software.

## Local-only design and pairing

The extension communicates only with `127.0.0.1:47831`. Keep the host bound to loopback. Do not expose the bridge transport directly to a LAN or the public Internet.

Since 0.10.0 (protocol 2) the extension trusts a host only after a one-time pairing: the host shows a 16-character code, the user enters it in the extension's options, and both sides agree on a 256-bit secret through ECDH authenticated by the code. Every connection then runs a mutual HMAC-SHA256 challenge-response, and every request and response is signed with a timestamp and a nonce bound to the request. A program that takes the port without the secret receives no poll and no result, and nothing it sends is executed. The host refuses web origins, wrong `Host` headers and unsigned or replayed requests. See [docs/PROTOCOL.md](docs/PROTOCOL.md).

What pairing does **not** protect against: malware already running as the same OS user can read Thunderbird's profile (where the extension stores the secret) and the host's data folder directly. Pairing protects against other programs, other host instances and web pages, not against a compromised user account.

Unpair from the extension's options or from the host (SuperCLI: Settings -> Thunderbird -> Unpair, or `/thunderbird unpair`). Pairing again replaces the secret on both sides.

## Destructive actions

The extension requires explicit confirmation for sensitive operations and places additional restrictions on permanent deletion. Host applications should also obtain clear user confirmation before deleting messages, emptying Trash, moving large sets of mail, importing mail or changing folders.

## Testing

Use a disposable or non-critical mailbox when testing new versions, especially IMAP folder CRUD and permanent deletion behavior.

## Reporting a vulnerability

Do not publish mailbox contents, access credentials, tokens or private attachments in a public issue. Report the minimum information needed to reproduce the problem and redact personal data.
