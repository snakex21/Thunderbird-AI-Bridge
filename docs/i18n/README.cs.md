# Thunderbird AI Bridge

[English / úplný seznam jazyků](../../README.md)

## Co to je?

Thunderbird AI Bridge je lokální most mezi Thunderbirdem a AI agenty, CLI nástroji, skripty a vlastními aplikacemi. Rozšíření provádí operace s poštovní schránkou a místní program s ním komunikuje přes malý HTTP protokol na `127.0.0.1`.

**SuperCLI není vyžadováno.** První host vznikl pro SuperCLI, ale rozšíření může používat jakýkoli program, který implementuje protokol popsaný v [docs/PROTOCOL.md](../PROTOCOL.md).

## Funkce

- seznam účtů a složek,
- vytváření, přejmenování a mazání složek,
- vyhledávání podle odesílatele, příjemce/adresy, předmětu, plného textu a data,
- čtení zpráv bez záměrné změny stavu přečteno/nepřečteno,
- čtení dlouhých zpráv po částech,
- seznam a přenos příloh pro vision modely nebo zpracování dokumentů,
- přesouvání zpráv, přesun do Koše a obnovení,
- trvalé mazání s ověřením IMAP,
- nativní Thunderbird Empty Trash/EXPUNGE,
- import Outlook `.msg` po převodu na `.eml`,
- hromadné operace v omezených dávkách s continuation tokenem.

## Bezpečnost

Citlivé operace mají dodatečné ochrany. Destruktivní akce vyžadují `confirm: true`, trvalé mazání je omezeno na Koš a system/root složky jsou chráněny. Host by měl také vyžadovat jasné potvrzení uživatele.

Bridge je určen pro lokální použití. Nevystavujte host přímo do LAN ani na Internet.

## Build

Vyžaduje Thunderbird 128 nebo novější.

```bash
python scripts/build_xpi.py
npm test
```

XPI se vytvoří v `dist/thunderbird-ai-bridge.xpi` a lze jej ručně nainstalovat přes správce doplňků Thunderbird.

Stav: experimentální (`0.9.18`). Protokol se může před `1.0` změnit.

Licence MIT. Nezávislý projekt, není oficiálně spojen s Mozillou ani Thunderbirdem.
