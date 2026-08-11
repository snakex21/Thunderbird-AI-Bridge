# Thunderbird AI Bridge

[English / senarai penuh bahasa](../../README.md)

## Apakah ini?

Thunderbird AI Bridge ialah jambatan tempatan antara Thunderbird dengan ejen AI, alat CLI, skrip dan aplikasi tersuai. Sambungan menjalankan operasi peti mel, manakala program tempatan berkomunikasi dengannya melalui protokol HTTP kecil pada `127.0.0.1`.

**SuperCLI tidak diperlukan.** Host pertama dibina untuk SuperCLI, tetapi mana-mana program boleh menggunakan sambungan ini jika melaksanakan protokol yang diterangkan dalam [docs/PROTOCOL.md](../PROTOCOL.md).

## Ciri

- menyenaraikan akaun dan folder,
- mencipta, menamakan semula dan memadam folder,
- mencari mengikut pengirim, penerima/alamat, subjek, teks penuh dan tarikh,
- membaca mesej tanpa sengaja mengubah status dibaca/belum dibaca,
- membaca mesej panjang secara berperingkat,
- menyenaraikan dan memindahkan lampiran untuk model vision atau pemprosesan dokumen,
- memindahkan mesej, menghantar ke Trash dan memulihkan,
- pemadaman kekal dengan pengesahan IMAP,
- Empty Trash/EXPUNGE asli Thunderbird,
- mengimport Outlook `.msg` selepas ditukar kepada `.eml`,
- operasi pukal dalam batch terhad dengan continuation token.

## Keselamatan

Operasi sensitif mempunyai perlindungan tambahan. Tindakan merosakkan memerlukan `confirm: true`, pemadaman kekal hanya dibenarkan dari Trash dan folder system/root dilindungi. Host juga perlu mendapatkan pengesahan jelas daripada pengguna.

Bridge direka untuk penggunaan tempatan. Jangan dedahkan host terus kepada LAN atau Internet.

## Build

Memerlukan Thunderbird 128 atau lebih baharu.

```bash
python scripts/build_xpi.py
npm test
```

XPI dibina di `dist/thunderbird-ai-bridge.xpi` dan boleh dipasang secara manual melalui pengurus add-on Thunderbird.

Status: eksperimen (`0.9.21`). Protokol mungkin berubah sebelum `1.0`.

Lesen MIT. Projek bebas dan bukan projek rasmi Mozilla atau Thunderbird.
