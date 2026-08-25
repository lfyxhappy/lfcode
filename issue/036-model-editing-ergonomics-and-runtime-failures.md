# 生产使用版模型文件编辑不顺手：长行坐标、恢复协议与运行时异常叠加

## 优先级

高

## 状态

已解决

## 问题

生产使用版会话 `ses_06cbe09d6ffelk3kD14mpNTsiZ` 在修改项目 `C:\算法\小应用\知识库\10_Projects\浏览器备忘录` 的 `app.js` 和 `styles.css` 时，模型频繁遇到编辑工具错误，结构化编辑失败后操作变得不稳定，用户感受为“模型编辑文件非常不顺手”。

本次现场的 `minimax-cn-coding-plan/MiniMax-M3` 实际配置为 Anthropic Messages，而官方文档同时提供了 M3 的 OpenAI Responses API。后续修复目标明确为：把 MiniMax M3 的 provider 统一迁移到官方 Responses 协议，并与 provider、工具调用历史和流解析一起验证；不是只对 Anthropic `message_delta` 做局部容错。

现场表现不是单一工具完全不可用，而是几个边界同时出现：

- 目标文件包含极长的单行内容，`styles.css` 最长行达到 3436 字符；基于行和字符坐标的编辑需要处理不直观的 1-based、左闭右开范围。
- 会话共调用 `replace_range` 12 次，其中 6 次失败。典型调用把 `endChar` 传为 2000，但实际目标行只有 1730 或 677 个字符。
- `read` 对单行最多展示 2000 个字符，长行无法通过普通读取完整暴露给模型，模型因此难以生成可靠的字符范围或上下文。
- 结构化编辑失败后，模型改用 Python 直接读写 `app.js`，曾造成多余的 `}` 和语法损坏，之后又追加修复调用，增加了无效操作和回归风险。
- 会话中还出现两次 `cancel-timeout`，以及 MiniMax-M3 Anthropic 流 `message_delta` 缺少 `usage` 导致的 `AI_TypeValidationError`；这些问题会使编辑过程变慢、被中止或误判为失败。

当前页面经过只读验证已经恢复：`http://127.0.0.1:8765/` 返回 200，`app.js`、`styles.css`、`/api/cards` 和 `/api/settings` 均返回 200，Chromium 加载无 `console`、`pageerror` 或 `requestfailed`。这只能证明当前产物可运行，不能证明模型后续编辑链路可靠。

## 原因

### 已确认

1. **读取上限与编辑协议不匹配。** `packages/lfcode/src/tool/read.ts:18-21` 定义单行输出上限，`packages/lfcode/src/tool/read.ts:448-450` 执行截断；对压缩后的 CSS/JS 长行，模型拿不到完整的可编辑原文。
2. **越界错误信息不可执行。** `replace_range` 的参数是 1-based、左闭右开；整行替换需要传 `endChar = 行长度 + 1`，或省略字符范围。但当前错误只报告类似 `endChar 2000 exceeds line 15 length 1730`，没有直接返回合法上限 `1731` 和下一步建议。
3. **坐标校验发生在补丁恢复链之前。** `replace_range` 的范围校验失败时不会进入 `apply_patch` 的 recovery，因此已有的上下文失配恢复机制不能覆盖这类错误；Python 工具也没有接入同一套恢复协议。
4. **可写脚本可以绕过结构化编辑。** 结构化编辑失败后，模型仍能使用 Python 修改同一文件。本次会话的直接读写曾破坏 `app.js` 语法，说明“工具调用完成”与“安全、可复核地完成修改”之间没有统一门槛。
5. **`patch_editing` 没有改变实际编辑策略。** `packages/lfcode/src/tool/registry.ts:652-679` 中它只参与工具缓存 key，没有形成不同的工具集合、工具描述或失败处理策略。
6. **build agent 缺少专门的编辑引导。** `packages/lfcode/src/session/system.ts:12-14` 默认只返回 `PROMPT_DEFAULT`，patch-first、工具选择和失败后的 fresh read 主要依赖工具描述，模型在长会话中容易自行猜测。

### 协议与配置漂移

- 生产和预发布配置中的 `minimax-cn-coding-plan/MiniMax-M3` 使用 `protocol: "anthropic-messages"`、`https://api.minimaxi.com/anthropic/v1` 和 `@ai-sdk/anthropic`，见 `C:\Users\liangfeng\.lfcode\lfcode.jsonc:126-136`。
- 当前源码新增的内置 `minimax/MiniMax-M3` 使用 `https://api.minimaxi.com/v1` 和 `@ai-sdk/openai-compatible`，按 `packages/lfcode/src/provider/provider.ts:84-85` 会走 `openai-chat`。两条线路的 provider ID、协议和流事件不一致，容易让 issue 结论和实际运行路径错位。
- MiniMax 官方文档已定义 M3 的 `POST /v1/responses`，请求使用 `input`，工具轮次使用 `function_call`/`function_call_output`，并支持 `reasoning`、流式 SSE 和标准 `usage`。迁移到该协议后，目标请求必须实际命中 `/v1/responses`，不能只修改显示名称。

### 独立的放大因素

- `packages/lfcode/src/session/run-state.ts:140-151` 与 `packages/lfcode/src/effect/runner.ts:166-197` 的取消收尾存在约 2 秒超时；需要确认是底层任务未及时结束，还是取消状态与 UI/Session 投影不同步。
- MiniMax-M3 的 Anthropic SSE `message_delta` 在一次现场响应中缺少 `usage`，触发 SDK 类型校验并使 assistant 最终进入 aborted。它不是编辑坐标错误的直接原因，但会放大编辑任务中断和重试。

### 相关问题但不是重复记录

- `issue/007-patch-context-retry-and-tool-bypass.md` 已处理补丁上下文失配后的恢复锁，但没有覆盖 `replace_range` 坐标越界、长行读取和 Python 绕过的组合路径。
- `issue/019-tool-call-ergonomics-and-recovery.md` 已处理通用工具错误和重复调用，但本次生产现场暴露了更具体的长行编辑契约，以及 recovery 未覆盖的前置坐标校验。

## 推荐解决方案

1. **修正长行读取与坐标契约。** 让 `replace_range` 的错误结果包含 `lineLength`、合法的 `maxEndChar`、参数语义和可直接执行的修复建议；明确省略字符参数时的整行替换语义。为长行提供可按区间读取的结构化能力，避免简单提高截断上限造成更大上下文负担。
2. **统一编辑失败恢复。** 将坐标错误、上下文失配、版本过期、权限错误和内容校验失败区分为不同类别；为每类规定下一步动作。进入同一文件的编辑恢复链后，要求先取得 fresh read，禁止旧参数原样重放，并对连续无进展调用熔断或聚合。
3. **收拢可写绕过路径。** 评估并实现结构化编辑失败后对同一目标文件的 Python/shell 写入限制，或至少要求显式的执行意图、变更前后校验和语法/内容复核，不能让可写脚本静默绕过 recovery。
4. **让工具配置真正生效。** 使 `patch_editing` 影响编辑工具策略或工具说明，并为 build agent 增加明确的工具选择边界：小范围精确修改用 `replace_range`，符号级修改用 `symbol_edit`，多段变更用 `apply_patch`，新文件或整文件重建用 `write`；所有失败编辑先 fresh read。
5. **将 MiniMax M3 迁移到官方 Responses。** 将目标 provider 的协议、endpoint 和 SDK 组合统一为 `openai-responses`、`https://api.minimaxi.com/v1`、`@ai-sdk/openai`，让 `packages/lfcode/src/provider/provider.ts:121-123` 实际选择 `sdk.responses(modelID)`；保留旧模型或显式兼容线路的边界，不让 `@ai-sdk/openai-compatible` 继续把目标请求发到 Chat。验证 `input`、`reasoning`、`function_call`/`function_call_output`、完整历史回传、`response.*` SSE 和 `usage` 的兼容性。
6. **修复独立运行时异常。** 不把 Anthropic `message_delta` 缺少 `usage` 当作 M3 的长期主路径；对仍需支持的旧 Anthropic 线路补兼容测试。同时检查 question、Python、shell 和 provider stream 的取消收尾，拆分“取消已生效”和“底层任务完全收尾”的状态，避免 2 秒超时把正常取消表现成新的失败。
7. **以真实安装副本验收。** 除包级定向测试、typecheck 和构建外，在 `C:\算法\小应用\Lfcodepre` 中验证长行读取、越界提示、失败恢复、禁止无进展重试、Responses 请求路径、工具调用往返、取消和流错误处理。普通验证不得停止、覆盖或同步生产使用版 `C:\算法\小应用\Lfcode`。

详细执行顺序、文件范围和验收条件见 `.codex/model-editing-reliability-plan.md`。

## 关联执行计划

- 主计划：`.codex/minimax-token-plan-mcp-plan.md` 的“后续联合阶段：MiniMax Responses 与模型编辑可靠性”。既有 MiniMax Token Plan/MCP 接入记录保留为已完成基线，Responses 迁移与本问题同一批次执行。
- 细化计划：`.codex/model-editing-reliability-plan.md`，当前 `Status: completed`。
- 本轮已完成源码、测试和预发布同步；未修改生产使用版。

## 官方文档核对

## 解决记录（2026-07-24）

- 已实现长行精确区间读取、replace_range 边界字段和坐标/版本失败后的 fresh-read 恢复约束；Python/shell 对同一已失败目标的直接写入会被拒绝。
- 已将 MiniMax M3 迁移到 OpenAI Responses 调用链，定向 SSE 回归确认 `/responses`、reasoning、function_call 及 function_call_output 历史转换。
- 旧 Anthropic 缺失 usage 仅在 Anthropic SSE 路径补零 usage，不影响 Responses。
- 本次定向测试 14 项、`packages/lfcode` typecheck、pre 打包同步与 automation bridge 健康检查均通过；`LfcodePre.exe` 主窗口已可见。
- 未使用真实 MiniMax 凭据进行外部请求，此项仅保留为可选复测，不阻塞本 issue 结项。

- [MiniMax 模型概览](https://platform.minimaxi.com/docs/guides/models-intro)：`MiniMax-M3` 当前指向文本 API 文档。
- [MiniMax 模型调用](https://platform.minimaxi.com/docs/guides/text-generation)：M3 同时支持 Anthropic 兼容和 OpenAI Chat Completions；文档将 Anthropic 标为推荐路径，同时列出 OpenAI 兼容的 `/v1/chat/completions`。
- [MiniMax Responses API](https://platform.minimaxi.com/docs/api-reference/responses-create)：定义 OpenAI Responses 兼容的 `POST /v1/responses`，支持 M3 的 `input`、`reasoning`、流式输出和函数调用。
- [MiniMax 工具调用与交错思维](https://platform.minimaxi.com/docs/guides/text-m3-function-call)：强调多轮工具调用必须完整保留并回传模型上一轮的响应内容。

因此，Responses 迁移是有官方接口依据的，但不能只把协议字符串改成 `openai-responses`；必须同时切换到带 `responses()` 的 SDK provider，并验证 Lfcode 的历史、工具和 reasoning 映射。

## 现场证据

- 会话：`ses_06cbe09d6ffelk3kD14mpNTsiZ`
- 生产程序：`C:\算法\小应用\Lfcode\Lfcode.exe`
- 生产数据库：`C:\Users\liangfeng\.lfcode\data\lfcode.db`
- 生产日志：`C:\Users\liangfeng\.lfcode\data\log\2026-07-24T082827.log`
- 生产包内实际代码已与源码逻辑核对；包时间为 2026-07-24 16:27:30。
- 现场目标文件当前 `app.js` 为 64 行，最长行 1333 字符，`node --check` 通过；`styles.css` 为 16 行，最长行 3436 字符。
- 会话共 12 次 `replace_range`、6 次失败；共 6 次 Python 调用，其中 5 次 completed、1 次 aborted。
- 典型失败包括：第 15 行长度 1730 却传 `endChar=2000`；第 23 行长度 677 却传 `endChar=2000`；另有传 `endChar=670` 和携带旧 `expected_version` 的调用。
