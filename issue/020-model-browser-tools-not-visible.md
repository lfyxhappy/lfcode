# 内置浏览器工具没有暴露给模型

## 优先级

高

## 状态

已解决

## 实际修复

- `ToolRegistry.tools` 不再按 `app_control.enabled` 或权限等级过滤 `app_*browser*` 工具；权限和桌面自动化服务状态仍在工具执行阶段检查并返回可行动错误。
- `search_tool` 描述明确限定为扩展工具搜索，不负责网页搜索或内置工具发现。
- `packages/lfcode/test/tool/app-control.test.ts` 覆盖 `read_only` 和禁用配置下浏览器工具仍出现在模型可见 schema 中。

## 产品原则

工具是否暴露给模型，与是否建议模型使用，是两个独立问题。基础工具可以通过工具描述、系统提示词或路由策略告诉模型“不要优先使用”或“仅在特定条件下使用”，但不能因此从模型的工具 schema 中隐藏。工具的权限、服务状态和执行失败应在调用阶段处理，不能在工具 registry 阶段因为缺少配置、provider、实验 flag 或低权限而静默删除工具，导致模型误判“工具不存在”。只有明确属于实验功能、特定 Agent 职责隔离或外部依赖完全不存在的能力，才允许有清晰理由地不暴露。

## 问题

桌面版 Lfcode 的内置侧边浏览器可以正常存在并由用户手动使用，但模型工具列表没有暴露 `app_open_browser`、`app_browser_snapshot`、`app_read_browser_page` 等浏览器控制工具。

这导致模型在用户要求“使用内置浏览器搜索”时无法调用真实浏览器，只能误用 `search_tool`。模型随后把 `search_tool` 当成工具发现或网页搜索入口，反复查询 `browser`、`playwright` 等关键词并得到空结果，最后错误地向用户报告“没有内置浏览器工具”。

产品要求是：桌面版存在内置浏览器能力时，相关浏览器工具必须始终出现在模型可见工具列表中。是否允许执行可以继续由运行时权限检查处理，但不能在工具发现阶段把工具完全隐藏。

## 原因

### 已确认

- 会话 `ses_0905384baffeu6HWFlk715hG71` 使用 `build / minimax-cn-coding-plan / MiniMax-M3`。
- 该会话中没有任何 `app_open_browser`、`app_browser_snapshot` 或其它 `app_browser_*` 工具调用。
- 该会话实际调用了 8 次 `search_tool`，查询包括 `web fetch 联网`、`search`、`web`、`search web internet`、`google`、`browser`、`playwright` 和 `browser navigate`；每次结果均为 `{"tools":[]}`。
- `search_tool` 在 [packages/lfcode/src/tool/registry.ts](../packages/lfcode/src/tool/registry.ts) 中的定义是“搜索已安装扩展工具”，不是网页搜索，也不是内置工具搜索。
- 内置浏览器工具已在 [packages/lfcode/src/tool/registry.ts](../packages/lfcode/src/tool/registry.ts) 中注册，但当前筛选逻辑要求 `appControl.enabled` 且权限等级至少为 `browser_control`，否则直接从模型工具列表移除。
- [packages/lfcode/src/config/config.ts](../packages/lfcode/src/config/config.ts) 当前对缺失配置的默认值是 `enabled: false`、`permission: "session_control"`。
- 当前用户全局配置 `C:\Users\liangfeng\.lfcode\lfcode.jsonc` 没有 `app_control` 配置项，因此命中了上述默认值。
- 安装版运行目录仍存在 `C:\Users\liangfeng\.lfcode\state\electron\com.lfyxhappy.lfcode\Partitions\lfcode-browser`，说明浏览器运行能力和模型工具暴露是两个独立层面；问题不是 Chromium 或侧边浏览器本身缺失。
- 同一个 registry 还会在 provider 或 flag 条件下隐藏 `websearch` / `codesearch`：非 `lfcode` provider 且未启用 Exa 时，两者不会进入模型工具列表。这与本问题属于同一类“基础能力静默不可见”问题。
- `app_control` 之外，registry 还会按 `LFCODE_EXPERIMENTAL_LSP_TOOL` 隐藏 LSP，按客户端类型隐藏 `question` / `composeEnter`，并无条件隐藏旧的 `glob` / `grep` / `edit` / `write` 公共工具面。实验功能、客户端依赖和旧工具迁移需要单独标注，不能与基础工具缺失混在一起。
- 浏览器可见性限制和对应测试是在 2026-07-16 17:16:51 的 commit `510df59` 中引入/固化的；`packages/lfcode/test/tool/app-control.test.ts` 当前明确断言 `read_only` 时浏览器工具不存在，测试与本产品原则冲突。

### 高概率原因

- 工具 registry 把“是否允许模型控制桌面应用”错误地当成了“是否向模型声明该能力”。
- `app_control` 缺失时默认关闭，导致所有浏览器工具在发给模型之前被静默过滤，模型收不到任何明确的不可用原因。
- `search_tool` 的名称过于泛化，且当前模型看不到内置工具目录，放大了模型误把扩展工具搜索当成浏览器工具搜索的问题。

## 推荐解决方案

1. **始终暴露基础工具，分离“可见性”和“使用建议”**
   - 在桌面版且浏览器控制服务可用时，始终把 `app_open_browser`、`app_browser_snapshot`、`app_read_browser_page`、`app_browser_screenshot`、点击、滚动、输入、等待和标签管理工具放入模型可见工具列表。
   - 不再用 `appControl.enabled` 或 `permission` 在 registry 阶段静默移除这些工具。
   - `app_control` 仍可作为执行权限和安全边界，但不能控制工具 schema 是否存在；关闭或权限不足时，工具调用返回明确、可恢复的错误。
   - 对 `websearch`、`codesearch` 等基础工具复查 provider/flag gating，默认尽量暴露并把凭据、provider 不可用等问题放到执行阶段说明。
   - 如果产品不希望模型优先使用某工具，应通过 description、system prompt、tool metadata 或路由提示表达“何时不建议使用”，不能通过删除 schema 来表达“不要使用”。

2. **默认配置与旧配置迁移**
   - 桌面版缺失 `app_control` 时，默认至少启用 `browser_control`，使模型可以直接使用本地内置浏览器。
   - 对已有用户配置增加兼容迁移或明确设置入口，避免升级后继续命中 `enabled: false` / `session_control` 默认值。
   - 如果用户明确关闭浏览器控制，工具仍应暴露，并在执行时返回清晰错误：浏览器能力已关闭、需要在哪个设置中开启；不得让模型得出“没有这个工具”的错误结论。

3. **修正工具描述与替代路径**
   - 明确 `search_tool` 只搜索扩展工具，不负责网页搜索，也不负责查找内置工具。
   - 在浏览器工具描述中明确这是“Lfcode 桌面内置侧边浏览器”，并说明默认使用当前会话的浏览器 tab。
   - 当浏览器控制服务不可用时，返回可行动的服务状态和修复建议，而不是让模型自行猜测是否存在工具。

4. **增加回归测试**
   - 在 registry 定向测试中，使用非 `lfcode` provider（至少覆盖 `minimax-cn-coding-plan`）断言浏览器工具仍出现在可见工具列表。
   - 分别覆盖缺失 `app_control`、`enabled: false`、`permission: session_control`、`permission: browser_control` 和服务不可用场景。
   - 增加基础工具可见性矩阵，覆盖浏览器、`websearch`、`codesearch`、LSP、Question 和旧工具迁移状态，分别验证“工具是否暴露”和“是否建议使用”，不能把两者合并成一个布尔条件。
   - 更新现有 `read-only app control` 测试：不再用“工具不存在”作为低权限的唯一断言，改为断言工具仍可见且执行时返回权限错误。
   - 在安装使用版 smoke 中验证：模型可见 `app_open_browser`，调用后能打开侧边浏览器 tab，并可继续执行 snapshot/read/click 等动作。
   - 回归测试需检查实际发送给模型的工具 schema，不能只检查 registry 内部 `all()` 仍包含工具。

## 复现条件

1. 使用当前安装版桌面 Lfcode。
2. 全局配置未设置 `app_control`，或权限低于 `browser_control`。
3. 使用 `build` Agent 和 `MiniMax-M3` 发起会话。
4. 询问“使用内置浏览器搜索”。
5. 观察模型调用 `search_tool` 查询 `browser` / `playwright`，返回空列表，随后报告没有内置浏览器工具。

## 影响

- 模型无法使用桌面版的核心浏览器能力，网页研究任务被错误降级为只能抓取已知 URL。
- 模型会产生错误事实陈述，用户无法区分“功能不存在”和“工具被配置过滤”。
- 反复调用 `search_tool` 会增加 token、延迟和错误记录，并掩盖真正的配置/工具注册问题。

## 相关代码

- `packages/lfcode/src/tool/registry.ts`：浏览器工具注册与可见性过滤。
- `packages/lfcode/src/config/config.ts`：`app_control` 缺省配置解析。
- `packages/lfcode/src/tool/app_open_browser.ts`：打开内置浏览器 tab。
- `packages/lfcode/src/tool/app_browser_shared.ts`：浏览器控制权限检查与 automation client。
- `C:\Users\liangfeng\.lfcode\data\lfcode.db`：会话 `ses_0905384baffeu6HWFlk715hG71` 的实际工具调用记录。
