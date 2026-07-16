# 工具调用协议对模型不够友好并持续重复报错

## 优先级

高

## 状态

解决中

## 问题

Lfcode 的部分工具对模型的调用协议过于严格或不够直观，模型在 `task`、`apply_patch` 等工具上容易生成无效参数、过期上下文或格式错误。工具返回错误后，Session 仍可能继续执行相同或近似相同的调用，造成错误刷屏、额外 token 消耗和任务停滞。

这不是单个工具完全不可用：同一会话中 `read`、`search`、`tree`、`shell` 均成功，`apply_patch` 也有成功调用。核心问题是工具契约、模型可理解性和失败恢复机制之间缺少统一的易用性设计。

## 原因

### 已确认

- 会话 `ses_096b6e65effe8XXjUrYSvE3h3p` 使用 `minimax-cn-coding-plan / MiniMax-M3`。
- 该会话共有 `task` 失败 9 次，`apply_patch` 失败 8 次；同时存在 11 次成功的 `apply_patch`，说明补丁执行器并非整体失效。
- 9 次 `task` 失败均为 `create` 操作携带了 schema 不允许的 `operation.id`。任务 ID 由运行时生成，创建时不应由模型填写。
- 8 次 `apply_patch` 失败中包含补丁格式错误、缺少 `+` 前缀、缺少 Begin/End 包裹，以及基于旧内容生成的上下文失配。
- 工具统一校验入口会把 Zod 错误返回给模型，但当前通用提示主要是“重写输入”，没有统一的可执行恢复动作或重复调用熔断。
- `task` 和 `apply_patch` 的安全校验本身是必要的，不能通过无条件放宽 schema 或模糊匹配来掩盖问题。

### 高概率原因

- `task` 使用嵌套的严格 discriminated union；虽然结构清晰，但“任务拥有 T1/T2 ID”的说明可能诱导模型在 `create` 时自行传入 `id`。
- `apply_patch` 需要模型同时正确记住补丁包裹格式、每行前缀、精确上下文和当前文件状态，对长会话及 Markdown 大文件尤其不友好。
- 工具失败后没有统一区分“参数可修复”“必须重新读取”“不可重试”“应切换替代工具”等错误类别。
- Session 在工具调用结束后可以继续下一轮；当模型没有真正改变参数或编辑策略时，错误会被重复放大。
- 当前模型对严格嵌套 schema 和长文本 patch 的服从性不足，MiniMax-M3 是已确认的现场模型，但尚未证明所有模型都同样复现。

### 待验证

- 不同 provider/model 是否对同一套工具协议表现出明显差异。
- 工具 schema 在不同 provider 转换后是否仍保留足够清晰的分支字段描述。
- 失败工具结果是否能被 Session 可靠识别为“必须先 read”“禁止重复参数”或“达到阈值后停止”。

## 推荐解决方案

1. **简化模型可见 schema**
   - 对 `task` 提供更直接的 action 参数说明，明确 `create` 不允许传 `id`，任务 ID 由工具生成。
   - 对嵌套联合类型继续做 provider 兼容转换，但保留原始 Zod 严格校验，不降低安全边界。
   - 工具描述优先给最小可用 JSON 示例，减少会让模型自行推断的内部实现术语。

2. **增加安全的参数归一化**
   - 对明确无害且可确定的多余字段，例如 `task.create.operation.id`，可以在执行前丢弃并记录兼容诊断。
   - 对缺少关键字段、分支不明确或类型冲突的参数继续拒绝，不要猜测用户意图。
   - 统一输出“已自动修正了什么”或“还缺什么”，让模型下一次调用有明确方向。

3. **让编辑工具按场景自动引导**
   - 小范围精确替换优先推荐 `replace_range`，符号级修改推荐 `symbol_edit`。
   - 新建大 Markdown 文件优先使用 `write`，多文件或多段变更再使用 `apply_patch`。
   - `apply_patch` 错误分为格式错误、文件不存在、上下文失配、读取过期和权限拒绝，并为每类返回唯一恢复动作。

4. **建立统一失败恢复协议**
   - 参数错误：只允许基于错误字段修正一次，不得原样重放。
   - 上下文失配：下一次编辑前强制对同一文件执行新鲜 `read`，旧 patch 不得再次提交。
   - 补丁格式错误：返回最小合法模板，禁止模型继续拼接上一份损坏 patch。
   - 工具不可恢复错误：停止当前工具链，转为报告阻塞原因或请求用户决策。

5. **增加无进展调用熔断**
   - 按 Session、工具名、归一化参数和错误类别记录失败签名。
   - 相同失败连续达到 2 至 3 次后停止自动续跑，显示一次聚合错误和建议替代动作。
   - 不同参数但相同错误类别持续失败时，也应在合理阈值后进入人工确认或替代工具路径。
   - UI 聚合重复错误卡，保留原始调用记录和最后一次详细诊断。

6. **增加成功后复核**
   - 编辑成功后自动读取变更范围或返回最终文件摘要，避免模型把“补丁已应用”误判成“目标内容正确”。
   - 对 Markdown、skill 和配置文件增加结构化检查，例如 frontmatter、关键标题和必要字段。
   - 只有工具执行和必要复核均通过后，模型才应进入完成声明。

7. **针对模型做真实回归**
   - 使用 MiniMax-M3、当前主要 OpenAI-compatible 模型和已知容易失败的模型分别验证 `task`、`apply_patch`、`replace_range`、`write`。
   - 回归必须在已安装使用版中完成，不能只依赖 schema 单测或 source dev 服务。

## 复现条件

- 环境：Windows，Lfcode 安装使用版 `C:\算法\小应用\Lfcode\Lfcode.exe`。
- 会话：`ses_096b6e65effe8XXjUrYSvE3h3p`。
- 模型：`minimax-cn-coding-plan / MiniMax-M3`。
- 操作：让模型创建多个任务并修改多个 Markdown 文件。
- 实际：`task.create` 重复携带不允许的 `id`；`apply_patch` 出现格式错误和旧上下文重放，工具错误连续出现在对话中。
- 期望：模型能根据工具说明生成合法调用；一次失败后按明确协议恢复，不能持续重复同一错误。

## 验收标准

- `task.create` 的模型可见 schema 和说明明确表示任务 ID 自动生成；模型不再稳定地产生 `operation.id`。
- 对无害的多余字段可安全兼容时，工具能自动归一化并记录诊断；对关键字段缺失或分支不明确仍严格拒绝。
- `apply_patch`、`replace_range`、`symbol_edit` 和 `write` 的工具描述能明确表达适用场景，模型能根据文件规模和修改类型选对工具。
- 补丁格式错误后不会原样重复提交旧 patch；上下文失配后必须先重新读取目标文件。
- 相同工具、参数和错误连续达到阈值后会熔断或聚合，不再无限续跑和刷屏。
- 编辑成功后能完成变更范围复核；关键 Markdown、skill 和配置文件的结构未被意外破坏。
- 在已安装使用版中使用 MiniMax-M3 连续执行至少 3 个包含任务创建和文件修改的场景：工具错误可恢复，不能出现连续重复错误循环。

## 相关代码

- `packages/lfcode/src/tool/tool.ts`
- `packages/lfcode/src/tool/task.ts`
- `packages/lfcode/src/tool/task.txt`
- `packages/lfcode/src/tool/apply_patch.ts`
- `packages/lfcode/src/tool/apply_patch.txt`
- `packages/lfcode/src/tool/patch-recovery.ts`
- `packages/lfcode/src/tool/replace_range.ts`
- `packages/lfcode/src/tool/symbol_edit.ts`
- `packages/lfcode/src/tool/write.ts`
- `packages/lfcode/src/tool/registry.ts`
- `packages/lfcode/src/provider/transform.ts`
- 相关 issue：`issue/007-patch-context-retry-and-tool-bypass.md`
- 相关 issue：`issue/015-task-schema-grok-invalid-arguments-loop.md`

## 现场证据

- 2026-07-16 会话 `ses_096b6e65effe8XXjUrYSvE3h3p`：`task:error=9`、`apply_patch:error=8`、`apply_patch:completed=11`。
- 9 次 task 错误均为 `operation` 包含未定义的 `id` 字段，错误类型为 `unrecognized_keys`。
- apply_patch 错误包含 4 次格式类错误和 2 次明确上下文失配；其余为同一补丁链上的恢复/格式错误变体。
- 同一会话的 `read`、`search`、`tree`、`shell` 调用均成功，说明问题集中于结构化任务参数和精确编辑协议，而非所有工具或数据库均不可用。
- 调查只读取本地 SQLite 会话记录和源码，没有修改会话数据、业务代码或运行时配置。

## 本轮实施记录

- `task` 对 `create` 的 `operation.id` 做安全丢弃，任务 ID 仍由 `TaskRegistry` 生成；缺少 `summary`、错误 action 和其他关键字段继续严格拒绝。
- `task` 校验错误现在包含字段路径、正确 envelope、create 不传 ID 和禁止原样重试的恢复动作。
- `apply_patch` 描述补充了 `write`、`replace_range`、`symbol_edit`、`apply_patch` 的场景选择，以及 context failure 后必须 fresh read 的恢复协议。
- 定向验证：`packages/lfcode` 30 个相关测试通过；`packages/lfcode` typecheck 通过；`apply_patch`、task 和重复失败 helper 已在同轮验证。
- 使用版验证：fast Windows package 成功；同步到 `C:\算法\小应用\Lfcode` 后重启，`bun run app:control -- health` 返回 `status=ok`；两份 `app.asar` SHA256 一致。
- 仍待验证：使用现场 `MiniMax-M3` 在安装版连续完成 3 个任务创建和文件修改场景。完成该观察前状态保持 `解决中`。
