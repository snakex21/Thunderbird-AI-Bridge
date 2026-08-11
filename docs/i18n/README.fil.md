# Thunderbird AI Bridge

[English / kumpletong listahan ng mga wika](../../README.md)

## Ano ito?

Ang Thunderbird AI Bridge ay isang lokal na tulay sa pagitan ng Thunderbird at mga AI agent, CLI tool, script at custom application. Ang extension ang gumagawa ng mga operasyon sa mailbox, habang ang lokal na program ay nakikipag-usap dito sa pamamagitan ng maliit na HTTP protocol sa `127.0.0.1`.

**Hindi kailangan ang SuperCLI.** Ang unang host ay ginawa para sa SuperCLI, ngunit maaaring gamitin ng anumang program ang extension kung ipatutupad nito ang protocol na inilalarawan sa [docs/PROTOCOL.md](../PROTOCOL.md).

## Mga kakayahan

- ilista ang mga account at folder,
- gumawa, magpalit ng pangalan at mag-delete ng folder,
- maghanap ayon sa sender, recipient/address, subject, full text at petsa,
- magbasa ng message nang hindi sinasadyang binabago ang read/unread state,
- basahin ang mahahabang message nang paunti-unti,
- ilista at ilipat ang attachments para sa vision model o document processing,
- ilipat ang messages, ipadala sa Trash at i-restore,
- permanent deletion na may IMAP verification,
- native Empty Trash/EXPUNGE ng Thunderbird,
- mag-import ng Outlook `.msg` pagkatapos i-convert sa `.eml`,
- limitadong batch operations na may continuation token.

## Seguridad

May karagdagang proteksyon ang sensitibong operasyon. Ang destructive action ay nangangailangan ng `confirm: true`, ang permanent deletion ay limitado sa Trash, at protektado ang system/root folders. Dapat ding humingi ang host ng malinaw na kumpirmasyon mula sa user.

Dinisenyo ang bridge para sa lokal na paggamit. Huwag direktang i-expose ang host sa LAN o Internet.

## Build

Kailangan ang Thunderbird 128 o mas bago.

```bash
python scripts/build_xpi.py
npm test
```

Ginagawa ang XPI sa `dist/thunderbird-ai-bridge.xpi` at maaari itong manual na i-install sa Thunderbird Add-ons Manager.

Status: experimental (`0.9.21`). Maaaring magbago ang protocol bago ang `1.0`.

MIT License. Independent project ito at hindi opisyal na proyekto ng Mozilla o Thunderbird.
