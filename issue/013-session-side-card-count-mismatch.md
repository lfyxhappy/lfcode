# 会话侧边环境卡片的后台任务计数与列表口径不一致

## 优先级

中。计数与实际列表不一致会让用户误以为后台任务不存在，尤其容易误判已完成任务是否真正执行成功。

## 状态

已解决

## 问题

会话右侧 `Environment` 卡片中的 `Background processes` 显示数量为 `0`，但下方同时列出了 3 条任务记录，且三条记录状态都是 `completed`。

当前计数实际表示“正在运行的任务数”，列表表示“该会话的全部后台任务记录”，但界面标题没有说明这一口径，造成明显的 `0` 对 `3` 矛盾。

## 原因

### 已确认

- `SessionJobsRail` 通过 `backgroundJob.list({ sessionID })` 获取该会话的全部后台任务，没有传入状态过滤条件：`packages/app/src/components/session/session-jobs-rail.tsx:70-76`。
- 侧边卡片的 `jobItems()` 保留全部任务，并按运行状态和创建时间排序：`packages/app/src/components/session/session-jobs-rail.tsx:180-185`。
- 卡片计数只保留 `status === "running"` 的任务：`packages/app/src/components/session/session-jobs-rail.tsx:187`，显示位置为 `:343`。
- 当前运行会话对应数据库中有 3 条 `background_job` 记录，状态全部为 `completed`，因此 UI 显示 `0` 与数据库和列表内容一致，但语义不一致。
- 状态弹窗的 Jobs 标签和 Background processes 区域复用了相同的只统计运行中任务逻辑：`packages/app/src/components/status-popover-body.tsx:463-470`、`:526`、`:814`。

### 高概率原因

- 计数设计原本想表达“当前活跃后台进程数”，但列表后来扩展为历史任务列表，计数和列表没有同步调整为同一口径。
- `MCP` 标签存在同类口径风险：标签显示已连接数量 `mcpConnected()`，进入后却列出全部 MCP，包括 disabled/failed 状态：`packages/app/src/components/status-popover-body.tsx:457`、`:516`、`:600`。
- `Changes` 计数也存在未加载时显示 0 的潜在问题：`reviewCount()` 依赖 `reviewDiffs()`，而 diff 请求受 `wantsReview()` 控制；侧边摘要卡可以独立显示，可能在 diff 尚未加载时暂时显示 0：`packages/app/src/pages/session.tsx:598-653`、`:3895-3900`。

### 待验证

- 需要确认产品期望是显示“全部任务数”还是显示“运行中任务数”。如果保留运行中计数，应明确文案，例如“运行中”；如果标题保持 `Background processes`，更符合直觉的是显示当前列表条数或同时显示两个数。
- 需要在存在 running、completed、failed 混合任务的会话中，核对侧边卡片和状态弹窗是否采用同一显示口径。
- 需要切换到存在文件变更但未打开审查面板的会话，确认 `Changes` 是否会先显示 0，打开面板后才更新。

## 推荐解决方案

1. 先明确计数语义：建议将侧边卡片改为显示全部可见任务数，并在列表内单独通过状态点和状态文本区分 running/completed/failed；如果必须显示活跃数，应将标题改为“Running processes”。
2. 让 `SessionJobsRail` 与 `StatusPopoverBody` 共用同一套后台任务统计口径，避免同一会话在两个入口显示不同数字。
3. 对 MCP 标签明确使用“已连接”计数，或改为统计与列表一致的全部 MCP 数量。
4. 对 `Changes` 在摘要卡显示时主动加载所需 diff，或使用已持久化的 session summary 作为初始计数，避免“未加载”等同于“0”。
5. 增加混合状态回归验证：0/全部完成、1 个运行中 + 多个完成、失败/取消任务、MCP disabled/connected 混合，以及存在变更但审查面板未打开的会话。

## 相关代码

- `packages/app/src/components/session/session-jobs-rail.tsx`
- `packages/app/src/components/status-popover-body.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/lfcode/src/server/routes/instance/background-job.ts`
- `packages/lfcode/src/background-job/persistence.ts`
- `packages/lfcode/src/session/session.ts`
- `packages/lfcode/src/session/session.sql.ts`

## 复现条件

- 环境：Windows 桌面安装版 `C:\算法\小应用\Lfcode.exe`。
- 操作：进入包含已完成后台任务的会话，打开会话顶部摘要按钮显示 `Environment` 卡片。
- 预期：卡片数量与下方列表的统计口径一致，或明确标注数量代表运行中任务。
- 实际：当前卡片显示 `Background processes 0`，下方列出 3 条 `completed` 任务。

## 现场证据

- 2026-07-13 运行版截图：`Background processes` 显示 `0`，下方可见“查看games目录结构”“查看知识库顶层目录结构”“列出当前目录所有项”三条已完成任务。
- 当前运行会话的本地数据库查询结果：`background_job` 按状态统计为 `completed=3`，`running=0`。
- 同一会话的 `session` 记录中 `summary_files=0`、`summary_additions=0`、`summary_deletions=0`；因此本次截图中的 `Changes=0` 有数据库依据，不能与后台任务计数问题混为同一故障。

## 验收标准

- 侧边环境卡片的计数与其标题和列表保持同一统计口径。
- 状态弹窗中的 Jobs 标签、Background processes 区域与侧边卡片显示一致。
- 混合任务状态下，running/completed/failed/cancelled 的数量和状态文案均可解释。
- MCP 数量明确表示全部配置项或已连接项，不再出现标签数字与列表范围不一致而无说明的情况。
- 存在文件变更但 diff 尚未加载时，Changes 不得无依据显示为 0；安装版真实会话验证应覆盖该场景。

## 修复记录

- 2026-07-13：会话 Environment 卡片与状态弹窗均改用当前可见后台任务列表总数；运行、完成、失败和取消状态由列表内的状态点和文本区分。
- 因此已完成任务会显示在 `Background processes` 计数内，不再出现“0 个后台任务”同时列出历史任务的矛盾。
