# 预发布版截断工具参数暴露内部 invalid 工具

## 优先级

高

## 状态

已解决

## 问题

预发布会话 `ses_fd24723fbffeA6pdk4hPoWRUqn` 中，`ox-alpha-free` 生成的 `run_code` 参数 JSON 在代码字段中途截断。工具调用修复失败后，界面显示 `Model tried to call unavailable tool 'invalid'`，暴露了内部占位工具名并掩盖了原始 `run_code` 参数解析错误。

## 原因

### 已确认

1. `packages/lfcode/src/session/llm.ts` 的 `experimental_repairToolCall` 在无法修复或别名目标不可用时，将工具名改为 `invalid`。
2. `invalid` 工具在 registry 中注册，但从 `activeTools` 中排除，因此 AI SDK 对该修复结果再次生成 `NoSuchToolError`。
3. 现场 `run_code` 参数在 `for (var g = 1` 处截断，`repairToolInputJSON` 无法安全解析，不能推断或补造可执行代码。

### 已验证

- 预发布安装副本 `Lfcodepre` 已同步并启动可见主窗口。
- 同一会话 `ses_fd24723fbffeA6pdk4hPoWRUqn` 的错误卡已展开，标题显示为 `run_code 失败`，正文显示“工具 run_code 的参数不完整，无法解析。请重新生成有效的工具参数。”，不再出现 `unavailable tool 'invalid'`。
- 截图证据：`C:\Users\liangfeng\.lfcodepre\state\electron\com.lfyxhappy.lfcode.pre\output\automation\issue-043-expanded-final-1787485346423-1.png`。

## 推荐解决方案

对不可恢复的工具调用返回 `null`，让 AI SDK 保留原始工具名并输出原生参数解析/工具不可用错误；保留可安全归一化的别名和 JSON 修复路径。增加截断 JSON、Markdown fenced JSON 和不可用工具回归测试，并完成预发布打包同步与运行态验证。

## 相关代码

- `packages/lfcode/src/session/llm.ts`
- `packages/lfcode/test/session/llm.test.ts`
- `packages/lfcode/src/tool/invalid.ts`
- `packages/lfcode/src/tool/registry.ts`
- `packages/ui/src/components/tool-error-card.tsx`

## 复现条件

- 环境：Lfcodepre，2026-08-23。
- 操作：使用 `ox-alpha-free` 触发 `run_code` 工具调用，参数 JSON 在代码字符串中途截断。
- 期望：错误卡显示 `run_code` 和参数 JSON 不完整/解析失败。
- 实际：错误卡显示内部工具 `invalid` 不可用。

## 验收标准

- 截断 `run_code` 调用不再产生 `unavailable tool 'invalid'`。
- 错误结果保留原始工具名 `run_code`，并包含可诊断的解析失败信息。
- 可修复的 JSON 和工具别名仍按原路径修复。
- `packages/lfcode` 定向测试和 typecheck 通过；预发布安装副本包含修复并可见窗口运行。

## 现场证据

- 预发布日志：`C:\Users\liangfeng\.lfcodepre\data\log\2026-08-23T094034.log`。
- 预发布数据库：`C:\Users\liangfeng\.lfcodepre\data\lfcode.db`。
- 原始截断片段：`for (var g = 1`。
- 同一会话中的 OpenCode Go `[1210] Invalid API parameter` 为独立上游错误，不属于本问题修复范围。
