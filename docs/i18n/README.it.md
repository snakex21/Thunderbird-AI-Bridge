# Thunderbird AI Bridge

[English / elenco completo delle lingue](../../README.md)

## Cos'è?

Thunderbird AI Bridge è un ponte locale tra Thunderbird e agenti AI, strumenti CLI, script e applicazioni personalizzate. L'estensione esegue le operazioni sulla posta, mentre un programma locale comunica con essa tramite un piccolo protocollo HTTP su `127.0.0.1`.

**SuperCLI non è necessario.** Il primo host è stato creato per SuperCLI, ma qualsiasi programma può usare l'estensione se implementa il protocollo descritto in [docs/PROTOCOL.md](../PROTOCOL.md).

## Funzioni

- elencare account e cartelle,
- creare, rinominare ed eliminare cartelle,
- cercare per mittente, destinatario/indirizzo, oggetto, testo e data,
- leggere messaggi senza modificarne intenzionalmente lo stato letto/non letto,
- scorrere messaggi lunghi a blocchi,
- elencare e trasferire allegati per modelli vision o parser di documenti,
- spostare messaggi, inviarli nel Cestino e ripristinarli,
- eliminazione permanente con verifica IMAP,
- Empty Trash/EXPUNGE nativo di Thunderbird,
- importare messaggi Outlook `.msg` convertiti in `.eml`,
- operazioni massive in lotti limitati con token di continuazione.

## Sicurezza

Le operazioni sensibili hanno protezioni aggiuntive. Le azioni distruttive richiedono `confirm: true`, l'eliminazione permanente è limitata al Cestino e le cartelle di sistema/root sono protette. Anche l'host dovrebbe chiedere una conferma chiara all'utente.

Il bridge è progettato per uso locale. Non esporre direttamente l'host alla LAN o a Internet.

## Build

Richiede Thunderbird 128 o successivo.

```bash
python scripts/build_xpi.py
npm test
```

L'XPI viene generato in `dist/thunderbird-ai-bridge.xpi` e può essere installato manualmente dal gestore componenti aggiuntivi di Thunderbird.

Stato: sperimentale (`0.9.18`). Il protocollo può cambiare prima di `1.0`.

Licenza MIT. Progetto indipendente, non affiliato né approvato da Mozilla o Thunderbird.
