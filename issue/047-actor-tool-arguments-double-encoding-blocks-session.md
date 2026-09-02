# actor 工具参数字符串化并二次编码阻断会话

## 优先级

高

## 状态

未解决

## 问题

在预发布会话 `ses_fad1eeb80ffeq1DJZ8BBo5ady5`（Lfcode 1.1.3，`opencode-go / deepseek-v4-flash`）中，模型并行调用两个 `actor` 子 Agent 时，工具参数以 JSON 字符串形式传入，而不是工具 schema 要求的对象。两个调用均显示 `Invalid input for tool actor`。

随后模型继续生成了若干轮工具调用，但在再次把历史发送给供应商时，OpenCode Go 请求被拒绝：`[400] Assistant tool call function.arguments must be a JSON object.` 本轮没有产生正常的最终回复，session 记录为不可恢复终态（`recoverable=0`）。这会直接阻断子 Agent 协作评测及后续对话。

## 原因

### 已确认

- SQLite 中的两个 `actor` tool part（`prt_052e22833001nq4jQ0gwcbenZL`、`prt_052e23a52001VJhrMm3xl52ZQV`）状态均为 `error`；其 `state.input` 在持久化时是一个 JSON 字符串，而不是对象。
- 两条本地错误的原始信息均为 `Invalid input for tool actor: JSON parsing failed`。Agent A 的文本包含未正确转义的 Windows 路径/反斜杠；Agent B 还出现了 `Bad escaped character in JSON`。
- 失败后本地 Session 没有立即停止：错误之后仍有多轮 `assistant.finish=tool-calls` 和成功的 `read`、`search`、`shell`、`task` 调用，说明本地工具错误观察可以继续进入下一轮。
- 最后一条 assistant `msg_052e26448001MAbXCGexvYJXei` 没有正常 `finish`，而是 `APIError`；请求 URL 为 `https://opencode.ai/zen/go/v1/chat/completions`，错误状态码为 400。
- 该请求体中，正常工具调用的 `function.arguments` 是形如 `{"filePath":"..."}` 的 JSON 文本；两个 `actor` 调用的 `function.arguments` 则是以引号包裹的整段 JSON（即 JSON 字符串字面量）。
- `packages/lfcode/src/provider/sdk/copilot/chat/convert-to-openai-compatible-chat-messages.ts` 对每个 tool-call 无条件执行 `JSON.stringify(part.input)`。当 `part.input` 已经是字符串时会再次编码，形成供应商拒绝的双重编码形态。
- `packages/lfcode/src/tool/tool.ts` 的普通执行路径先按原始参数运行 schema 校验；`actor` 的 shell recovery 只覆盖 shell 形状恢复，不能把当前这种 JSON 字符串安全地统一解析为对象后再校验。

### 高概率原因

- `opencode-go / deepseek-v4-flash` 在生成 `actor` function-call 时输出了字符串化的 JSON 参数；模型或上游适配器没有遵守对象参数契约。
- Provider 传输层将已经是字符串的工具输入再次 `JSON.stringify`，放大了上游协议不兼容，使原本可被本地恢复的参数在下一轮历史回传时变成供应商级终止错误。
- 现有 `actor` 参数恢复与通用工具参数归一化没有覆盖“字符串内容本身是 JSON object”的情况，也没有在 provider 边界对 tool-call arguments 做类型/编码诊断。

### 待验证

- 需要通过脱敏的原始模型流或可控兼容服务确认字符串化发生在模型输出、OpenCode Go 网关，还是 AI SDK 解析阶段。
- 需要确认 OpenCode Go 网关对 `function.arguments` 的正式契约是 JSON object 还是 JSON 文本，并核对其他 OpenAI-compatible 模型是否接受当前标准编码。
- 需要验证将字符串 JSON 仅解析一次后，`actor` schema、工具历史回放和供应商请求三条链均保持兼容。

## 推荐解决方案

1. 在 provider tool-call 输入边界增加无副作用的类型归一化：当输入是非空字符串且严格解析结果为 JSON object 时，只解析一次；数组、标量、非法 JSON 继续按原错误路径处理，不猜测业务操作。
2. 在 `convertToOpenAICompatibleChatMessages` 中区分 object 与 string：object 按协议编码一次；已经是合法 JSON 文本的 string 不再二次 `JSON.stringify`，同时对非法字符串保留可诊断的原值或转为明确的 tool validation observation。
3. 为 `actor` 增加专门回归用例：对象参数成功、字符串化对象可恢复、非法转义得到模型可见错误且不会污染后续 provider 历史。
4. 将 provider 协议错误（400、参数编码）转为可恢复的工具/模型观察结果时，保留“先修正 arguments 类型再重试”的明确提示；只有连续相同错误达到现有熔断阈值才结束当前自动循环。
5. 增加 OpenCode Go 定向请求快照测试，确保正常工具参数的线上形态与 actor 参数形态一致，且不影响其他 OpenAI-compatible provider 的标准 JSON 文本契约。

## 相关代码

- `packages/lfcode/src/tool/actor.ts`
- `packages/lfcode/src/tool/tool.ts`
- `packages/lfcode/src/session/processor.ts`
- `packages/lfcode/src/session/part-helpers.ts`
- `packages/lfcode/src/provider/sdk/copilot/chat/convert-to-openai-compatible-chat-messages.ts`
- `packages/lfcode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts`
- `packages/lfcode/src/provider/transform.ts`
- 相关 issue：`issue/019-tool-call-ergonomics-and-recovery.md`
- 相关 issue：`issue/024-subagent-restart-and-tool-failures.md`
- 相关 issue：`issue/015-task-schema-grok-invalid-arguments-loop.md`

## 复现条件

- 环境：Windows 预发布版，数据根 `C:\Users\liangfeng\.lfcodepre`。
- 会话：`ses_fad1eeb80ffeq1DJZ8BBo5ady5`。
- 模型：`opencode-go / deepseek-v4-flash`，变体 `max`。
- 操作：要求模型在新建目录后并行启动 Agent A 与 Agent B。
- 期望：`actor` 的 arguments 是对象，工具失败时可回传模型并继续修正。
- 实际：两次本地 JSON 解析失败；随后 provider 400，当前轮终止。

## 验收标准

- 相同模型和提示词下，`actor` 调用的持久化 `state.input` 为对象，至少一个子 Agent 能启动并返回结果。
- 模型偶尔输出 JSON 字符串时，系统最多解析一次后按原 schema 校验，不产生双重编码；非法转义仍以模型可见错误返回。
- OpenCode Go 请求中，actor 与其他工具的 `function.arguments` 编码形态一致，不再出现 `function.arguments must be a JSON object`。
- 单次工具参数错误不会直接结束 Session；模型能收到具体修复提示并继续，连续相同错误达到阈值时才按熔断策略结束并标记会话可恢复。
- 既有 `actor` 对象调用、shell 兼容、其他 provider 的 tool-call 编码和历史会话回放测试继续通过。

## 现场证据

- 运行态：`bun run app:control --pre health` 返回 `status=ok`；`state` 显示目标窗口可见、`streaming=false`、`messagesReady=true`，但 session 的 `recoverable=0`。
- 数据库：`C:\Users\liangfeng\.lfcodepre\data\lfcode.db` 中目标 session 共记录 2 个 actor error part；最后一条 assistant 消息为 APIError，无正常完成时间线。
- 日志：`C:\Users\liangfeng\.lfcodepre\data\log\2026-08-30T131122.log` 记录 OpenCode Go 400 及完整请求元数据；已只摘录错误类型和脱敏后的工具参数形态，未记录凭据。
- 调查为只读审查；未修改源码、配置、会话数据或生产目录。
