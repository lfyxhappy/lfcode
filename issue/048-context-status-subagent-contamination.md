# 子 agent 上下文快照污染主对话显示

## 优先级

高

## 状态

未解决

## 问题

上下文面板要求只显示主对话，但同一 session 内运行的子 agent 可能覆盖主对话的上下文快照，导致主对话顶部和弹层显示的 token/百分比反映了子 agent 请求，而不是主对话实际上下文。

## 原因

### 已确认

- `SessionContextStatus.get` 的消息读取固定使用 `agentID: "main"`，主消息切片本身不会读取子 agent 消息。
- `session_context_status` 表只有 `session_id` 主键，没有 `agent_id` 字段。
- `prompt.ts` 的 request-envelope 快照写入和 `processor.ts` 的 step-finish 快照写入均按 session 写入，未限制 `agentID === "main"`。
- 预发布 session `ses_fad1eeb80ffeq1DJZ8BBo5ady5` 同时存在 `main`、`tester-1`、`implementer-1`、`general-1` 四个 agent 切片。

### 高概率原因

- 子 agent 使用共享 session ID 执行时，最后完成的请求会把自己的 token、模型窗口和 provider 写入唯一的 session 快照行。
- 主对话状态接口随后读取该行，并与主消息切片组合，形成跨 agent 的混合结果。

### 待验证

- 需要在主 agent 与子 agent 并发完成顺序可控的测试中，确认快照最后写入者与面板显示值的对应关系。

## 推荐解决方案

让上下文快照明确绑定主对话视图：主面板只接受 `agentID: "main"` 的写入，或为快照增加 agent/epoch 维度并在读取时选择主 agent 最新有效记录。保留子 agent 自身运行所需的内部 token 统计，不将其写入主对话状态。补充并发写入、主 agent 优先和旧快照淘汰测试。

## 相关代码

- `packages/lfcode/src/session/context-status.ts`
- `packages/lfcode/src/session/context-snapshot-store.ts`
- `packages/lfcode/src/session/context-status.sql.ts`
- `packages/lfcode/src/session/prompt.ts`
- `packages/lfcode/src/session/processor.ts`
- `packages/lfcode/src/session/message-v2.ts`

## 复现条件

- Windows 预发布版，session `ses_fad1eeb80ffeq1DJZ8BBo5ady5`。
- 在主对话中并行运行一个或多个子 agent，并在其请求完成期间观察上下文面板。
- 期望：仅主 agent 上下文变化会影响面板；实际：子 agent 完成可能改变面板数值。

## 验收标准

- 子 agent 请求和完成不会改变主对话上下文面板的 token、百分比、模型窗口或压力等级。
- 主 agent 连续请求仍能实时更新面板，且旧快照不会覆盖新快照。
- 并发主/子 agent 回归测试通过，历史 session 数据不迁移、不删除。

## 现场证据

- 预发布数据库 `C:\Users\liangfeng\.lfcodepre\data\lfcode.db` 中目标 session 消息计数为：main 189、tester-1 18、implementer-1 9、general-1 6。
- 审查期间 session 仍在 streaming，`session_context_status` 快照值从约 118,207 tokens（12%）变化到 86,112 tokens（9%），显示值可能随不同请求写入而变化。
- 本记录来自只读审查，尚未实施修复。

