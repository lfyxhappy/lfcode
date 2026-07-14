<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Lokalne, otwartoźródłowe środowisko programistyczne z AI.</strong></p>
<p align="center">Połącz rozmowy, edycję kodu, terminal, przeglądarkę, Skills i automatyzację w jednym środowisku desktopowym.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases">Download</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="https://github.com/lfyxhappy/lfcode/issues">Issues</a>
</p>

<p align="center">
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zh.md">简体中文（备用）</a> |
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

## Najważniejsze zalety

LFCODE skupia cały proces tworzenia oprogramowania w jednym miejscu:

- **Sesje** — Porządkuj długie rozmowy, wznawiaj pracę i przeglądaj historię każdego zadania.
- **Edytor i terminal** — Przechodź między zmianami, poleceniami i wynikami bez opuszczania środowiska.
- **Przeglądarka i automatyzacja** — Uruchamiaj przepływy przeglądarki i powtarzalne zadania w tym samym kontekście.
- **Skills i rozszerzenia** — Rozszerzaj możliwości przez Skills, MCP, wtyczki i własne narzędzia.

## Podgląd funkcji

Te podglądy przedstawiają cztery główne obszary i zostaną później zastąpione prawdziwymi zrzutami ekranu.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sesje</strong></td>
    <td align="center"><strong>Edytor i terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Przeglądarka i automatyzacja</strong></td>
    <td align="center"><strong>Skills i rozszerzenia</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Szybki start

### Instalacja w Windows

Otwórz [Releases](https://github.com/lfyxhappy/lfcode/releases), pobierz `lfcode-win-x64.exe` z najnowszej wersji i uruchom instalator.

### Główne polecenie

`lfcode` jest oficjalnym poleceniem CLI:

```bash
lfcode
lfcode --help
```

### Uruchamianie ze źródeł

Lokalne środowisko programistyczne wymaga Bun. Uruchom w terminalu:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Architektura i rozszerzalność

Repozytorium jest monorepo Bun. Runtime znajduje się w `packages/lfcode`, interfejs webowy w `packages/app`, host Electron w `packages/desktop`, wspólne UI w `packages/ui`, a JavaScript SDK w `packages/sdk/js`. LFCODE można rozszerzać przez Skills, narzędzia MCP, wtyczki, polecenia i automatyzację.

## Zgodność

Aby zachować starsze przepływy pracy, nadal obsługiwane są niektóre historyczne identyfikatory i alias `opencode`. W nowej dokumentacji i codziennym użyciu korzystaj z nazwy LFCODE i polecenia `lfcode`.

## Współtworzenie i pomoc

Zapraszamy do współtworzenia. Błędy i propozycje zgłaszaj w [Issues](https://github.com/lfyxhappy/lfcode/issues), a pliki i zmiany znajdziesz w [Releases](https://github.com/lfyxhappy/lfcode/releases).

LFCODE jest udostępniany na [licencji MIT](LICENSE).
