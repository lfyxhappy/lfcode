<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>ローカルファーストでオープンソースの AI コーディングワークスペース。</strong></p>
<p align="center">チャット、コード編集、ターミナル、ブラウザー、Skills、ワークフロー自動化を 1 つのデスクトップ環境にまとめます。</p>
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

## 主な価値

LFCODE は開発フロー全体を 1 か所に集約します。

- **セッション** — 長い会話を整理し、作業を再開し、タスクごとの履歴を確認できます。
- **エディターとターミナル** — ワークスペースを離れずに、変更、コマンド、実行結果を行き来できます。
- **ブラウザーと自動化** — 同じコンテキストからブラウザー操作や反復タスクを実行できます。
- **Skills と拡張** — Skills、MCP、プラグイン、独自ツールで機能を拡張できます。

## 機能プレビュー

以下は 4 つの主要領域のプレビューです。今後、実際のスクリーンショットに置き換えます。

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>セッション</strong></td>
    <td align="center"><strong>エディターとターミナル</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>ブラウザーと自動化</strong></td>
    <td align="center"><strong>Skills と拡張</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## クイックスタート

### Windows へのインストール

[Releases](https://github.com/lfyxhappy/lfcode/releases) を開き、最新リリースの `lfcode-win-x64.exe` をダウンロードしてインストーラーを実行します。

### メインコマンド

`lfcode` が正式な CLI コマンドです。

```bash
lfcode
lfcode --help
```

### ソースから実行

ローカル開発には Bun が必要です。ターミナルで次を実行します。

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## アーキテクチャと拡張性

このリポジトリは Bun workspace の monorepo です。コアは `packages/lfcode`、Web UI は `packages/app`、Electron ホストは `packages/desktop`、共有 UI は `packages/ui`、JavaScript SDK は `packages/sdk/js` にあります。Skills、MCP ツール、プラグイン、コマンド、自動化ワークフローで LFCODE を拡張できます。

## 互換性

従来のワークフローを維持するため、一部の歴史的な識別子と `opencode` エイリアスは引き続き利用できます。新しいドキュメントと日常利用では LFCODE 名と `lfcode` コマンドを使用してください。

## コントリビューションとサポート

コントリビューションを歓迎します。不具合や提案は [Issues](https://github.com/lfyxhappy/lfcode/issues)、ダウンロードと変更内容は [Releases](https://github.com/lfyxhappy/lfcode/releases) をご覧ください。

LFCODE は [MIT License](LICENSE) で公開されています。
