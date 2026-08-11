# Thunderbird AI Bridge

**Read this README in your language:** [English](README.md) · [Polski](docs/i18n/README.pl.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Português](docs/i18n/README.pt-BR.md) · [Italiano](docs/i18n/README.it.md) · [Русский](docs/i18n/README.ru.md) · [Українська](docs/i18n/README.uk.md) · [Türkçe](docs/i18n/README.tr.md) · [العربية](docs/i18n/README.ar.md) · [فارسی](docs/i18n/README.fa.md) · [हिन्दी](docs/i18n/README.hi.md) · [বাংলা](docs/i18n/README.bn.md) · [اردو](docs/i18n/README.ur.md) · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Bahasa Indonesia](docs/i18n/README.id.md) · [Tiếng Việt](docs/i18n/README.vi.md) · [ไทย](docs/i18n/README.th.md) · [Bahasa Melayu](docs/i18n/README.ms.md) · [Filipino](docs/i18n/README.fil.md) · [Kiswahili](docs/i18n/README.sw.md) · [Nederlands](docs/i18n/README.nl.md) · [Română](docs/i18n/README.ro.md) · [Čeština](docs/i18n/README.cs.md) · [Svenska](docs/i18n/README.sv.md) · [Ελληνικά](docs/i18n/README.el.md) · [עברית](docs/i18n/README.he.md) · [Magyar](docs/i18n/README.hu.md)

---

## What is Thunderbird AI Bridge?

Thunderbird AI Bridge is a local bridge that lets AI agents, command-line tools and custom applications work with a user's Thunderbird mailbox through a small localhost HTTP protocol.

It is **not tied to one AI model, one CLI or one cloud provider**. The Thunderbird extension handles mailbox operations. Any local program can act as the host as long as it implements the bridge protocol.

The project is designed for local-first use: Thunderbird talks to `127.0.0.1`, so mailbox access does not need to be exposed directly to the network.

> Status: experimental, currently based on the working `0.9.18` bridge. The protocol may still change before `1.0`.

## Why this exists

Most AI integrations are written separately for Gmail, Outlook or a specific cloud service. Thunderbird already knows how to talk to many mail providers. This project uses Thunderbird as the mail backend and exposes a small agent-friendly interface on top of it.

That means one bridge can potentially be used by:

- local LLM applications,
- coding/agent CLIs,
- desktop AI assistants,
- automation scripts,
- custom MCP/tool adapters,
- self-hosted AI systems.

## Features

- list configured mail accounts,
- list folders and folder capabilities,
- create, rename and delete folders,
- search messages by sender, recipient/address, subject, full text and date,
- count matching messages,
- group messages by sender,
- read message bodies without marking them as read,
- page through long message bodies,
- list attachment metadata,
- transfer attachment contents to the local host for vision/document processing,
- move messages between folders,
- move messages to Trash,
- restore messages from Trash,
- permanently delete messages from Trash with verification,
- use Thunderbird's native IMAP EXPUNGE/Empty Trash behavior,
- import converted Outlook `.msg` mail as `.eml`,
- batch destructive operations with continuation tokens and explicit confirmation.

## Architecture

```text
AI model / agent / CLI / script
            │
            │ local bridge protocol
            ▼
Host process on 127.0.0.1:47831
            ▲
            │ poll / result / file transfer
            ▼
Thunderbird AI Bridge extension
            │
            ▼
Thunderbird → IMAP / Gmail / local folders / other configured accounts
```

The extension currently polls a host on:

```text
http://127.0.0.1:47831
```

The current default token and the legacy internal add-on ID are retained for compatibility with the original SuperCLI host implementation. This lets the public build replace the development add-on instead of installing a second polling copy beside it. A future release should make endpoint and token configuration user-selectable.

## Important: SuperCLI is not required

The first host implementation was built for SuperCLI, but the Thunderbird extension itself does not require the SuperCLI application.

A different program only needs to implement the HTTP contract described in [docs/PROTOCOL.md](docs/PROTOCOL.md). The host can then translate its own tool calls, MCP calls, model function calls or scripts into Thunderbird bridge requests.

## Safety model

Mailbox mutations are deliberately stricter than reads.

- destructive and folder-changing actions require `confirm: true`,
- bulk mutations require a filter unless the operation explicitly allows a whole-folder action,
- permanent deletion is restricted to Thunderbird's Trash folder,
- bulk operations are processed in bounded batches,
- IMAP permanent deletion is verified after Thunderbird performs its server-side operation,
- system/root folders are protected from rename/delete operations.

A host application should still ask the user before destructive actions. The extension-side checks are a second safety layer, not a replacement for good agent behavior.

## Repository layout

```text
extension/        Thunderbird extension source
 tests/           Node-based regression tests
 scripts/         build helpers
 docs/            protocol documentation
 docs/i18n/       translated README files
 .github/         GitHub Actions workflow
```

## Requirements

- Thunderbird 128 or newer,
- a local host process implementing the protocol,
- Node.js for the included regression tests,
- Python 3 for the simple XPI build helper.

## Build the XPI

From the repository root:

```bash
python scripts/build_xpi.py
```

The package is written to:

```text
dist/thunderbird-ai-bridge.xpi
```

You can then install it manually in Thunderbird using **Add-ons and Themes → Install Add-on From File**.

## Run tests

```bash
npm test
```

## Protocol

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for request/response envelopes, transport endpoints and supported operations.

## Contributing

Bug reports, protocol adapters, additional tests and compatibility fixes are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please read [SECURITY.md](SECURITY.md) before exposing any host implementation beyond localhost. The extension is intentionally designed around a local-only transport.

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

This project is independent and is not affiliated with or endorsed by Mozilla or the Thunderbird project.
