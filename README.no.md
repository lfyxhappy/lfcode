<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode-logo">
    </picture>
  </a>
</p>
<p align="center">En åpen kildekode AI-kodingsagent bygget på opencode.</p>
<p align="center">Beholder historisk kompatibilitet, samtidig som den utvider sesjonsstyring, Skills og GitHub Action-integrasjon.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Siste utgivelse" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Byggestatus" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> Denne lokaliserte README-en speiler den nåværende tilstanden i Lfcode-repositoriet, slik at nedlastingslenker, utgivelsesfiler og kompatibilitetsnotater holder seg riktige.

### Oversikt

Lfcode er et Bun workspace-monorepo som er bygget videre på opencode. Det bevarer den historiske kompatibiliteten og leverer fortsatt Lfcode-branding, en skrivebordsapp, et nettgrensesnitt, et SDK og GitHub Action-støtte.

### Høydepunkter

- Mer komplett sesjonsstyring: liste, status, opprette, oppdatere, slette, forke, dele, oppheve deling, oppsummere, komprimere, diff, revert og unrevert.
- Flere interaksjonsmåter: sende meldinger, asynkron `prompt`, `shell`, kommandoer og prediksjon av neste prompt.
- Skills-administrasjon: lokal Skills-liste, oppdagelse, installasjon, import, oppretting, oppdatering og katalogvisning.
- GitHub Action-integrasjon: start automatisert arbeid fra issue- eller PR-kommentarer med `/lfcode`, `/opencode` eller `/oc`.
- Historisk kompatibilitet: behold `opencode` CLI-kommandoen, `LFCODE_*`-miljøvariablene og `lfcode://`-protokollen.

### Installasjon

Offentlige nedlastinger publiseres på [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases)-siden.

- Desktop: den nåværende release-pipelinen publiserer et Windows-installasjonsprogram med navnet `lfcode-win-x64.exe`.
- Kilde: bruk Bun fra repoets rot for lokal utvikling.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Kompatibilitet

Noen runtime-identifikatorer bruker fortsatt det historiske navnet `opencode` av hensyn til kompatibilitet.

- CLI-kommando: `opencode`
- Konfigurasjonsmappe: `~/.lfcode`
- Miljøvariabler: `LFCODE_*`
- Desktop-protokollskjema: `lfcode://`

### Repositoriets struktur

- `packages/lfcode`: kjerneløpetid og sesjonsmotor
- `packages/app`: web-UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: delte UI-komponenter
- `packages/sdk/js`: JavaScript SDK

### Dokumentasjon

Den nåværende dokumentasjonskilden ligger i [packages/web/src/content/docs](packages/web/src/content/docs).

### Validering

Kjør hovedkontrollene fra workspace-roten:

```bash
bun run lint
bun run typecheck
```

### Støtte

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
