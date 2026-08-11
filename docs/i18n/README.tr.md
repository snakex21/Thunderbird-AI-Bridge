# Thunderbird AI Bridge

[English / tüm diller](../../README.md)

## Nedir?

Thunderbird AI Bridge, Thunderbird ile yapay zekâ ajanları, CLI araçları, betikler ve özel uygulamalar arasında çalışan yerel bir köprüdür. Eklenti posta kutusu işlemlerini gerçekleştirir; yerel bir program ise `127.0.0.1` üzerindeki küçük bir HTTP protokolüyle eklentiyle iletişim kurar.

**SuperCLI gerekli değildir.** İlk host SuperCLI için geliştirildi, ancak [docs/PROTOCOL.md](../PROTOCOL.md) dosyasında açıklanan protokolü uygulayan herhangi bir program eklentiyi kullanabilir.

## Özellikler

- hesapları ve klasörleri listeleme,
- klasör oluşturma, yeniden adlandırma ve silme,
- gönderen, alıcı/adres, konu, tam metin ve tarihe göre arama,
- okunma durumunu bilerek değiştirmeden mesaj okuma,
- uzun mesajları parçalar halinde okuma,
- vision modelleri veya belge işleme için ekleri listeleme ve aktarma,
- mesaj taşıma, Çöp Kutusu'na gönderme ve geri yükleme,
- IMAP doğrulamalı kalıcı silme,
- Thunderbird'ün yerel Empty Trash/EXPUNGE işlemleri,
- `.eml` biçimine dönüştürülmüş Outlook `.msg` mesajlarını içe aktarma,
- continuation token ile sınırlı toplu işlem paketleri.

## Güvenlik

Hassas işlemlerde ek korumalar vardır. Yıkıcı işlemler `confirm: true` gerektirir, kalıcı silme yalnızca Çöp Kutusu ile sınırlandırılır ve sistem/root klasörleri korunur. Host da kullanıcıdan açık onay istemelidir.

Bridge yerel kullanım için tasarlanmıştır. Host'u doğrudan LAN'a veya İnternet'e açmayın.

## Derleme

Thunderbird 128 veya daha yeni bir sürüm gerekir.

```bash
python scripts/build_xpi.py
npm test
```

XPI `dist/thunderbird-ai-bridge.xpi` konumunda oluşturulur ve Thunderbird eklenti yöneticisinden elle kurulabilir.

Durum: deneysel (`0.9.18`). Protokol `1.0` öncesinde değişebilir.

MIT lisansı. Mozilla veya Thunderbird ile bağlantısı olmayan bağımsız bir projedir.
