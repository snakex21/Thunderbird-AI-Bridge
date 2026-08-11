# Changelog

## 0.9.18 - 2026-08-11

Initial public-repository baseline based on the working Thunderbird bridge build.

### Included

- message search by sender, recipient/address, subject, full text and date,
- message-body reading with paging and HTML-to-text handling,
- attachment discovery and local file transfer,
- account/folder listing and folder CRUD,
- move, Trash and restore operations,
- verified permanent deletion and native IMAP Empty Trash/EXPUNGE,
- converted Outlook `.msg` import,
- bounded bulk operations with continuation tokens,
- regression tests for folder CRUD and message reading,
- XPI build helper and GitHub Actions CI,
- English README plus 31 translated README files.

### Compatibility

The localhost endpoint, compatibility token and legacy extension ID are intentionally retained so this public baseline remains compatible with the existing host implementation and can replace the development add-on instead of running beside it.
