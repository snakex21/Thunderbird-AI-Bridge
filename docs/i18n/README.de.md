# Thunderbird AI Bridge

[English / vollständige Sprachliste](../../README.md)

## Was ist das?

Thunderbird AI Bridge ist eine lokale Brücke zwischen Thunderbird und KI-Agenten, CLI-Werkzeugen, Skripten oder eigenen Anwendungen. Die Erweiterung führt Mailbox-Operationen aus; ein lokales Programm kommuniziert über ein kleines HTTP-Protokoll auf `127.0.0.1` mit ihr.

**SuperCLI ist nicht erforderlich.** Der erste Host wurde für SuperCLI entwickelt, aber jedes Programm kann die Erweiterung verwenden, wenn es das in [docs/PROTOCOL.md](../PROTOCOL.md) beschriebene Protokoll implementiert.

## Funktionen

- Konten und Ordner auflisten,
- Ordner erstellen, umbenennen und löschen,
- nach Absender, Empfänger/Adresse, Betreff, Volltext und Datum suchen,
- Nachrichten lesen, ohne ihren Gelesen-Status absichtlich zu ändern,
- lange Nachrichten seitenweise lesen,
- Anhänge für Vision-Modelle oder Dokumentverarbeitung auflisten und übertragen,
- Nachrichten verschieben, in den Papierkorb legen und wiederherstellen,
- dauerhaftes Löschen mit IMAP-Verifikation,
- natives Thunderbird Empty Trash/EXPUNGE,
- importierte Outlook-`.msg`-Nachrichten nach Konvertierung zu `.eml`,
- begrenzte Batch-Operationen mit Fortsetzungs-Token.

## Sicherheit

Sensible Aktionen besitzen zusätzliche Schutzmechanismen. Destruktive Vorgänge benötigen `confirm: true`, dauerhaftes Löschen ist auf den Papierkorb beschränkt und System-/Root-Ordner sind geschützt. Auch der Host sollte vor destruktiven Aktionen eine eindeutige Benutzerbestätigung verlangen.

Der Bridge ist für lokalen Betrieb gedacht. Den Host nicht direkt im LAN oder Internet freigeben.

## Build

Thunderbird 128 oder neuer wird benötigt.

```bash
python scripts/build_xpi.py
npm test
```

Das XPI entsteht unter `dist/thunderbird-ai-bridge.xpi` und kann über den Add-on-Manager von Thunderbird manuell installiert werden.

Status: experimentell (`0.9.18`). Das Protokoll kann sich vor `1.0` noch ändern.

MIT-Lizenz. Unabhängiges Projekt, nicht mit Mozilla oder Thunderbird verbunden.
