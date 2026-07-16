# CLI 全量 Typecheck 契约漂移

## 问题

修复前，根级 `bun run typecheck` 中其他 workspace 包已经通过，但 `@lfcode-ai/cli` 仍产生 600 条类型错误，集中在工具参数、Provider schema、Effect 服务、运行时接口和测试 fixture。

## 原因

错误来自多条跨模块契约同时演进后未统一迁移：

- 当前依赖树使用同一 Effect 4 beta 版本；主要问题是代码仍混用旧 Effect API、错误的 generator 返回注解，以及服务环境没有在定义层或测试 Layer 中闭合。此前“重复 Effect 版本”的判断不符合现场依赖树，已撤回。
- app-control、runtime registry、LSP、Session V2 与工具 API 扩展后，调用方和测试 fixture 仍使用旧接口。
- Copilot/OpenAI-compatible provider 的 `unknown` JSON 响应与 options 解析尚未落到结构化 schema。
- 部分 CLI 构建脚本、语音请求头、Python runtime、资产模块声明仍假定旧的 Node/Electron 或打包条件。

## 推荐解决方案

单独建立 CLI 类型治理计划，不与桌面 UI/动效任务混合。建议按以下顺序处理：

1. 按 app-control、runtime registry、LSP、Session V2 分域更新公共 interface 和对应 fixture，避免逐个工具文件使用类型断言。
2. 为 Copilot provider 的请求 options 与响应体复用现有 Zod schema，消除 `unknown` 和空对象属性访问。
3. 修正 CLI 构建、资源声明与运行时平台条件，并按工具、Provider、运行时、Session、fixture 分域验证。
4. 保持 Tool metadata 的精确推断，不使用中央 `any`、`@ts-ignore` 或宽泛断言掩盖错误。
5. 域内全部收敛后运行 package-local 与根级 typecheck。

## 状态

已解决

## 验证

- 2026-07-14 现场基线：`packages/lfcode` 共 600 条错误。
- 分域修复后：`packages/lfcode` 执行 `bun run typecheck`，0 条错误。
- 仓库根执行 `bun run typecheck`：7 个 Turbo typecheck 任务全部成功，`@lfcode-ai/cli`、app、desktop、plugin、sdk、shared、ui 均通过。
- 2026-07-14 Phase 2 扩展 workspace 后，active 根门禁实测 22/22 成功。standalone `packages/tui` 已明确归类为 experimental，其 345 条/31 文件 Core V2/legacy SDK 迁移错误由独立 gate 跟踪，不属于本 issue 原始 canonical CLI 600 条错误的回归。
- Copilot Provider 定向测试 29 项通过；runtime registry 定向测试 13 项通过；Tool 定向测试 68 项通过；Session/Storage 等定向测试 81 项通过。
- 修复保持原始精确 `Tool.define` metadata 泛型，没有以中央类型宽化换取通过。
