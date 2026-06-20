<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode 标志">
    </picture>
  </a>
</p>
<p align="center">基于 opencode 开发的开源 AI 编码代理。</p>
<p align="center">保留历史兼容入口，同时补齐会话管理、Skills 管理和 GitHub Action 集成。</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="最新版本" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="构建状态" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

[![Lfcode 终端界面](packages/web/src/assets/lander/screenshot.png)](https://github.com/lfyxhappy/lfcode)

---

> 本 README 按当前 Lfcode 仓库状态编写，下载链接、发布产物和兼容性说明均以仓库代码为准。

### 项目简介

Lfcode 是一个基于 Bun workspace 的 monorepo，从 opencode 发展而来。项目在保留 `opencode` 相关兼容入口的同时，继续以 Lfcode 品牌提供桌面端、Web UI、SDK 和 GitHub Action 能力。

### 特色功能

- 会话管理更完整：支持列表、状态、创建、更新、删除、分叉、分享、取消分享、总结、压缩、Diff、回滚和恢复。
- 交互方式更多样：支持发送消息、异步 `prompt`、`shell` 执行、命令执行和下一条提示预测。
- Skills 管理：支持本地 Skills 列表、发现、安装、导入、创建、刷新和目录查看。
- GitHub Action 集成：可在 issue 或 PR 评论中使用 `/lfcode`、`/opencode`、`/oc` 触发自动处理。
- 历史兼容：保留 `opencode` CLI 命令、`LFCODE_*` 环境变量、`lfcode://` 协议等旧入口。

### 安装

当前公开下载发布在 [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) 页面。

- 桌面端：当前发布流程会生成 Windows 安装包 `lfcode-win-x64.exe`。
- 源码开发：在仓库根目录使用 Bun。

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### 兼容性

部分运行时标识仍保留历史 `opencode` 命名，以兼容旧工作流。

- CLI 命令：`opencode`
- 配置目录：`~/.lfcode`
- 环境变量：`LFCODE_*`
- 桌面协议：`lfcode://`

### 仓库结构

- `packages/lfcode`：核心运行时和会话引擎
- `packages/app`：Web UI
- `packages/desktop`：Electron 桌面宿主
- `packages/ui`：共享 UI 组件
- `packages/sdk/js`：JavaScript SDK

### 文档

当前文档源位于 [packages/web/src/content/docs](packages/web/src/content/docs)。

### 验证

在仓库根目录运行：

```bash
bun run lint
bun run typecheck
```

### 支持

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
