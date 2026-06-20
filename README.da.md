<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">Den open source AI-kodningsagent.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> Denne README afspejler den nuværende tilstand i Lfcode-repositoriet, så downloadlinks, release-artefakter og kompatibilitetsnoter forbliver korrekte.

### Oversigt

Lfcode er et Bun workspace-monorepo, der er vokset ud af opencode. Det bevarer den historiske kompatibilitet og leverer stadig Lfcode-branding, en desktop-app, en web-UI, et SDK og GitHub Action-support.

### Højdepunkter

- Mere komplet sessionsstyring: liste, status, oprette, opdatere, slette, forgrene, dele, fjerne deling, opsummere, komprimere, diff, revert og unrevert.
- Flere interaktionsformer: afsendelse af beskeder, asynkron `prompt`, `shell`, kommandoer og forudsigelse af næste prompt.
- Skills-administration: lokale Skills-lister, opdagelse, installation, import, oprettelse, opdatering og mappekontrol.
- GitHub Action-integration: start automatiseret arbejde fra issue- eller PR-kommentarer med `/lfcode`, `/opencode` eller `/oc`.
- Historisk kompatibilitet: behold `opencode` CLI-kommandoen, `LFCODE_*` miljøvariablerne og `lfcode://`-protokollen.

### Installation

Offentlige downloads publiceres på [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases)-siden.

- Desktop: den nuværende release-pipeline udgiver et Windows-installationsprogram med navnet `lfcode-win-x64.exe`.
- Kilde: brug Bun fra repoets rod til lokal udvikling.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Kompatibilitet

Nogle runtime-identifikatorer bruger stadig det historiske navn `opencode` af hensyn til kompatibilitet.

- CLI-kommando: `opencode`
- Konfigurationsmappe: `~/.lfcode`
- Miljøvariabler: `LFCODE_*`
- Desktop-protokolskema: `lfcode://`

### Repositoriets struktur

- `packages/lfcode`: kerneruntime og sessionsmotor
- `packages/app`: web-UI
- `packages/desktop`: Electron desktop-host
- `packages/ui`: delte UI-komponenter
- `packages/sdk/js`: JavaScript SDK

### Dokumentation

Den aktuelle dokumentationskilde ligger i [packages/web/src/content/docs](packages/web/src/content/docs).

### Validering

Kør de vigtigste kontroller fra workspace-roden:

```bash
bun run lint
bun run typecheck
```

### Support

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
