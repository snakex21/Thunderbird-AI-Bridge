# Changelog

## 0.9.32

- Contact imports now deduplicate within the selected destination book, so a dedicated book can remain complete even when an address already exists in another book.
- Added an explicitly confirmed `update_contact` operation for correcting a contact name or email address.
- Includes the mutation-scope hardening from `main`: mutating operations (now including `copy` and the address-book operations) require the JSON boolean `confirm: true`, ambiguous account/folder/special-folder selectors fail closed, `to`/`recipient`/`address` are valid mutation filters, continuations are bound to the resolved destination, and `empty_trash`/`purge` no longer report unconfirmed server deletion as verified.
- Includes result-delivery recovery from `main`: results are serialized once and only delivery is retried; duplicate request IDs never execute twice.
- Fixed double-encoded Polish error messages in the address-book and Gmail All Mail copy guards.

## 0.9.31

- Added address-book listing, contact listing and compact contact-candidate aggregation from message headers.
- Added explicit, confirmed creation of local address books and deduplicated contact imports (up to 200 contacts per call).
- Contact imports are safe to retry because existing email addresses are detected across all Thunderbird address books.

## 0.9.30

- Added exact `message_ids` batches for selecting concrete Thunderbird records when Gmail contains multiple messages sharing one RFC `Message-ID`.
- Gmail All Mail cleanup can now use verified local backups with exact numeric Thunderbird IDs, preventing accidental selection of extra duplicates.

## 0.9.29

- Added an explicit Gmail All Mail cleanup override that is accepted only with `confirm:true`, `local_backup_verified:true`, and exact `Message-ID` values.
- Added compact `header_message_ids` batches (up to 100 exact IDs) so verified local offloads can be cleaned up in one bounded operation instead of many slow IMAP calls.
- The override aborts before mutation if any requested `Message-ID` is missing or resolves ambiguously.

## 0.9.28 - 2026-08-13

### Fixed

- verified copies now skip Message-IDs already present in the destination, so a timed-out retry cannot create duplicates.

## 0.9.27 - 2026-08-13

### Fixed

- copying from Gmail All Mail to another folder on the same IMAP account is now blocked to prevent slow legacy-IMAP duplication; local-folder offload remains supported.

## 0.9.26 - 2026-08-13

### Fixed

- `move` is now blocked for Gmail's special All Mail folder (`Wszystkie`), preventing Thunderbird's legacy IMAP move path from expunging messages instead of placing them in a label/folder,
- added a regression test for the All Mail move guard.

## 0.9.25 - 2026-08-12

### Fixed

- recoverable `trash` is now blocked for Gmail's special All Mail folder because Gmail can expunge both the original and a staged Trash copy after synchronization,
- normal folders retain native recoverable Trash behavior with settled source/destination verification.

## 0.9.24 - 2026-08-12

### Fixed

- interrupted Gmail All Mail cleanup resumes from an already verified Trash copy without creating a duplicate,
- recoverable Trash state is represented as an explicit required Message-ID count and checked again after synchronization.

## 0.9.23 - 2026-08-12

### Fixed

- Gmail All Mail cleanup now stages and verifies an independent Trash copy before deleting the original message,
- Trash verification must survive a five-second IMAP synchronization window before success is reported.

## 0.9.22 - 2026-08-12

### Added

- compact largest-message aggregation with byte sizes and stable Message-ID headers,
- verified cross-account copy for safe Gmail-to-Local-Folders offloading,
- regression coverage for exact Message-ID copy and safe Trash behavior.

### Fixed

- Trash now uses Thunderbird's native `messages.delete(..., { deletePermanently: false })` path instead of a generic move from Gmail's special All Mail folder,
- a Trash operation is no longer reported as successful until every Message-ID appears in Trash and disappears from the source folder.

## 0.9.21 - 2026-08-11

### Added

- explicit `compact_folder` operation guarded by `confirm: true`,
- before/after byte measurements and reclaimed-space reporting,
- regression coverage for create, rename, compact and delete sequencing.

### Fixed

- successful Thunderbird 153 compaction no longer times out when its URL listener callback is omitted,
- folders with no expunged bytes are skipped instead of performing unnecessary I/O,
- compaction waits for a stable shrunken mbox as a native completion fallback.

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
