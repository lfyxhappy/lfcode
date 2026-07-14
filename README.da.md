<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Et local-first, open source AI-kodningsworkspace.</strong></p>
<p align="center">Saml samtaler, kodeeditor, terminal, browser, Skills og automatisering i ét desktopmiljø.</p>
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

## Kernefordele

LFCODE samler hele udviklingsflowet ét sted:

- **Sessioner** — Organisér lange samtaler, genoptag arbejdet, og følg historikken for hver opgave.
- **Kodeeditor og terminal** — Skift mellem ændringer, kommandoer og resultater uden at forlade workspacet.
- **Browser og automatisering** — Kør browserflows og gentagelige opgaver fra den samme kontekst.
- **Skills og udvidelser** — Udvid funktionaliteten med Skills, MCP, plugins og egne værktøjer.

## Funktionsvisning

Disse visninger repræsenterer de fire hovedområder og erstattes senere af rigtige skærmbilleder.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sessioner</strong></td>
    <td align="center"><strong>Kodeeditor og terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Browser og automatisering</strong></td>
    <td align="center"><strong>Skills og udvidelser</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Kom hurtigt i gang

### Installation på Windows

Åbn [Releases](https://github.com/lfyxhappy/lfcode/releases), hent `lfcode-win-x64.exe` fra den nyeste udgivelse, og kør installationsprogrammet.

### Primær kommando

`lfcode` er den officielle CLI-kommando:

```bash
lfcode
lfcode --help
```

### Kør fra kildekoden

Lokal udvikling kræver Bun. Kør følgende i terminalen:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Arkitektur og udvidelser

Repositoryet er et Bun workspace-monorepo. Kernen ligger i `packages/lfcode`, web-UI i `packages/app`, Electron-værten i `packages/desktop`, fælles UI i `packages/ui` og JavaScript-SDK'et i `packages/sdk/js`. LFCODE kan udvides med Skills, MCP-værktøjer, plugins, kommandoer og automatisering.

## Kompatibilitet

For at bevare ældre workflows understøttes visse historiske identifikatorer og aliasset `opencode` fortsat. Brug navnet LFCODE og kommandoen `lfcode` i ny dokumentation og daglig brug.

## Bidrag og support

Bidrag er velkomne. Brug [Issues](https://github.com/lfyxhappy/lfcode/issues) til fejl og forslag, og se [Releases](https://github.com/lfyxhappy/lfcode/releases) for downloads og ændringer.

LFCODE udgives under [MIT-licensen](LICENSE).
