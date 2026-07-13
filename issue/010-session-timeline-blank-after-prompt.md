# 发送消息后会话时间线偶发显示为空白

## 优先级

高。消息未丢失，但主聊天区域看起来像历史记录被清空，容易造成用户误判和重复操作。

## 状态

已解决

## 问题

会话 `ses_0ab7d75a8ffeSfIzupAXA9IFJ5`（标题 `Auto Dream`）在发送消息后曾出现主时间线整块空白：页头、输入框和“继续”按钮仍在，但此前消息不可见。该问题为偶发，当前尚未在保留现场 DOM 的条件下完成稳定复现。

## 原因

### 已确认

- 不是持久化数据被删除或 SQLite 损坏：`C:\Users\liangfeng\.lfcode\data\lfcode.db` 的 `quick_check` 返回 `ok`；该会话仍有 57 条 `message` 和 218 条 `part`。
- 会话只有 2 条 user message，但分别关联 33 条和 46 条 assistant message。前端按 user message 聚合虚拟化回合，因此运行中的桌面端诊断把它记录为 2 个 timeline turns 是正常投影，并非只加载了两条消息。
- 运行中桌面端的 timeline cache 和 visual cache 都保留了该会话条目；说明异常出现前前端已经接收过该会话数据。

### 高概率原因

- `packages/app/src/pages/session.tsx` 在 timeline surface 切换/恢复时，会把当前滚动容器的 DOM 克隆到绝对定位、最高层的 visual snapshot host。若虚拟列表正处于卸载、重算或恢复窗口，克隆内容可能为空或不完整，并遮住仍在恢复的真实时间线。
- `TimelineVirtualController` 的 restore 生命周期存在 `requested`、`preparing`、`committed`、`cancelled` 多阶段。发送新消息、流式更新、滚动恢复与 surface handoff 并发时，旧快照与真实虚拟列表的显示权交接没有“快照有效且非空”这一保护条件。
- `sync.session.sync(...)` 的调用点会静默吞掉失败；当消息页拉取或并发恢复失败时，界面没有显式错误态，也没有可靠地保留最后一次可见列表，增加了空白页被掩盖的风险。

### 待验证

- 截图发生时的 DOM、`timelineSurfacePhase`、snapshot host 子节点和消息接口响应已不在当前窗口，尚不能确认是 visual snapshot 覆盖、虚拟列表渲染为空，还是一次静默的消息页同步失败。

## 推荐解决方案

1. 将 visual snapshot 仅作为短暂 handoff：克隆前验证存在可见的 `[data-viewport-turn]`，否则不挂载；挂载后若真实列表未在一帧内恢复，应立刻撤销覆盖层。
2. 对 `cancelled`、超时、session ID/revision 变更和消息同步失败统一清理 snapshot host；不得让透明或空快照盖住真实列表。
3. 消息同步失败应保留上一次成功的消息/part 投影，并在诊断状态中记录错误，不应静默吞掉异常后留下无法区分的空白区域。
4. 增加回归验证：构造“少量 user turn + 大量 assistant/tool part”的会话，在流式发送、滚动、切换后返回的组合下，断言 timeline 至少存在相应数量的 `[data-viewport-turn]`，且 snapshot host 不会覆盖空内容。

## 相关代码

- `packages/app/src/pages/session.tsx`：会话同步发起、timeline snapshot host、restore phase 与 automation diagnostics。
- `packages/app/src/pages/session/session-timeline-visual-cache.ts`：视觉快照克隆、缓存和读取。
- `packages/app/src/pages/session/timeline-virtual-controller.ts`：虚拟时间线的恢复、取消和稳定性提交。
- `packages/app/src/context/sync.tsx`：消息分页加载、会话缓存与同步。
- `packages/app/src/pages/session/session-timeline-history.ts`：按 user turn 选择可见历史窗口。

## 现场证据

- 2026-07-12 只读检查：目标会话数据库完整性为 `ok`，`message=57`、`part=218`。
- 该会话的 2 个 user turn 分别拥有 33、46 个 assistant 子消息；运行中的桌面端 timeline cache 也显示 `turns=2`，与这一投影一致。
- 当前桌面端未保留该会话的异常 DOM，且本地日志没有对应的服务端错误；问题归类为前端渲染/恢复链路，尚待带现场诊断的稳定复现。

## 修复记录

- 2026-07-13：移除了 visual snapshot 回写到可见 timeline host 的路径；快照只保留为运行时诊断缓存，不再覆盖真实虚拟列表。
- 空 turn 或不含 `[data-viewport-turn]` 的快照会立即丢弃，避免空克隆遮住真实消息；会话刷新无数据页时保留最后一次成功投影。
- 定向 timeline suite 通过 15 项，其中覆盖空 visual handoff、尾部新增 turn 的测量稳定性以及缺失锚点到底部兜底。
