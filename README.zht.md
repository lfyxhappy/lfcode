<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>本機優先的開源 AI 程式設計工作台。</strong></p>
<p align="center">把對話、程式碼編輯、終端機、瀏覽器、Skills 與自動化工作流程帶進同一個桌面環境。</p>
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

## 核心價值

LFCODE 把完整的開發流程集中在一個工作台中：

- **工作階段** — 整理長對話、繼續未完成的工作，並清楚檢視每項任務的歷史。
- **程式碼編輯與終端機** — 不必離開工作台，即可在修改、命令與執行結果之間切換。
- **瀏覽器與自動化** — 在同一個上下文中執行瀏覽器流程與可重複的自動化任務。
- **Skills 與擴充** — 透過 Skills、MCP、外掛與自訂工具擴充工作方式。

## 功能展示

以下預覽圖對應四項核心能力，後續將替換為實際產品畫面。

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>工作階段</strong></td>
    <td align="center"><strong>程式碼編輯與終端機</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>瀏覽器與自動化</strong></td>
    <td align="center"><strong>Skills 與擴充</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## 快速開始

### Windows 安裝

開啟 [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases)，下載最新版本中的 `lfcode-win-x64.exe`，然後執行安裝程式。

### 主要命令

`lfcode` 是正式的命令列入口：

```bash
lfcode
lfcode --help
```

### 從原始碼啟動

本機開發需要 Bun。請在終端機執行：

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## 架構與擴充能力

儲存庫採用 Bun workspace monorepo：核心執行階段位於 `packages/lfcode`，Web UI 位於 `packages/app`，Electron 桌面宿主位於 `packages/desktop`，共用 UI 位於 `packages/ui`，JavaScript SDK 位於 `packages/sdk/js`。LFCODE 可透過 Skills、MCP 工具、外掛、命令與自動化工作流程繼續擴充。

## 相容性說明

為了讓舊工作流程繼續運作，部分歷史識別碼與 `opencode` 相容別名仍予以保留。新文件與日常使用應優先採用 LFCODE 品牌及 `lfcode` 主要命令。

## 貢獻與支援

歡迎參與貢獻。請透過 [Issues](https://github.com/lfyxhappy/lfcode/issues) 回報問題或提出建議，並從 [Releases](https://github.com/lfyxhappy/lfcode/releases) 取得下載與版本變更。

LFCODE 依 [MIT License](LICENSE) 開源。
