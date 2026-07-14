<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE" width="620">
    </picture>
  </a>
</p>

<h3 align="center">A local-first, open-source AI coding workspace.</h3>
<p align="center">Bring chat, code editing, terminal, browser, skills, and automation into one desktop environment.</p>

<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Release" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square"></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?branch=dev&style=flat-square&label=build"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases/latest">Download</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="https://github.com/lfyxhappy/lfcode/issues">Issues</a>
</p>

<p align="center">
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zh.md">中文</a> |
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

---

## One workspace for the whole development loop

- **Sessions** organize ongoing AI collaboration, surface status, diffs, and history, and keep context clear across tasks.
- **Editor & terminal** bring code reading, editing, and command execution together so conversations lead to verifiable results.
- **Browser & automation** connect page interaction, debugging, and validation to agent workflows, from implementation through real UI checks.
- **Skills & extensions** combine local skills, MCP, plugins, and the SDK into a toolchain tailored to each project.

## Product previews

These are intentionally labeled visual placeholders. Real product previews are coming soon.

<table>
  <tr>
    <td width="50%" align="center">
      <img src=".github/readme/preview-sessions.svg" alt="Sessions — Preview coming soon" width="100%"><br>
      <strong>Sessions</strong>
    </td>
    <td width="50%" align="center">
      <img src=".github/readme/preview-editor-terminal.svg" alt="Editor & Terminal — Preview coming soon" width="100%"><br>
      <strong>Editor & Terminal</strong>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src=".github/readme/preview-browser-automation.svg" alt="Browser Automation — Preview coming soon" width="100%"><br>
      <strong>Browser Automation</strong>
    </td>
    <td width="50%" align="center">
      <img src=".github/readme/preview-skills-extensions.svg" alt="Skills & Extensions — Preview coming soon" width="100%"><br>
      <strong>Skills & Extensions</strong>
    </td>
  </tr>
</table>

## Quick start

### Windows desktop

Open [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases/latest), download `lfcode-win-x64.exe`, and follow the installer.

### Command line

The primary Lfcode command is:

```bash
lfcode
```

### Run from source

[Bun](https://bun.sh/) 1.3.11 is required. Clone the repository and run these commands from its root:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

Start the web UI or desktop development environment separately when needed:

```bash
bun run dev:web
bun run dev:desktop
```

## Architecture and extensibility

Lfcode is a Bun workspace monorepo:

- `packages/lfcode`: core runtime, CLI, and session engine
- `packages/app`: web application UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: shared UI components
- `packages/plugin`: plugin interfaces
- `packages/sdk/js`: JavaScript SDK

Project-scoped config, skills, commands, themes, plugins, and tools can live under `.lfcode/` for composable, reusable workflows. Before contributing, run the main checks from the repository root:

```bash
bun run lint
bun run typecheck
```

## Compatibility

Lfcode evolved from the opencode project. Some historical entry points remain available as compatibility aliases for existing configurations and automation; new documentation, scripts, and everyday usage should prefer the `lfcode` command and `LFCODE_*` environment variables.

## Contributing

- Report bugs and request features in [Issues](https://github.com/lfyxhappy/lfcode/issues).
- Find published builds and release notes in [Releases](https://github.com/lfyxhappy/lfcode/releases).
- Pull requests are welcome; checking existing issues first helps avoid duplicate work.

Lfcode is released under the [MIT License](LICENSE).
