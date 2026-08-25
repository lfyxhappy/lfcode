# OpenCode Go 模型无法使用 shell 工具

## 问题

`opencode-go/deepseek-v4-flash-vision-exp` 在 Build 模式下无法调用 shell，用户可见为工具不可用或模型拒绝执行；同一模型的能力和思考档位也可能被旧配置显示为错误的统一档位。

## 原因

- Code Mode 压缩工具目录时把 `shell` 放进了非原生列表，模型只能看到 `run_code`，无法直接调用可靠的编码工具。
- OpenCode Go reasoning 请求仍发送 `tool_choice: required`，该网关会拒绝 thinking turn 的 required 选择。
- `runtimeCapabilities` 接收了 `inferredLast` 却没有传给 `normalizeModelCapabilities`，导致预发布 `lfcode.jsonc` 中旧的 `reasoning:false` 覆盖模型名推断。
- reasoning options 优先复用旧缓存，模型名已声明新档位时仍可能保留旧的 low/medium/high。
- 旧预发布包还缺少 `tree-sitter`、`tree-sitter-bash`、`tree-sitter-powershell` 三个 WASM 资产；shell 权限扫描首次解析时触发 `ENOENT`，未捕获的 rejection 会导致 Electron 主进程退出。

## 推荐解决方案

- Code Mode 保留 `shell/read/edit/skill/task` 原生工具。
- 对 OpenCode Go reasoning 模型强制使用 `tool_choice: auto`。
- 完整传递 `inferredLast`，并让模型名 profile 在无显式声明时优先于旧缓存 reasoning options。
- 为 vision-exp 精确断言 reasoning、toggle/effort 档位、图片输入、文本输出、上下文和最大输出。
- 打包后断言上述三个 WASM 均存在；shell 解析失败返回结构化工具错误，不冒泡为主进程 `unhandledRejection`。

## 状态

已解决

2026-08-24：`packages/lfcode` 定向测试 167 项通过，包级 typecheck 通过；预发布 `app.asar` 已校验包含主入口和三个 shell parser WASM，并同步到 `C:\算法\小应用\Lfcodepre`。真实预发布会话选择 `opencode-go/deepseek-v4-flash-vision-exp` 后发送 `pwd`，DOM 显示 `Shell processes 1`、状态 `completed`，输出为 `C:\算法\小应用\闲聊`；窗口 `visible=true`、`focused=true`、`minimized=false`，进程保持响应。事件流无 `tool_choice` 拒绝、parser `ENOENT`、`unhandledRejection` 或主进程退出。全仓 typecheck 仍受既有 `effect-drizzle-sqlite` 缺失 `drizzle-orm` 依赖阻断。
