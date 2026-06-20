<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Logo Lfcode">
    </picture>
  </a>
</p>
<p align="center">Open-source’owy agent AI do kodowania zbudowany na opencode.</p>
<p align="center">Zachowuje historyczną zgodność, jednocześnie rozszerzając zarządzanie sesjami, Skills i integrację z GitHub Action.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Najnowsze wydanie" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Status buildu" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Lfcode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/lfyxhappy/lfcode)

---

> To zlokalizowane README odzwierciedla aktualny stan repozytorium Lfcode, aby linki do pobierania, pliki wydań i uwagi o zgodności pozostawały poprawne.

### Przegląd

Lfcode to monorepo Bun workspace zbudowane na bazie opencode. Zachowuje historyczną zgodność i nadal dostarcza branding Lfcode, aplikację desktopową, interfejs webowy, SDK oraz wsparcie dla GitHub Action.

### Najważniejsze funkcje

- Bardziej kompletne zarządzanie sesjami: lista, status, tworzenie, aktualizacja, usuwanie, fork, udostępnianie, cofanie udostępnienia, podsumowanie, kompresja, diff, revert i unrevert.
- Więcej sposobów interakcji: wysyłanie wiadomości, asynchroniczny `prompt`, `shell`, komendy i prognoza następnego promptu.
- Zarządzanie Skills: lokalna lista Skills, wykrywanie, instalacja, import, tworzenie, odświeżanie i podgląd katalogów.
- Integracja z GitHub Action: uruchamianie automatycznej pracy z komentarzy issue lub PR za pomocą `/lfcode`, `/opencode` lub `/oc`.
- Historyczna zgodność: zachowano komendę CLI `opencode`, zmienne środowiskowe `LFCODE_*` i protokół `lfcode://`.

### Instalacja

Publiczne pliki do pobrania są publikowane na stronie [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: obecny pipeline wydawniczy publikuje instalator Windows o nazwie `lfcode-win-x64.exe`.
- Źródło: użyj Bun z katalogu głównego repozytorium do lokalnego rozwoju.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Zgodność

Niektóre identyfikatory runtime nadal używają historycznej nazwy `opencode` ze względu na zgodność.

- Komenda CLI: `opencode`
- Katalog konfiguracji: `~/.lfcode`
- Zmienne środowiskowe: `LFCODE_*`
- Schemat protokołu desktop: `lfcode://`

### Struktura repozytorium

- `packages/lfcode`: główny runtime i silnik sesji
- `packages/app`: web UI
- `packages/desktop`: host desktopowy Electron
- `packages/ui`: współdzielone komponenty UI
- `packages/sdk/js`: SDK JavaScript

### Dokumentacja

Aktualne źródło dokumentacji znajduje się w [packages/web/src/content/docs](packages/web/src/content/docs).

### Weryfikacja

Uruchom główne kontrole z katalogu głównego workspace:

```bash
bun run lint
bun run typecheck
```

### Wsparcie

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
