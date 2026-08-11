# Thunderbird AI Bridge

[English / teljes nyelvi lista](../../README.md)

## Mi ez?

A Thunderbird AI Bridge egy helyi híd a Thunderbird és AI-ügynökök, CLI-eszközök, scriptek és egyedi alkalmazások között. A bővítmény végzi a postafiók-műveleteket, egy helyi program pedig a `127.0.0.1` címen futó kis HTTP-protokollon keresztül kommunikál vele.

**A SuperCLI nem szükséges.** Az első host SuperCLI-hez készült, de bármely program használhatja a bővítményt, ha megvalósítja a [docs/PROTOCOL.md](../PROTOCOL.md) fájlban leírt protokollt.

## Funkciók

- fiókok és mappák listázása,
- mappák létrehozása, átnevezése és törlése,
- keresés feladó, címzett/cím, tárgy, teljes szöveg és dátum alapján,
- üzenetek olvasása a read/unread állapot szándékos módosítása nélkül,
- hosszú üzenetek részletekben történő olvasása,
- mellékletek listázása és továbbítása vision modellek vagy dokumentumfeldolgozás számára,
- üzenetek mozgatása, Trash-be helyezése és visszaállítása,
- végleges törlés IMAP-ellenőrzéssel,
- Thunderbird natív Empty Trash/EXPUNGE művelete,
- Outlook `.msg` importálása `.eml` formátumra konvertálás után,
- tömeges műveletek korlátozott batch-ekben continuation tokennel.

## Biztonság

Az érzékeny műveletek további védelemmel rendelkeznek. A destruktív műveletekhez `confirm: true` szükséges, a végleges törlés csak a Trash mappából engedélyezett, a system/root mappák pedig védettek. A hostnak is egyértelmű felhasználói megerősítést kell kérnie.

A bridge helyi használatra készült. A hostot ne tedd közvetlenül elérhetővé LAN-on vagy az Interneten.

## Build

Thunderbird 128 vagy újabb szükséges.

```bash
python scripts/build_xpi.py
npm test
```

Az XPI a `dist/thunderbird-ai-bridge.xpi` fájlba készül, és manuálisan telepíthető a Thunderbird kiegészítőkezelőjéből.

Állapot: kísérleti (`0.9.18`). A protokoll `1.0` előtt még változhat.

MIT licenc. Független projekt, nem a Mozilla vagy a Thunderbird hivatalos projektje.
