<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">L'agente di coding AI open source.</p>
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

> Questo README riflette lo stato attuale del repository Lfcode, così i link di download, gli asset di release e le note di compatibilità restano corretti.

### Panoramica

Lfcode è un monorepo Bun workspace evoluto da opencode. Mantiene la superficie di compatibilità storica e continua a offrire il brand Lfcode, un'app desktop, una UI web, un SDK e il supporto a GitHub Action.

### Punti chiave

- Gestione delle sessioni più completa: elenco, stato, creazione, aggiornamento, eliminazione, fork, condivisione, rimozione della condivisione, riepilogo, compact, diff, revert e unrevert.
- Più modalità di interazione: invio di messaggi, `prompt` asincrono, `shell`, comandi e previsione del prompt successivo.
- Gestione degli Skills: elenco locale, discovery, installazione, importazione, creazione, refresh e controllo delle directory.
- Integrazione GitHub Action: avvia lavoro automatico da commenti su issue o PR con `/lfcode`, `/opencode` o `/oc`.
- Compatibilità storica: mantiene il comando CLI `opencode`, le variabili d'ambiente `LFCODE_*` e il protocollo `lfcode://`.

### Installazione

I download pubblici sono pubblicati nella pagina [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: l'attuale pipeline di release pubblica un installer Windows chiamato `lfcode-win-x64.exe`.
- Sorgente: usa Bun dalla root del repository per lo sviluppo locale.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Compatibilità

Alcuni identificatori di runtime usano ancora il nome storico `opencode` per compatibilità.

- Comando CLI: `opencode`
- Directory di configurazione: `~/.lfcode`
- Variabili d'ambiente: `LFCODE_*`
- Schema protocollo desktop: `lfcode://`

### Struttura del repository

- `packages/lfcode`: runtime principale e motore di sessione
- `packages/app`: UI web
- `packages/desktop`: host desktop Electron
- `packages/ui`: componenti UI condivisi
- `packages/sdk/js`: SDK JavaScript

### Documentazione

La fonte attuale della documentazione si trova in [packages/web/src/content/docs](packages/web/src/content/docs).

### Verifica

Esegui i controlli principali dalla root del workspace:

```bash
bun run lint
bun run typecheck
```

### Supporto

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
