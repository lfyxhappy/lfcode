# Lfcode

<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">An open-source AI coding agent built on top of opencode.</p>
<p align="center">It keeps the historical compatibility surface while adding richer session management, Skills management, and GitHub Action integration.</p>
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

> This README reflects the current Lfcode repository state so download links, release assets, and compatibility notes stay accurate.

### Overview

Lfcode is a Bun workspace monorepo that evolved from opencode. It keeps the historical compatibility surface while continuing to ship Lfcode branding, a desktop app, a web UI, an SDK, and GitHub Action support.

### Highlights

- Rich session management: list, status, create, update, delete, fork, share, unshare, summarize, compact, diff, revert, and unrevert.
- Multiple interaction modes: message sending, async `prompt`, `shell`, commands, and next-prompt prediction.
- Skills management: local Skills listing, discovery, installation, import, creation, refresh, and directory inspection.
- GitHub Action integration: trigger automated work from issue or PR comments with `/lfcode`, `/opencode`, or `/oc`.
- Historical compatibility: keep the `opencode` CLI command, `LFCODE_*` environment variables, and the `lfcode://` protocol.

### Installation

Public downloads are published on the [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) page.

- Desktop: the current release pipeline publishes a Windows installer named `lfcode-win-x64.exe`.
- Source: use Bun from the repo root for local development.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Compatibility

Several runtime identifiers still use the historical `opencode` name for compatibility.

- CLI command: `opencode`
- Config directory: `~/.lfcode`
- Environment variables: `LFCODE_*`
- Desktop protocol scheme: `lfcode://`

### Repository Layout

- `packages/lfcode`: core runtime and session engine
- `packages/app`: web UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: shared UI components
- `packages/sdk/js`: JavaScript SDK

### Documentation

The current docs source lives in [packages/web/src/content/docs](packages/web/src/content/docs).

### Validation

Run the main repository checks from the workspace root:

```bash
bun run lint
bun run typecheck
```

### Support

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
