<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>本地优先的开源 AI 编程工作台。</strong></p>
<p align="center">把对话、代码编辑、终端、浏览器、Skills 与自动化工作流带进同一个桌面环境。</p>
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

## 核心价值

LFCODE 把完整的开发流程集中在一个工作台中：

- **会话** — 组织长对话、继续未完成任务，并清晰回看每项工作的上下文。
- **代码编辑与终端** — 无需离开工作台，即可在修改、命令和运行结果之间切换。
- **浏览器与自动化** — 在同一上下文里执行浏览器流程和可重复的自动化任务。
- **Skills 与扩展** — 通过 Skills、MCP、插件和自定义工具扩展工作方式。

## 功能展示

以下占位图对应四项核心能力，后续将替换为真实产品截图。

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>会话</strong></td>
    <td align="center"><strong>代码编辑与终端</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>浏览器与自动化</strong></td>
    <td align="center"><strong>Skills 与扩展</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## 快速开始

### Windows 安装

打开 [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases)，下载最新版本中的 `lfcode-win-x64.exe`，然后运行安装程序。

### 主命令

`lfcode` 是正式的命令行入口：

```bash
lfcode
lfcode --help
```

### 从源码启动

本地开发需要 Bun。在终端中运行：

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## 架构与扩展能力

仓库采用 Bun workspace monorepo：核心运行时位于 `packages/lfcode`，Web UI 位于 `packages/app`，Electron 桌面宿主位于 `packages/desktop`，共享 UI 位于 `packages/ui`，JavaScript SDK 位于 `packages/sdk/js`。LFCODE 可通过 Skills、MCP 工具、插件、命令和自动化工作流继续扩展。

## 兼容说明

为保持旧工作流可用，部分历史标识和 `opencode` 兼容别名仍然保留。新文档和日常使用应优先采用 LFCODE 品牌与 `lfcode` 主命令。

## 贡献与支持

欢迎参与贡献。请通过 [Issues](https://github.com/lfyxhappy/lfcode/issues) 报告问题或提出建议，通过 [Releases](https://github.com/lfyxhappy/lfcode/releases) 获取下载和版本变更。

LFCODE 采用 [MIT License](LICENSE) 开源。
