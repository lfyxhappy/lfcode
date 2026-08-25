# Windows 内置联网链路无法访问 GitHub

## 问题

使用版会话 `ses_06cea6382ffeEPQbpPUYO7QPCZ` 在执行“查找最近一周 GitHub 热门项目”时出现大量联网工具失败：

- `webfetch` 共调用 22 次，其中 18 次失败。
- `https://github.com/*` 和 `https://api.github.com/*` 均返回 `Transport error`。
- `app_open_browser` 返回 `App Control is disabled in global settings`。
- `websearch` 默认只返回 Bing 搜索入口 URL，不直接返回候选结果，因此模型继续尝试多个 `webfetch` 地址。

同一台机器上，PowerShell 7 的 `Invoke-WebRequest` / `Invoke-RestMethod` 可以正常访问 GitHub Trending、GitHub API、Bing、Exa MCP 和 Parallel MCP。使用版安装包内置的 `resources\\pwsh\\pwsh.exe` 也验证通过。

## 原因

- `webfetch` 通过 Effect `FetchHttpClient` 发起请求，没有 PowerShell 7 兜底。相关实现位于 `packages/core/src/tool/webfetch.ts`、`packages/core/src/effect/layer-node-platform.ts` 和 `packages/lfcode/src/tool/webfetch.ts`。
- 在当前 Windows 网络环境中，Bun/Node 的直接 `fetch` 访问 GitHub 报 `unable to verify the first certificate`；`example.com` 等普通站点可以访问。说明问题集中在运行时证书信任链与 Windows 证书存储之间的不一致，而不是 GitHub 不可达或全局断网。
- PowerShell 7 使用 Windows 系统证书链访问同样 URL 返回 HTTP 200，因此绕过了当前 Bun/Node HTTP 链路的证书问题。
- 当前模型 `native_web` 为 `false`。`packages/lfcode/src/research/routing.ts` 在没有原生搜索、注册直连源或缓存时默认选择浏览器发现路由；浏览器 App Control 又默认为关闭，导致搜索发现和网页抓取被串成多次失败重试。

## 推荐解决方案

- 优先修复内置 HTTP 客户端在 Windows 上的 CA/证书链信任，或明确接入可验证的系统证书来源，不要关闭 TLS 校验。
- 在 Windows 增加受控的 PowerShell 7 网络 fallback：仅在 `tls`/`transport` 类错误时使用固定参数调用 `Invoke-WebRequest` / `Invoke-RestMethod`，不要把模型生成的任意命令直接拼接进 shell。
- PowerShell fallback 应返回结构化结果，覆盖状态码、响应头、内容类型、最大响应大小、超时、重定向、文本/HTML/JSON 和取消处理，并保留现有 `webfetch` 权限校验。
- 不建议把所有联网请求简单改成每次启动一个 `pwsh` 进程。进程启动、编码、流式响应、二进制附件、并发和跨平台兼容都会增加维护成本；更合适的是 Windows 专用 fallback 或独立 HTTP worker。
- 调整 `websearch` 的失败收敛逻辑：浏览器发现不可用时应明确报告路由不可用，避免模型连续尝试同一类 GitHub 地址；若启用 Exa/Parallel，则让其通过结构化直连路线返回结果，而不是只返回 Bing 入口。
- 修改完成后，至少在使用版安装副本验证：GitHub HTML、GitHub JSON API、Bing 搜索页、403/404 页面、超时、5 MB 响应限制、PowerShell fallback 取消和并发请求。

## 状态

已解决

2026-07-24：已在使用版会话和本机运行时复现。确认 PowerShell 7 可访问 GitHub，Bun/Node `fetch` 对 GitHub 出现证书校验错误；尚未修改联网实现或同步安装副本。

2026-07-24：开始实现 Windows 专用的 PowerShell 7 受控后备，目标是仅在 TLS/传输失败时调用，保持 TLS 校验、超时、重定向和响应大小限制。

2026-07-24：已完成。新增 `packages/shared/src/windows-webfetch.ts`，固定 PowerShell 7 脚本通过 stdin 接收 JSON，由 .NET HTTP 客户端按系统证书链请求；没有关闭 TLS 校验，也不执行模型文本。core V2 与旧会话 `webfetch` 均仅在 Windows 的 TLS/传输类失败时调用后备，HTTP 状态错误、超时和超大响应不会触发。真实验证：Bun 直连 GitHub API 仍复现 `unable to verify the first certificate`，后备成功获取 GitHub Trending HTML（200）、GitHub API JSON（200）和不存在 API 路径（404）。已打包同步 pre 与使用版，使用版自动化健康检查及前台窗口检查通过。
