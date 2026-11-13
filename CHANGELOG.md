# Changelog

## 0.9.34 - 2026-11-13

### Fixed after live testing (2026-11-13)

- `repair_folder` on a Gmail label returned `repaired: true, completed: true, after.records: 0` after 185 ms while Thunderbird was still rebuilding the index from the server (a few seconds later the folder had the correct 67 records). After the rebuild the bridge now re-counts the folder with a backoff (up to 60 s) until the record count is stable in two consecutive checks and non-zero when the folder had records before. Otherwise it returns `completed: false`, `rebuildInProgress: true`, the last observed count (`lastObservedRecords`) and the warning "Przebudowa indeksu trwa — sprawdź ponownie za chwilę". New result fields: `rebuildInProgress`, `lastObservedRecords`, `settleChecks`, `settleMs`.

## 0.9.33 - 2026-11-13

### Fixed after live testing (2026-11-13)

- `from`, `to` and `address` filters given as a domain (`example.com` or `@example.com`) returned 0 because Thunderbird's query needs a full address or a name. Domains are now matched locally against the parsed mailbox (exact domain or subdomain, case-insensitive; `to` covers To and Cc) in `search`, `count`, `senders`, `largest`, `contact_candidates` and bulk mutation selection.
- `search` results are consistently newest-first; a limited search now returns the newest matches instead of the first pages in folder order.
- `search` no longer lists attachments for every result (100 results took 20–27 s). Pass `include_attachments: true` to get attachment metadata (at most 6 concurrent lookups); `read` still includes it. **Behaviour change for hosts.**
- Gmail: `trash` or `move` from a label other than Inbox is blocked with a Polish explanation when the same `Message-ID` is also in Inbox or another label, because Gmail would remove it there too. Inbox sources stay allowed; All Mail protection is unchanged; `move` accepts `allow_other_labels: true` for label-only removal.
- `move` is now verified: right after `messages.move`, then again after a settle window (10 s Gmail, 5 s other IMAP) and a server refresh of both folders (new `mailbridge.refreshFolder` experiment). A batch that does not survive returns `status: "moved_but_unverified"`, `movedButUnverified` and `missingInDestination`, and no continuation token. Duplicate destination headers are reported as a warning.
- Without `account`, a folder ID like `account2://INBOX` selects its own account, and a folder name that exists on several mail accounts is an error instead of silently using the first IMAP account. Account names match exactly (case-insensitive) before substring.
- Each operation has a time limit in the extension (120 s reads, 10 min mutations, 20 min `compact_folder`/`empty_trash`/`repair_folder`). A timed-out mutation reports `outcome unknown`; the request worker continues with later requests.
- When the result cache is full the host now receives an explicit `ok: false, notExecuted: true` error instead of no answer; the rejected ID is remembered so it never executes later.
- The poll loop waits 250 ms after an empty `204` instead of polling again immediately.
- `delete_folder` on Local Folders, where Thunderbird moves the folder into Trash, reports `movedToTrash: true` and `newPath` instead of `deleted: true`.
- `folders` includes `totalMessageCount` and `unreadMessageCount` from `folders.getFolderInfo` where available.
- `largest` with `scope: "account"` on Gmail counts each `Message-ID` once, so totals are no longer doubled by labels and All Mail.
- `count`, `search`, `senders` and `largest` count each `Message-ID` once. On Gmail an account-wide scan no longer counts a message once per label plus All Mail (a label copy is preferred over All Mail), and duplicate index records inside one folder (live: `studia` had 75 records for 67 Message-IDs after IMAP moves) are merged, so `search` never returns one Message-ID twice from a folder. Results add `deduplicatedByMessageId`, `crossFolderDeduplication`, `scannedRecords`, `duplicatesSkipped`, `duplicateRecords` and `crossFolderDuplicates`; `include_duplicates: true` restores the raw behaviour. `search` deduplicates before `limit`. Bulk mutations are unchanged. **Behaviour change for hosts:** counts can be lower than before.
- `folders` accepts `include_unique_counts: true` (optionally with `folder`) and then adds `messageRecords`, `uniqueMessageCount` and `duplicateRecords`; off by default because it scans every header.
- New confirmed `repair_folder` (experiment `mailbridge.repairFolder`) performs Thunderbird's own Repair Folder steps to rebuild a folder index with duplicate records. It never deletes messages and refuses before changing anything when the folder is busy ("inny proces ma do niego dostęp", retry later), Thunderbird is offline, offline operations are pending, the folder is open in a tab, or it is virtual/maildir/root; Gmail All Mail needs `allow_all_mail: true`. Returns before/after record and unique counts.
- IMAP `move` results add `messageIds`, `recheckAfterMs` (3 min Gmail, 1 min other IMAP) and a ready `recheck` request for the new read-only `verify_move`, which re-checks the Message-IDs in the destination and source later and reports labels Gmail dropped (`onlyInAllMail`).
- Result POSTs declare `Content-Type: application/json; charset=utf-8`. Bodies were already UTF-8; a regression test now covers Polish text, emoji and lone surrogates in results and errors.
- `PROTOCOL.md` now documents the required host CORS headers and long-poll, `message_ids`, `header_message_ids`, `local_backup_verified` and the new parameters and result fields.

### Earlier in 0.9.32

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
