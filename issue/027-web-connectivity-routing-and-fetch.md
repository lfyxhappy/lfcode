# Lfcode 联网工具链路不完整

## 问题

会话 `ses_07ba1e02fffehlBoZ6IsF36JnN` 中，Lfcode 的内置联网工具仍不可用：

- `websearch` 返回 `Web search unavailable`，没有产生搜索结果。
- `webfetch` 请求 `https://www.baidu.com` 时失败，错误为 `HTMLRewriter is not defined`。
- `app_open_browser` 失败，提示 `App Control is disabled in global settings`。
- Playwright MCP 浏览器可以打开并读取百度页面，但这条链路没有接入内置 `websearch` 的默认发现流程。

## 原因

- 当前会话使用模型 `minimax-cn-coding-plan/MiniMax-M3`，其配置 `native_web` 为 `false`，因此不会注册 `native_web_search`。相关模型配置位于用户运行配置 `C:\Users\liangfeng\.lfcode\lfcode.jsonc`。
- 当前项目没有研究搜索配置：数据库中的 `research_settings`、`research_source_profile` 和 `research_source_subscription` 均为空。
- `packages/lfcode/src/research/routing.ts` 在没有 URL、原生搜索、注册来源或浏览器搜索引擎时，将请求降级为 `direct`，但没有可用 URL，最终返回 `no discovery route configured`。
- `packages/lfcode/src/tool/webfetch.ts` 的 `text` 格式路径直接实例化全局 `HTMLRewriter`。当前 Node/Electron 运行环境没有该全局对象，因此运行时抛出 `HTMLRewriter is not defined`。
- 当前运行的是已安装副本 `C:\算法\小应用\Lfcode\Lfcode.exe`，其 `resources\app.asar` 与 7 月 21 日 17:00 的构建产物对应；源码中的联网相关文件仍有未提交改动，不能假设运行副本已经包含全部最新源码。

## 推荐解决方案

- 为项目提供明确的默认搜索发现路由：优先接入可用的 Playwright 浏览器搜索，或在设置中配置 Bing、Google、百度、自定义搜索模板；没有原生搜索时，`websearch` 不应静默退化为无 URL 的 `direct`，应明确返回可操作的路由状态。
- 修复 `webfetch` 的 HTML 转文本实现，改用 Node/Electron 可用的 HTML 解析方案，或在运行环境中显式提供兼容实现；至少保证 `format: "text"` 不依赖不存在的 `HTMLRewriter`。
- 明确 `app_open_browser` 与 Playwright MCP 的能力边界和默认开关；如果 Playwright 是当前可用联网通道，应让模型能够通过统一的联网指引使用它。
- 完成源码修改后执行定向测试，再重新打包、同步并启动 `C:\算法\小应用\Lfcode`，在安装副本中分别验证 `websearch`、`webfetch(text)` 和浏览器搜索。

## 状态

已解决

2026-07-21：无原生搜索或项目配置时，`websearch` 现在默认生成 Bing 发现 URL，并明确提示模型用可用浏览器/浏览器自动化打开结果页后再抓取目标页面。`webfetch(format: text)` 已移除对 Bun 专属 `HTMLRewriter` 的依赖，在 Node/Electron 中使用本地 HTML 文本提取器。定向联网工具测试和 Lfcode typecheck 已通过；App Control 仍保持用户现有全局开关，不会被联网工具隐式启用。
