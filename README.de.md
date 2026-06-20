<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">Der Open-Source-KI-Coding-Agent.</p>
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

> Diese README spiegelt den aktuellen Stand des Lfcode-Repositories wider, damit Download-Links, Release-Artefakte und Kompatibilitätshinweise korrekt bleiben.

### Überblick

Lfcode ist ein Bun-Workspace-Monorepo, das aus opencode hervorgegangen ist. Es behält die historische Kompatibilität bei und liefert weiterhin das Lfcode-Branding, eine Desktop-App, eine Web-UI, ein SDK und GitHub-Action-Unterstützung.

### Highlights

- Umfassende Sitzungsverwaltung: Listen, Status, Erstellen, Aktualisieren, Löschen, Forken, Teilen, Freigabe aufheben, Zusammenfassen, Komprimieren, Diff, Revert und Unrevert.
- Mehrere Interaktionsmodi: Nachrichten senden, asynchrones `prompt`, `shell`, Befehle und Vorhersage der nächsten Eingabe.
- Skills-Verwaltung: lokale Skills auflisten, entdecken, installieren, importieren, erstellen, aktualisieren und Verzeichnisse prüfen.
- GitHub-Action-Integration: automatisierte Arbeit über Issue- oder PR-Kommentare mit `/lfcode`, `/opencode` oder `/oc` auslösen.
- Historische Kompatibilität: den `opencode`-CLI-Befehl, `LFCODE_*`-Umgebungsvariablen und das `lfcode://`-Protokoll beibehalten.

### Installation

Öffentliche Downloads werden auf der [GitHub-Releases](https://github.com/lfyxhappy/lfcode/releases) Seite veröffentlicht.

- Desktop: Die aktuelle Release-Pipeline veröffentlicht einen Windows-Installer namens `lfcode-win-x64.exe`.
- Quelle: Verwende Bun im Repository-Stamm für die lokale Entwicklung.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Kompatibilität

Mehrere Laufzeitbezeichner verwenden aus Kompatibilitätsgründen weiterhin den historischen Namen `opencode`.

- CLI-Befehl: `opencode`
- Konfigurationsverzeichnis: `~/.lfcode`
- Umgebungsvariablen: `LFCODE_*`
- Desktop-Protokollschema: `lfcode://`

### Repository-Struktur

- `packages/lfcode`: Kernlaufzeit und Sitzungs-Engine
- `packages/app`: Web-UI
- `packages/desktop`: Electron-Desktop-Host
- `packages/ui`: gemeinsame UI-Komponenten
- `packages/sdk/js`: JavaScript-SDK

### Dokumentation

Die aktuelle Dokumentationsquelle befindet sich in [packages/web/src/content/docs](packages/web/src/content/docs).

### Validierung

Führe die Hauptprüfungen des Repositories im Workspace-Stamm aus:

```bash
bun run lint
bun run typecheck
```

### Support

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)