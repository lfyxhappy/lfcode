# 会话停止等待收尾，旧执行回写状态导致输入长期锁死

## 问题

使用版会话 `ses_068276909ffefY6nmRNZPr6fjk` 在模型请求网络异常或长时间无响应后，点击“停止”不能及时恢复输入；继续点击其他会话时，又可能触发错误的顶层路由加载并显示 `ERR_UNEXPECTED`。

日志显示该会话出现 `ECONNRESET`、多次 `cancel-timeout`，以及稍后才落库的 `AbortError`。这说明请求取消已发出，但取消路径等待底层流/清理完成，用户界面长期维持 busy/retry 状态。

## 原因

`packages/lfcode/src/session/prompt.ts` 原先先同步执行 Stop Hook，再调用 `SessionRunState.cancel()`；任一 Hook 卡住都会阻塞真正的取消。

`packages/lfcode/src/session/run-state.ts` 原先同步等待 `Runner.cancel` 的 fiber 终止。网络流或其清理段不可及时中断时，会落入 `cancel-timeout`。虽然超时后会删除 runner，但旧执行仍可通过主循环、重试或 Max 状态回写把 session 重新标为 `busy`/`retry`，造成“没有可取消的 runner，但输入仍被禁用”的状态漂移。

异步 `prompt_async` 在返回 `204` 后才调度 `SessionPrompt.prompt()`；用户在 runner 真正创建前点击停止时，旧实现会先把会话置为 idle，随后迟到的 prompt 又照常发起模型流。`SessionProcessor.process()` 还会用新建的本地 signal 覆盖上游 signal，导致停止没有直接传到 provider 流；前端轮询收到旧 `idle` 快照时也会立刻撤掉停止入口。

## 推荐解决方案

1. Stop 请求必须先从当前会话解绑 runner、清空 steer、恢复 idle/waiting 状态，再异步等待旧 fiber 收尾；用户操作不应以底层网络流退出为前提。
2. Stop Hook 必须放到取消之后并在受限后台执行，Hook 失败或超时只记录诊断，不能阻塞会话解除占用。
3. 运行状态只由当前 runner 生命周期维护。run loop、模型重试与 Max 过程不能让已脱离的旧执行重新发布 busy/retry。
4. 回归覆盖网络流不可立即中断、Stop Hook 卡住、取消后立即再次发送，以及旧执行延迟退出四种场景。

## 已实施

1. `SessionRunState.reserveAsync()` 在 `prompt_async` 返回前原子占位并发布 busy；停止会同步 abort 该占位。迟到 prompt 携带该 signal，已取消时不会创建 runner 或发起模型请求。
2. 每个 runner 持有自己的 `AbortController`。停止会先 abort、解绑 runner 并恢复 settled 状态，再在后台中断旧 fiber；旧 runner 的 `onIdle` 只在仍拥有当前 map 项时才能写状态。
3. `SessionProcessor` 把 runner signal 绑定到本地 stream controller，屏蔽取消后缓冲的 SSE 事件；普通流、fork agent 流和 Max Mode 的 candidate、judge、fallback 均传递该 signal。
4. `session-status-reconciler` 对轮询 `idle` 快照增加短暂 delta 活动保护，但直接收到的停止状态仍立即生效。

## 验证

- `packages/lfcode`、`packages/app` 包级 typecheck 通过。
- `packages/lfcode/test/server/session-prompt-busy.test.ts` 8 项通过，覆盖“异步占位后立即停止不得发起模型请求”。
- `packages/lfcode/test/session/max-mode-econnreset.test.ts` 8 项通过，覆盖 Max Mode candidate/judge 的取消 signal 透传。
- `packages/app/src/context/global-sync/session-status-reconciler.test.ts` 3 项通过，覆盖流式 delta 到达时不接受过期 idle 快照。
- 已打包、同步并可见启动 `C:\算法\小应用\Lfcodepre\LfcodePre.exe`；用户可在真实 provider 会话中继续验证停止动作。

## 状态

已解决

2026-07-25：已先解除 run-state 占用并将 runner 取消和 Stop Hook 放至后台收尾；主 run loop 不再每轮回写 busy，processor 在由 run-state 托管时不再独立回写 retry，Max 过程也不再独立覆盖状态。

2026-07-25：补齐 prompt_async 建 runner 前的取消竞态、会话级 provider abort 透传和前端 stale-idle 防护；已完成定向回归、包级类型检查及 pre 安装版同步启动。
