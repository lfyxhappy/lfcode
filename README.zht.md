<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">開源 AI 編碼代理。</p>
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

> 這份在地化 README 已依照目前的 Lfcode 倉庫狀態同步，確保下載連結、發佈資產與相容性說明保持準確。

### 總覽

Lfcode 是一個從 opencode 發展而來的 Bun workspace monorepo。它保留歷史相容入口，同時持續提供 Lfcode 品牌、桌面應用、Web UI、SDK 與 GitHub Action 支援。

### 特色功能

- 更完整的 session 管理：列表、狀態、建立、更新、刪除、fork、分享、取消分享、摘要、壓縮、diff、revert 與 unrevert。
- 更多互動方式：傳送訊息、非同步 `prompt`、`shell`、命令與下一個 prompt 預測。
- Skills 管理：本機 Skills 列表、探索、安裝、匯入、建立、重新整理與目錄檢視。
- GitHub Action 整合：可在 issue 或 PR 留言中使用 `/lfcode`、`/opencode` 或 `/oc` 觸發自動處理。
- 歷史相容性：保留 `opencode` CLI 指令、`LFCODE_*` 環境變數與 `lfcode://` 協定。

### 安裝

公開下載會發佈在 [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) 頁面。

- 桌面版：目前的發佈流程會產生名為 `lfcode-win-x64.exe` 的 Windows 安裝程式。
- 原始碼：在倉庫根目錄使用 Bun 進行本機開發。

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### 相容性

部分執行期識別仍保留歷史 `opencode` 命名，以便相容舊工作流程。

- CLI 指令：`opencode`
- 設定目錄：`~/.lfcode`
- 環境變數：`LFCODE_*`
- 桌面協定：`lfcode://`

### 倉庫結構

- `packages/lfcode`：核心執行階段與 session 引擎
- `packages/app`：Web UI
- `packages/desktop`：Electron 桌面主程式
- `packages/ui`：共用 UI 元件
- `packages/sdk/js`：JavaScript SDK

### 文件

目前文件來源位於 [packages/web/src/content/docs](packages/web/src/content/docs)。

### 驗證

在 workspace 根目錄執行主要檢查：

```bash
bun run lint
bun run typecheck
```

### 支援

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
