# Thunderbird AI Bridge

[English / volledige talenlijst](../../README.md)

## Wat is dit?

Thunderbird AI Bridge is een lokale brug tussen Thunderbird en AI-agents, CLI-tools, scripts en eigen toepassingen. De extensie voert mailboxbewerkingen uit; een lokaal programma communiceert ermee via een klein HTTP-protocol op `127.0.0.1`.

**SuperCLI is niet vereist.** De eerste host is voor SuperCLI gebouwd, maar ieder programma kan de extensie gebruiken als het het protocol uit [docs/PROTOCOL.md](../PROTOCOL.md) implementeert.

## Functies

- accounts en mappen weergeven,
- mappen maken, hernoemen en verwijderen,
- zoeken op afzender, ontvanger/adres, onderwerp, volledige tekst en datum,
- berichten lezen zonder bewust de gelezen/ongelezen-status te wijzigen,
- lange berichten in delen lezen,
- bijlagen weergeven en overdragen voor vision-modellen of documentverwerking,
- berichten verplaatsen, naar Prullenbak sturen en herstellen,
- permanent verwijderen met IMAP-verificatie,
- native Thunderbird Empty Trash/EXPUNGE,
- Outlook `.msg` importeren na conversie naar `.eml`,
- bulkbewerkingen in beperkte batches met continuation tokens.

## Beveiliging

Gevoelige bewerkingen hebben extra beveiliging. Destructieve acties vereisen `confirm: true`, permanent verwijderen is beperkt tot de Prullenbak en system/root-mappen zijn beschermd. Ook de host moet duidelijke bevestiging van de gebruiker vragen.

De bridge is bedoeld voor lokaal gebruik. Stel de host niet rechtstreeks bloot aan LAN of internet.

## Build

Thunderbird 128 of nieuwer is vereist.

```bash
python scripts/build_xpi.py
npm test
```

De XPI wordt gebouwd als `dist/thunderbird-ai-bridge.xpi` en kan handmatig via Thunderbird Add-ons Manager worden geïnstalleerd.

Status: experimenteel (`0.9.21`). Het protocol kan voor `1.0` nog wijzigen.

MIT-licentie. Onafhankelijk project, niet officieel verbonden met Mozilla of Thunderbird.
