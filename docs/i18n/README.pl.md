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

## Parowanie (od 0.10.0)

Rozszerzenie łączy się tylko z hostem, z którym zostało sparowane. Robi się to raz:

1. W hoście (SuperCLI: *Ustawienia → Thunderbird → Paruj* albo `/thunderbird pair` w terminalu; NestCafe: *Ustawienia → Integracje → Thunderbird → Paruj*) pojawia się 16-znakowy kod ważny 5 minut.
2. W Thunderbirdzie: *Dodatki i motywy → Thunderbird AI Bridge → Opcje*, wpisz kod i kliknij **Paruj**.
3. Strona opcji pokazuje *Połączono* i nazwę hosta.

Obie strony uzgadniają wtedy 256-bitowy sekret (ECDH uwierzytelniony kodem). Każde połączenie jest uwierzytelniane w obie strony, a każda wiadomość podpisana (HMAC-SHA256 ze znacznikiem czasu i nonce). Inny program na porcie 47831 nic nie dostaje i nic nie może wykonać; strona opcji pokazuje wtedy, kto zajmuje port. Hosty sprzed protokołu 2 (SuperCLI 1.0.24 i starsze) nie współpracują z 0.10.0.

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

Projekt jest eksperymentalny (`0.10.0`, protokół 2 z parowaniem) i protokół może się jeszcze zmienić przed wersją `1.0`.

Licencja: MIT. Projekt jest niezależny i nie jest oficjalnym produktem Mozilli ani Thunderbirda.
