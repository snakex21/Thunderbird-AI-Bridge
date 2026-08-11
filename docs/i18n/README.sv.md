# Thunderbird AI Bridge

[English / fullständig språklista](../../README.md)

## Vad är detta?

Thunderbird AI Bridge är en lokal brygga mellan Thunderbird och AI-agenter, CLI-verktyg, skript och egna program. Tillägget utför operationer i brevlådan och ett lokalt program kommunicerar med det via ett litet HTTP-protokoll på `127.0.0.1`.

**SuperCLI krävs inte.** Den första hosten byggdes för SuperCLI, men vilket program som helst kan använda tillägget om det implementerar protokollet som beskrivs i [docs/PROTOCOL.md](../PROTOCOL.md).

## Funktioner

- lista konton och mappar,
- skapa, byta namn på och ta bort mappar,
- söka efter avsändare, mottagare/adress, ämne, fulltext och datum,
- läsa meddelanden utan att avsiktligt ändra läst/oläst-status,
- läsa långa meddelanden i delar,
- lista och överföra bilagor för vision-modeller eller dokumentbehandling,
- flytta meddelanden, skicka till Papperskorgen och återställa,
- permanent borttagning med IMAP-verifiering,
- Thunderbirds inbyggda Empty Trash/EXPUNGE,
- importera Outlook `.msg` efter konvertering till `.eml`,
- massoperationer i begränsade batcher med continuation token.

## Säkerhet

Känsliga operationer har extra skydd. Destruktiva åtgärder kräver `confirm: true`, permanent borttagning är begränsad till Papperskorgen och system/root-mappar skyddas. Hosten bör också begära tydlig bekräftelse från användaren.

Bryggan är avsedd för lokal användning. Exponera inte hosten direkt på LAN eller Internet.

## Build

Thunderbird 128 eller senare krävs.

```bash
python scripts/build_xpi.py
npm test
```

XPI-filen skapas i `dist/thunderbird-ai-bridge.xpi` och kan installeras manuellt via Thunderbirds tilläggshanterare.

Status: experimentell (`0.9.18`). Protokollet kan ändras före `1.0`.

MIT-licens. Oberoende projekt, inte officiellt knutet till Mozilla eller Thunderbird.
