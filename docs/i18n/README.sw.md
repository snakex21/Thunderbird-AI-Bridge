# Thunderbird AI Bridge

[English / orodha kamili ya lugha](../../README.md)

## Ni nini?

Thunderbird AI Bridge ni daraja la ndani kati ya Thunderbird na mawakala wa AI, zana za CLI, script na programu maalum. Extension hufanya shughuli kwenye kisanduku cha barua, huku programu ya ndani ikiwasiliana nayo kupitia protocol ndogo ya HTTP kwenye `127.0.0.1`.

**SuperCLI si lazima.** Host ya kwanza ilitengenezwa kwa SuperCLI, lakini programu yoyote inaweza kutumia extension ikiwa itatekeleza protocol iliyoelezwa katika [docs/PROTOCOL.md](../PROTOCOL.md).

## Vipengele

- kuorodhesha akaunti na folda,
- kuunda, kubadilisha jina na kufuta folda,
- kutafuta kwa mtumaji, mpokeaji/anwani, mada, maandishi kamili na tarehe,
- kusoma ujumbe bila kubadilisha kwa makusudi hali ya kusomwa,
- kusoma ujumbe mrefu kwa sehemu,
- kuorodhesha na kuhamisha viambatisho kwa vision model au uchakataji wa hati,
- kuhamisha ujumbe, kupeleka Trash na kurejesha,
- kufuta kabisa kwa uthibitishaji wa IMAP,
- Empty Trash/EXPUNGE ya asili ya Thunderbird,
- kuingiza Outlook `.msg` baada ya kubadilishwa kuwa `.eml`,
- shughuli nyingi kwa batch ndogo zenye continuation token.

## Usalama

Shughuli nyeti zina ulinzi wa ziada. Vitendo vya kufuta au kubadilisha data kwa hatari vinahitaji `confirm: true`, kufuta kabisa kunaruhusiwa kutoka Trash pekee, na folda za system/root zinalindwa. Host pia inapaswa kuomba uthibitisho wazi kutoka kwa mtumiaji.

Bridge imeundwa kwa matumizi ya ndani. Usiweke host wazi moja kwa moja kwenye LAN au Internet.

## Build

Inahitaji Thunderbird 128 au mpya zaidi.

```bash
python scripts/build_xpi.py
npm test
```

XPI hutengenezwa katika `dist/thunderbird-ai-bridge.xpi` na inaweza kusakinishwa mwenyewe kupitia Thunderbird Add-ons Manager.

Hali: experimental (`0.9.18`). Protocol inaweza kubadilika kabla ya `1.0`.

Leseni ya MIT. Mradi huru, si mradi rasmi wa Mozilla au Thunderbird.
