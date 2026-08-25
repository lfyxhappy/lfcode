# 内置浏览器标签持续显示加载中

## 问题

在隔离项目 `scratch/pre-experience-lab` 中，使用 headless 方式打开本地页面后，分离浏览器窗口已完成加载，但主窗口会话状态仍长期显示 `loading: true`。可见 sidebar 浏览器在监听器晚于完成事件注册时也可能保留旧的加载状态。

## 原因

分离面板是独立 renderer，`packages/app/src/pages/session/browser-panel.tsx` 中的导航事件只更新该窗口自己的 `layout` store；主窗口没有接收该更新。sidebar 路径还存在 webview 在事件监听安装前已经完成时，持久化 `loading` 状态无法回补的风险。

## 推荐解决方案

已在 `packages/desktop/src/main/ipc.ts`、`packages/desktop/src/main/runtime.ts`、预加载桥和 `packages/desktop/src/renderer/index.tsx` 增加最小状态事件。分离窗口上报 URL、标题、加载、错误和关闭状态，主进程仅转发给同会话来源主窗口；`packages/app/src/pages/session.tsx` 消费事件并更新或移除对应 tab。`browser-panel.tsx` 同时在挂载时回补已完成 webview 的状态。

`bun run typecheck` 在 `packages/app` 和 `packages/desktop` 通过。预发布 `LfcodePre` 自动化验证：headless 与 sidebar 分别打开同一本地 Focus Timer 页面后，主窗口状态都收敛为 `loading: false`；随后关闭 headless 页面，该 tab 从主窗口状态移除。

## 状态

已解决
