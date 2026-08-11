# Contributing

Thanks for helping improve Thunderbird AI Bridge.

## Good contributions

- Thunderbird compatibility fixes,
- tests for message/folder operations,
- protocol documentation improvements,
- host adapters for other AI tools,
- safer handling of destructive operations,
- translations and translation corrections,
- attachment/document handling improvements.

## Development

1. Fork or clone the repository.
2. Make changes in `extension/`.
3. Run `npm test`.
4. Run `python scripts/build_xpi.py` to verify the extension packages correctly.
5. Test the XPI with a non-critical mailbox before using destructive operations on real data.

## Pull requests

Keep changes focused and explain any protocol compatibility impact. If an operation or field changes, update `docs/PROTOCOL.md` in the same pull request.

Do not include private emails, mailbox dumps, access tokens or personal attachments in tests or bug reports.
