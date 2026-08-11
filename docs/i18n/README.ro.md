# Thunderbird AI Bridge

[English / lista completă de limbi](../../README.md)

## Ce este?

Thunderbird AI Bridge este o punte locală între Thunderbird și agenți AI, instrumente CLI, scripturi și aplicații personalizate. Extensia execută operațiile asupra căsuței poștale, iar un program local comunică printr-un mic protocol HTTP pe `127.0.0.1`.

**SuperCLI nu este necesar.** Primul host a fost creat pentru SuperCLI, dar orice program poate utiliza extensia dacă implementează protocolul descris în [docs/PROTOCOL.md](../PROTOCOL.md).

## Funcții

- listarea conturilor și folderelor,
- crearea, redenumirea și ștergerea folderelor,
- căutare după expeditor, destinatar/adresă, subiect, text complet și dată,
- citirea mesajelor fără schimbarea intenționată a stării citit/necitit,
- citirea mesajelor lungi în segmente,
- listarea și transferul atașamentelor pentru modele vision sau procesarea documentelor,
- mutarea mesajelor, trimiterea în Trash și restaurarea,
- ștergere permanentă cu verificare IMAP,
- Empty Trash/EXPUNGE nativ Thunderbird,
- import Outlook `.msg` după conversia în `.eml`,
- operații în masă în loturi limitate cu continuation token.

## Securitate

Operațiile sensibile au protecții suplimentare. Acțiunile distructive necesită `confirm: true`, ștergerea permanentă este limitată la Trash, iar folderele system/root sunt protejate. Host-ul trebuie de asemenea să solicite confirmare clară de la utilizator.

Bridge-ul este proiectat pentru utilizare locală. Nu expuneți host-ul direct în LAN sau pe Internet.

## Build

Necesită Thunderbird 128 sau mai nou.

```bash
python scripts/build_xpi.py
npm test
```

XPI-ul este generat în `dist/thunderbird-ai-bridge.xpi` și poate fi instalat manual din managerul de add-on-uri Thunderbird.

Stare: experimental (`0.9.18`). Protocolul se poate modifica înainte de `1.0`.

Licență MIT. Proiect independent, fără afiliere oficială cu Mozilla sau Thunderbird.
