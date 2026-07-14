<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Et lokal-først, åpen kildekode-basert AI-arbeidsområde for koding.</strong></p>
<p align="center">Samle samtaler, koderedigering, terminal, nettleser, Skills og automatisering i ett skrivebordsmiljø.</p>
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

## Kjerneverdier

LFCODE holder hele utviklingsflyten samlet på ett sted:

- **Økter** — Organiser lange samtaler, fortsett arbeidet og se historikken for hver oppgave.
- **Editor og terminal** — Bytt mellom endringer, kommandoer og resultater uten å forlate arbeidsområdet.
- **Nettleser og automatisering** — Kjør nettleserflyter og gjentakbare oppgaver i samme kontekst.
- **Skills og utvidelser** — Utvid funksjonene med Skills, MCP, programtillegg og egne verktøy.

## Forhåndsvisning

Disse visningene representerer de fire hovedområdene og erstattes senere med ekte skjermbilder.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Økter</strong></td>
    <td align="center"><strong>Editor og terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Nettleser og automatisering</strong></td>
    <td align="center"><strong>Skills og utvidelser</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Hurtigstart

### Installasjon på Windows

Åpne [Releases](https://github.com/lfyxhappy/lfcode/releases), last ned `lfcode-win-x64.exe` fra nyeste utgave, og kjør installasjonsprogrammet.

### Hovedkommando

`lfcode` er den offisielle CLI-kommandoen:

```bash
lfcode
lfcode --help
```

### Kjør fra kildekode

Lokal utvikling krever Bun. Kjør i terminalen:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Arkitektur og utvidelser

Repoet er et Bun workspace-monorepo. Kjernen ligger i `packages/lfcode`, webgrensesnittet i `packages/app`, Electron-verten i `packages/desktop`, delt UI i `packages/ui` og JavaScript-SDK-et i `packages/sdk/js`. LFCODE kan utvides med Skills, MCP-verktøy, programtillegg, kommandoer og automatisering.

## Kompatibilitet

For å holde eldre arbeidsflyter i gang støttes fortsatt enkelte historiske identifikatorer og aliaset `opencode`. Bruk navnet LFCODE og kommandoen `lfcode` i ny dokumentasjon og daglig bruk.

## Bidrag og støtte

Bidrag er velkomne. Bruk [Issues](https://github.com/lfyxhappy/lfcode/issues) for feil og forslag, og se [Releases](https://github.com/lfyxhappy/lfcode/releases) for nedlastinger og endringer.

LFCODE publiseres under [MIT-lisensen](LICENSE).
