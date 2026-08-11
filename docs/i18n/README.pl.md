# Thunderbird AI Bridge

[English / pełny spis języków](../../README.md)

## Co to jest?

Thunderbird AI Bridge to lokalny most między Thunderbirdem a agentami AI, narzędziami CLI, skryptami i własnymi aplikacjami. Rozszerzenie wykonuje operacje na poczcie, a lokalny program komunikuje się z nim przez prosty protokół HTTP na `127.0.0.1`.

**SuperCLI nie jest wymagany.** Pierwszy host powstał dla SuperCLI, ale dowolny program może korzystać z rozszerzenia, jeśli zaimplementuje protokół opisany w [docs/PROTOCOL.md](../PROTOCOL.md).

## Możliwości

- lista kont i folderów,
- tworzenie, zmiana nazwy i usuwanie folderów,
- wyszukiwanie po nadawcy, odbiorcy/adresie, temacie, treści i dacie,
- odczyt wiadomości bez celowej zmiany stanu przeczytana/nieprzeczytana,
- obsługa długich wiadomości stronami,
- lista i pobieranie załączników dla modeli vision lub parserów dokumentów,
- przenoszenie wiadomości, Kosz i przywracanie,
- trwałe usuwanie z weryfikacją IMAP,
- natywne Empty Trash/EXPUNGE Thunderbirda,
- import wiadomości Outlook `.msg` po konwersji do `.eml`,
- operacje masowe w ograniczonych partiach z tokenem kontynuacji.

## Bezpieczeństwo

Operacje zmieniające lub usuwające dane mają dodatkowe zabezpieczenia. Wrażliwe akcje wymagają `confirm: true`, trwałe usuwanie jest ograniczone do Kosza, a foldery systemowe/root są chronione. Host powinien również zawsze uzyskać zgodę użytkownika przed operacją destrukcyjną.

Bridge jest projektowany do pracy lokalnej. Nie wystawiaj jego hosta bezpośrednio do sieci LAN ani Internetu.

## Budowanie

Wymagany jest Thunderbird 128 lub nowszy. Aby zbudować XPI:

```bash
python scripts/build_xpi.py
```

Gotowy plik pojawi się jako `dist/thunderbird-ai-bridge.xpi`. Można go ręcznie zainstalować w Thunderbirdzie przez **Dodatki i motywy → Zainstaluj dodatek z pliku**.

Testy:

```bash
npm test
```

Projekt jest eksperymentalny (`0.9.18`) i protokół może się jeszcze zmienić przed wersją `1.0`.

Licencja: MIT. Projekt jest niezależny i nie jest oficjalnym produktem Mozilli ani Thunderbirda.
