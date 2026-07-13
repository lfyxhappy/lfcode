# 长时间 shell 服务被对话生命周期终止

## 状态

已解决

## 当前实现

- `dev`、`serve`、`watch`、Vite/Next/Jupyter 等命令会自动进入已有 durable background-job runtime。
- 任务使用独立 detached wrapper，不跟随 session abort；状态面板已有状态、PID、日志、reconcile 与停止操作。
- 仍待在使用版实际启动一个监听服务，再中断会话确认服务持续运行。

## 问题

使用普通 shell 启动 Vite、Node、Jupyter 或其他监听服务后，停止对话、超时或 runner 取消可能导致服务进程被一起终止。

## 原因

普通 shell 调用挂在当前 Session runner 上。Windows 清理进程时使用 `taskkill /T /F`，会递归终止命令的整个子进程树，因此 npm、Node 和 Vite 可能同时被杀掉。

## 推荐解决方案

1. 将 `dev`、`serve`、`watch`、`vite`、`next dev`、`jupyter`、监听端口等任务默认识别为后台任务。
2. 自动使用 shell 工具已有的 `background: true`，交给 durable background job runtime。
3. 明确区分“停止模型推理”“停止普通 shell”“停止后台任务”和“关闭应用”。
4. 增加后台任务中心，展示任务 ID、PID、端口、工作目录、日志和停止操作。
5. 在后台任务没有被明确停止时，不应由普通 session abort 递归清理。

## 当前事实

shell 工具已经支持 `background: true`，但模型选择后台模式的策略和用户可见的任务管理仍不完整。

## 相关代码

- `packages/lfcode/src/tool/bash.ts`
- `packages/lfcode/src/session/run-state.ts`
- `packages/lfcode/src/session/prompt.ts`
- `packages/lfcode/src/effect/cross-spawn-spawner.ts`
