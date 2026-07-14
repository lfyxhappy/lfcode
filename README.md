<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE" width="620">
    </picture>
  </a>
</p>

<h3 align="center">本地优先的开源 AI 编程工作台</h3>
<p align="center">把对话、代码编辑、终端、浏览器、Skills 与自动化工作流带进同一个桌面环境。</p>

<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Release" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square"></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?branch=dev&style=flat-square&label=build"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases/latest">下载</a> ·
  <a href="#快速开始">快速开始</a> ·
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

## 一个工作台，贯穿完整开发流程

- **会话**：组织持续的 AI 协作，查看状态、Diff 和历史，并在不同任务之间保持上下文清晰。
- **代码编辑与终端**：在同一工作区阅读和修改代码、运行命令，让讨论直接落到可验证的结果。
- **浏览器与自动化**：把页面操作、调试和验证接入代理工作流，覆盖从实现到真实界面检查的闭环。
- **Skills 与扩展**：通过本地 Skills、MCP、插件和 SDK 组合适合项目的工具链与自动化能力。

## 功能展示

以下为统一视觉占位，真实产品预览将随后补充。

<table>
  <tr>
    <td width="50%" align="center">
      <img src=".github/readme/preview-sessions.svg" alt="Sessions — Preview coming soon" width="100%"><br>
      <strong>会话</strong>
    </td>
    <td width="50%" align="center">
      <img src=".github/readme/preview-editor-terminal.svg" alt="Editor & Terminal — Preview coming soon" width="100%"><br>
      <strong>编辑器与终端</strong>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src=".github/readme/preview-browser-automation.svg" alt="Browser Automation — Preview coming soon" width="100%"><br>
      <strong>浏览器自动化</strong>
    </td>
    <td width="50%" align="center">
      <img src=".github/readme/preview-skills-extensions.svg" alt="Skills & Extensions — Preview coming soon" width="100%"><br>
      <strong>Skills 与扩展</strong>
    </td>
  </tr>
</table>

## 快速开始

### Windows 桌面端

前往 [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases/latest)，下载 `lfcode-win-x64.exe` 并按安装向导完成安装。

### 命令行

Lfcode 的正式主命令是：

```bash
lfcode
```

### 从源码运行

需要 [Bun](https://bun.sh/) 1.3.11。克隆仓库后在根目录运行：

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

按需要也可以单独启动 Web UI 或桌面开发环境：

```bash
bun run dev:web
bun run dev:desktop
```

## 架构与扩展

Lfcode 是一个 Bun workspace monorepo：

- `packages/lfcode`：核心运行时、CLI 与会话引擎
- `packages/app`：Web 应用界面
- `packages/desktop`：Electron 桌面宿主
- `packages/ui`：共享 UI 组件
- `packages/plugin`：插件接口
- `packages/sdk/js`：JavaScript SDK

项目配置、Skills、命令、主题、插件和工具可以放在 `.lfcode/` 中，以便按工作区组合和复用。开发提交前可从仓库根目录运行：

```bash
bun run lint
bun run typecheck
```

## 兼容说明

Lfcode 从 opencode 项目演进而来。为照顾已有配置和自动化，部分历史入口仍作为兼容别名保留；新文档、脚本和日常使用应优先采用 `lfcode` 命令与 `LFCODE_*` 环境变量。

## 参与项目

- 在 [Issues](https://github.com/lfyxhappy/lfcode/issues) 报告问题或提出功能建议。
- 在 [Releases](https://github.com/lfyxhappy/lfcode/releases) 获取已发布版本与变更记录。
- 欢迎提交 Pull Request；开始前建议先查看现有 issue，避免重复工作。

Lfcode 使用 [MIT License](LICENSE) 发布。
