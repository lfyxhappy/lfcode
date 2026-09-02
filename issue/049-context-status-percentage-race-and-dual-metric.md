# 上下文百分比双口径与异步乱序闪烁

## 优先级

高

## 状态

未解决

## 问题

上下文顶部按钮与弹层出现同时显示 3% 和 6% 等不一致数值，鼠标悬停或流式更新时百分比会闪烁、回退，用户无法判断当前真实上下文占用。

## 原因

### 已确认

- `ContextStatusPill` 的刷新请求只用 session/directory key 判断响应是否仍有效，没有 request generation 或序列号校验。
- 同一 key 的强制刷新可以并发发起，较早请求晚返回时仍会覆盖 `displayStatus`。
- 前端 `percentage()` 在存在 `context_percentage` 时使用后端值，字段缺失时回退到 `active_context_tokens / (context_window_tokens ?? usable_tokens)`。
- 后端显式百分比按完整 `context_window_tokens` 计算，而 `usable_tokens` 是扣除策略后的可用窗口，两个分母并不等价。

### 高概率原因

- 流式 step-finish 事件触发的连续刷新造成旧响应覆盖新响应，形成百分比回退或闪烁。
- 旧响应、缺失字段或快照切换时触发前端 fallback，使顶部与弹层短时间采用不同数据版本或分母。

### 待验证

- 需要在网络延迟可控的测试中记录每次请求序号、返回时间和渲染值，确认截图中的 3%/6% 是否由乱序响应单独造成。
- 需要确认是否存在旧构建残留或路由切换期间的短暂旧 DOM；源码当前仅发现一个 `ContextStatusPill` 挂载点。

## 推荐解决方案

为每次状态请求增加单调 generation，只接受最新请求结果；刷新期间保留同一份已确认快照，避免 loading/fallback 改变显示口径。前后端统一使用同一分母和同一舍入规则，缺失字段时显示未知而不是切换到 `usable_tokens` 估算。补充并发刷新、字段缺失、模型切换和弹层/顶部一致性测试。

## 相关代码

- `packages/app/src/components/session/context-status-pill.tsx`
- `packages/app/src/components/session/session-header.tsx`
- `packages/lfcode/src/session/context-status.ts`
- `packages/lfcode/src/session/context-snapshot.ts`
- `packages/lfcode/src/session/context-snapshot-store.ts`

## 复现条件

- Windows 预发布版，目标 session `ses_fad1eeb80ffeq1DJZ8BBo5ady5`。
- 在模型持续输出或快速触发刷新时，将鼠标移入上下文按钮并打开弹层。
- 期望：顶部和弹层始终显示同一百分比；实际：两处可能短暂显示不同百分比，且数值闪烁回退。

## 验收标准

- 顶部按钮、悬停提示和弹层在同一时刻只显示一个统一百分比。
- 并发刷新、慢响应、旧响应返回均不会覆盖最新状态。
- 后端字段完整时不触发第二套分母计算；字段缺失时有明确的一致降级表现。
- 流式输出期间仍保持实时更新，不通过降低刷新频率牺牲可见性。

## 现场证据

- 预发布运行态 session 当前可见且处于 streaming；此前 DOM 观察到顶部 `3%` 与弹层 `6%` 同时出现。
- `ContextStatusPill` 当前源码只发现一个挂载点，因此双值不是设计上两个独立组件的正常表现。
- 本记录来自只读审查，等待本轮测试和其他问题合并修复，尚未实施修复。

