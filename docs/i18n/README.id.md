# Thunderbird AI Bridge

[English / daftar lengkap bahasa](../../README.md)

## Apa ini?

Thunderbird AI Bridge adalah jembatan lokal antara Thunderbird dan agen AI, alat CLI, skrip, serta aplikasi khusus. Ekstensi menjalankan operasi pada kotak surat, sedangkan program lokal berkomunikasi dengannya melalui protokol HTTP kecil di `127.0.0.1`.

**SuperCLI tidak diperlukan.** Host pertama dibuat untuk SuperCLI, tetapi program apa pun dapat menggunakan ekstensi ini jika menerapkan protokol yang dijelaskan di [docs/PROTOCOL.md](../PROTOCOL.md).

## Fitur

- menampilkan akun dan folder,
- membuat, mengganti nama, dan menghapus folder,
- mencari berdasarkan pengirim, penerima/alamat, subjek, teks penuh, dan tanggal,
- membaca pesan tanpa sengaja mengubah status terbaca/belum terbaca,
- membaca pesan panjang per bagian,
- menampilkan dan mentransfer lampiran untuk model vision atau pemrosesan dokumen,
- memindahkan pesan, mengirim ke Trash, dan memulihkan,
- penghapusan permanen dengan verifikasi IMAP,
- Empty Trash/EXPUNGE native Thunderbird,
- mengimpor Outlook `.msg` setelah dikonversi menjadi `.eml`,
- operasi massal dalam batch terbatas dengan continuation token.

## Keamanan

Operasi sensitif memiliki perlindungan tambahan. Tindakan destruktif memerlukan `confirm: true`, penghapusan permanen dibatasi pada Trash, dan folder system/root dilindungi. Host juga harus meminta konfirmasi pengguna secara jelas.

Bridge ini dirancang untuk penggunaan lokal. Jangan mengekspos host langsung ke LAN atau Internet.

## Build

Memerlukan Thunderbird 128 atau lebih baru.

```bash
python scripts/build_xpi.py
npm test
```

XPI dibuat di `dist/thunderbird-ai-bridge.xpi` dan dapat dipasang secara manual melalui pengelola add-on Thunderbird.

Status: eksperimental (`0.9.18`). Protokol dapat berubah sebelum `1.0`.

Lisensi MIT. Proyek independen, tidak berafiliasi dengan Mozilla atau Thunderbird.
