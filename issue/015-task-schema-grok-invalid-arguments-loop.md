# Grok 调用 task 工具时丢失 operation 参数并重复失败

## 优先级

高

## 状态

已解决

## 当前实现

- `task` 使用 `operation.action` 判别联合类型，创建任务时还要求 `operation.summary`。
- Provider schema 转换只扁平化根级 `anyOf` / `oneOf`；`task` 的联合类型位于根对象的 `operation` 属性内，因此转换后仍保留嵌套 `anyOf`。
- 工具校验失败后，错误作为 tool result 返回模型；assistant 以 `tool-calls` 结束时 Session loop 会继续执行。主 agent 未配置 `steps` 时上限为 `Infinity`，当前没有针对相同工具校验错误的重复熔断。
- UI 使用可折叠错误卡显示工具错误。折叠标题只显示 `The task tool was called with invalid arguments`，展开后才能看到 `operation.action` 缺失等完整 Zod 错误。

## 问题

会话 `ses_0a37a90beffexfLLW9WQmzEr0R` 使用 `jws/grok-4.5` 进入 Compose 流程后，模型无法创建任务。界面连续出现“任务 The task tool was called with invalid arguments”，模型多次解释自己将改用正确格式，但下一次调用仍失败。

本次现场在约 2 分 40 秒内产生 14 次失败的 `task` 调用，造成错误卡刷屏、额外 token 消耗，并阻断依赖任务树的 Compose 工作流。Session 数据和任务表本身没有发现损坏证据。

## 复现条件

- 使用版版本：`1.1.3`。
- Provider / Model：`jws/grok-4.5`，协议为 OpenAI Responses。
- 让模型执行需要创建任务的 Compose / brainstorm 流程。
- 期望：模型生成类似 `{"operation":{"action":"create","summary":"..."}}` 的参数并成功创建任务。
- 实际：13 次调用到达本地校验层时参数为 `{"operation":{}}`；另 1 次把解释文字作为 `operation` 字符串传入。
- 当前数据库中只观察到该模型的一个相关 Session，尚未证明所有 JWS/Grok 会话必现。

## 原因

### 已确认

1. `task` 的本地 schema 要求 `operation.action`，`create` 分支还要求 `operation.summary`；工具说明中的 JSON 示例也是正确的。
2. 当前 Provider 转换器只调用一次根级 `flattenDiscriminatedUnion(schema)`。对 `task` 转换后，根节点是普通 object，嵌套的 `properties.operation.anyOf` 不会被扁平化。
3. 使用与当前实现等价的最小 schema 对 `jws/grok-4.5` 模型信息执行 `ProviderTransform.schema(...)`，输出仍是 `operation: { type: "object", anyOf: [...] }`。
4. 该 Session 的 `question`、`read`、`search`、`shell`、`skill` 等其他工具均能正常调用，失败集中在 `task`。
5. 同一数据库中，GPT 和 Mimo 模型存在多次成功的 `task` 调用记录，因此不是 `task` 执行器或任务数据库整体不可用。
6. Session 分类器将 `assistant.finish === "tool-calls"` 视为继续；未配置 agent `steps` 时最大步数为 `Infinity`，所以相同失败可以持续进入下一轮。

### 高概率原因

`jws/grok-4.5` 链路不能可靠遵循 `operation` 内部的 discriminated-union / `anyOf` schema，导致返回的工具参数丢失 `action` 和分支字段。兼容层没有为该嵌套联合类型生成更简单的扁平 schema，因此模型在收到校验错误和正确示例后仍反复生成空对象。

### 待验证

- 当前未保存上游原始 Responses 流，无法确定字段是在 Grok 生成阶段丢失，还是 JWS 代理转换/序列化阶段丢失。
- 需要用脱敏请求捕获或可控兼容服务确认服务端实际收到的 `task` tool schema，以及上游返回的原始 function-call arguments。
- 需要确认同一模型在新 Session、非 Compose 模式和其他嵌套 discriminated-union 工具上是否同样复现。

## 推荐解决方案

1. 扩展 Provider schema 兼容转换：递归处理对象属性中的 discriminated union，至少将 `task.properties.operation.anyOf` 扁平化为：
   - 必填 `action` enum；
   - 合并各分支字段；
   - 在 `action` 和分支字段描述中保留每个 action 的必填字段提示；
   - 继续由原始 Zod schema 在执行前严格校验每个 action 的真实必填字段。
2. 不要针对 Grok 放宽运行时校验，也不要在缺少 `action` 时猜测操作类型；空 `operation` 不能安全推断为 `create`。
3. 增加 schema 回归测试：
   - `task` 对 OpenAI Responses / OpenAI-compatible 模型转换后，`operation` 下不应残留 `anyOf` / `oneOf`；
   - `action` 必须存在且包含全部合法操作；
   - 原始运行时 schema 仍拒绝缺少 `summary` 的 `create` 和分支外字段。
4. 增加无进展工具错误熔断：相同 Session 中，相同工具、归一化参数和校验错误连续出现 2–3 次后，停止自动续跑，并要求模型改用可行替代路径或向用户报告兼容问题。
5. UI 可将连续相同错误折叠为一组并显示重复次数；这只能减少刷屏，不能代替 schema 修复和运行时熔断。
6. 修复后在已安装使用版中使用 `jws/grok-4.5` 真实进入 Compose 流程验证，不能只以 schema 单测或源码构建通过作为完成依据。

## 验收标准

- `jws/grok-4.5` 在已安装使用版中能用 `task` 创建、列出、启动和完成任务，参数包含正确的 `operation.action` 和分支字段。
- 同一 Compose 场景连续执行至少 3 次，不再出现空 `operation` 或字符串化 `operation`。
- Provider schema 定向测试证明 `task.operation` 已转换为兼容的普通 object schema，且运行时 Zod 严格校验没有被削弱。
- 人工或自动注入相同无效 `task` 参数时，达到设定阈值后能够熔断，不会产生十余次相同错误卡。
- UI 能查看完整校验原因；若实现错误聚合，应准确显示重复次数并保留每次调用的原始记录。

## 相关代码

- `packages/lfcode/src/tool/task.ts`
- `packages/lfcode/src/tool/task.txt`
- `packages/lfcode/src/tool/tool.ts`
- `packages/lfcode/src/provider/transform.ts`
- `packages/lfcode/src/session/classify.ts`
- `packages/lfcode/src/session/prompt.ts`
- `packages/lfcode/test/tool/task.test.ts`
- `packages/lfcode/test/provider/transform.test.ts`
- `packages/ui/src/components/tool-error-card.tsx`
- 相关 issue：`issue/007-patch-context-retry-and-tool-bypass.md`（同样涉及失败后重复尝试，但根因和修复边界不同）

## 修复记录

- 2026-07-14：`packages/lfcode/src/provider/transform.ts` 改为递归遍历 schema 节点，只对具有明确 discriminator 的 `anyOf` / `oneOf` 执行扁平化。`task.operation` 现在保留普通 object、必填 `action` enum、分支字段 owner 提示和每个 action 的必填字段说明；非 discriminated union 保持原状。
- 2026-07-14：`packages/lfcode/src/session/part-helpers.ts` 新增连续工具校验失败识别；`packages/lfcode/src/session/prompt.ts` 在相同工具、归一化参数和相同 validation error 连续出现 3 次后写入用户可见 ModelError 并停止自动续跑。
- 运行时 `TaskTool` 的原始 Zod schema 未放宽；缺少 `summary` 的 create、旧 flat shape 和已废弃 action 仍被拒绝。
- 当前代码、schema、熔断 helper 和 typecheck 已验证。按用户确认的收口口径，本 issue 标记为 `已解决`；`jws/grok-4.5` 安装版 Compose 连续 3 次真实调用保留为可选观察项，后续若复现则新建 issue。

## 现场证据

- Session：`ses_0a37a90beffexfLLW9WQmzEr0R`。
- 时间窗口：2026-07-14 01:31:09 至 01:33:50。
- `task` 调用统计：14 次 error，0 次 completed；其中 13 次缺失 `operation.action`。
- 首次校验错误核心字段：`code=invalid_union`、`discriminator=action`、`path=["operation","action"]`、`note=No matching discriminator`。
- 另一次错误为 `operation` 收到 string，而 schema 期望 object。
- 同 Session 其他工具：`question` 4 次 completed、`read` 3 次 completed、`search` 2 次 completed、`shell` 2 次 completed，另有 `skill`、`tree`、`compose_enter` 成功记录。
- 调查只读取 SQLite、当前源码、已安装 `app.asar` 和脱敏后的 provider 配置；未修改 Session 数据或业务代码。
- 2026-07-14 修复验证：实际 `TaskTool` 转换后的 `operation` 无 `anyOf/oneOf`，`required=["action"]`，action enum 包含 create/done；TaskTool 18/18、重复失败 helper 4/4、schema 定向 11/11 通过，`packages/lfcode` 与根 typecheck 通过。
