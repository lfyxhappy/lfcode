<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">オープンソースの AI コーディングエージェント。</p>
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

> この README は現在の Lfcode リポジトリの状態を反映しており、ダウンロードリンク、リリース成果物、互換性メモが常に正しい状態になるようにしています。

### 概要

Lfcode は opencode から発展した Bun workspace ベースの monorepo です。従来の互換性を維持しつつ、Lfcode のブランド、デスクトップアプリ、Web UI、SDK、GitHub Action 連携を提供します。

### 主な機能

- セッション管理の強化: 一覧、状態確認、作成、更新、削除、fork、共有、共有解除、要約、圧縮、diff、revert、unrevert をサポート。
- 複数の操作モード: メッセージ送信、非同期 `prompt`、`shell`、コマンド、次のプロンプト予測。
- Skills 管理: ローカル Skills の一覧、発見、インストール、import、作成、更新、ディレクトリ確認。
- GitHub Action 連携: Issue や PR のコメントから `/lfcode`、`/opencode`、`/oc` で自動処理を開始。
- 歴史的互換性: `opencode` CLI コマンド、`LFCODE_*` 環境変数、`lfcode://` プロトコルを維持。

### インストール

公開ダウンロードは [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) ページで公開されています。

- デスクトップ: 現在のリリースパイプラインは `lfcode-win-x64.exe` という Windows インストーラーを公開します。
- ソース: ローカル開発ではリポジトリのルートから Bun を使ってください。

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### 互換性

互換性のため、いくつかの実行時識別子は今も歴史的な `opencode` 名を使用しています。

- CLI コマンド: `opencode`
- 設定ディレクトリ: `~/.lfcode`
- 環境変数: `LFCODE_*`
- デスクトップのプロトコルスキーム: `lfcode://`

### リポジトリ構成

- `packages/lfcode`: コア実行基盤とセッションエンジン
- `packages/app`: Web UI
- `packages/desktop`: Electron デスクトップホスト
- `packages/ui`: 共通 UI コンポーネント
- `packages/sdk/js`: JavaScript SDK

### ドキュメント

現在のドキュメントソースは [packages/web/src/content/docs](packages/web/src/content/docs) にあります。

### 検証

ワークスペースのルートから主要なチェックを実行してください:

```bash
bun run lint
bun run typecheck
```

### サポート

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)