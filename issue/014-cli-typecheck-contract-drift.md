# CLI 全量 Typecheck 契约漂移

## 问题

根级 `bun run typecheck` 中，`@lfcode-ai/app`、`@lfcode-ai/desktop`、`@lfcode-ai/ui`、`@lfcode-ai/sdk`、`@lfcode-ai/plugin` 与 `@lfcode-ai/shared` 已通过，但 `@lfcode-ai/cli` 仍产生约 609 条类型错误，分布在约 131 个文件。

## 原因

错误集中在多条跨模块契约同时演进后未统一迁移：

- Effect 运行时依赖出现重复版本，导致 `Effect`、`Sink` 和 Layer 类型来自不同实例。
- app-control、runtime registry、LSP、Session V2 与工具 API 扩展后，调用方和测试 fixture 仍使用旧接口。
- Copilot/OpenAI-compatible provider 的 `unknown` JSON 响应与 options 解析尚未落到结构化 schema。
- 部分 CLI 构建脚本、语音请求头、Python runtime、资产模块声明仍假定旧的 Node/Electron 或打包条件。

## 推荐解决方案

单独建立 CLI 类型治理计划，不与桌面 UI/动效任务混合。建议按以下顺序处理：

1. 在根 `bun.lock` 与 `packages/lfcode/package.json` 收敛唯一 Effect 版本，先消除跨包 `Effect`/`Sink` 不可赋值问题。
2. 按 app-control、runtime registry、LSP、Session V2 分域更新公共 interface 和对应 fixture，避免逐个工具文件使用类型断言。
3. 为 Copilot provider 的请求 options 与响应体定义/复用 Zod schema，消除 `unknown` 和空对象属性访问。
4. 修正 CLI 构建、资源声明与运行时平台条件；每个域完成后运行 `bun run --cwd packages/lfcode typecheck`。
5. 域内全部收敛后再运行根 `bun run typecheck`，不把其他计划的完成状态依赖于这组历史错误。

## 状态

未解决
