<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Ein lokal ausgerichteter, quelloffener KI-Coding-Arbeitsbereich.</strong></p>
<p align="center">Vereint Chat, Codebearbeitung, Terminal, Browser, Skills und Automatisierung in einer Desktop-Umgebung.</p>
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

## Kernvorteile

LFCODE hält den gesamten Entwicklungsablauf an einem Ort:

- **Sitzungen** — Lange Unterhaltungen organisieren, Arbeit fortsetzen und den Verlauf jeder Aufgabe nachvollziehen.
- **Codeeditor und Terminal** — Zwischen Änderungen, Befehlen und Ergebnissen wechseln, ohne den Arbeitsbereich zu verlassen.
- **Browser und Automatisierung** — Browserabläufe und wiederholbare Aufgaben im selben Kontext ausführen.
- **Skills und Erweiterungen** — Funktionen mit Skills, MCP, Plugins und eigenen Werkzeugen erweitern.

## Funktionsvorschau

Diese Vorschauen zeigen die vier Kernbereiche und werden später durch echte Screenshots ersetzt.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sitzungen</strong></td>
    <td align="center"><strong>Codeeditor und Terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Browser und Automatisierung</strong></td>
    <td align="center"><strong>Skills und Erweiterungen</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Schnellstart

### Installation unter Windows

[Releases](https://github.com/lfyxhappy/lfcode/releases) öffnen, `lfcode-win-x64.exe` aus der neuesten Version herunterladen und das Installationsprogramm starten.

### Hauptbefehl

`lfcode` ist der offizielle CLI-Befehl:

```bash
lfcode
lfcode --help
```

### Aus dem Quellcode starten

Für die lokale Entwicklung wird Bun benötigt. Im Terminal ausführen:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Architektur und Erweiterbarkeit

Das Repository ist ein Bun-Workspace-Monorepo. Die Laufzeit liegt in `packages/lfcode`, die Weboberfläche in `packages/app`, der Electron-Host in `packages/desktop`, gemeinsame UI-Komponenten in `packages/ui` und das JavaScript-SDK in `packages/sdk/js`. LFCODE lässt sich mit Skills, MCP-Werkzeugen, Plugins, Befehlen und Automatisierungen erweitern.

## Kompatibilität

Damit ältere Abläufe funktionieren, bleiben einige historische Bezeichner und der Alias `opencode` unterstützt. Für neue Dokumentation und den täglichen Einsatz gelten der Name LFCODE und der Befehl `lfcode`.

## Mitwirken und Support

Beiträge sind willkommen. [Issues](https://github.com/lfyxhappy/lfcode/issues) dienen für Fehler und Vorschläge; [Releases](https://github.com/lfyxhappy/lfcode/releases) enthält Downloads und Änderungen.

LFCODE wird unter der [MIT-Lizenz](LICENSE) veröffentlicht.
