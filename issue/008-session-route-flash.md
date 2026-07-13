# 会话路由导致全屏闪烁

## 问题

切换会话时偶发、创建会话时稳定出现全屏启动图闪烁；点击 Memory 状态面时也可能触发同类现象。

## 原因

- `packages/app/src/components/connection-gate.tsx` 用全局 `Suspense` 包住整个应用，fallback 是全屏 `Splash`。
- `packages/app/src/pages/session.tsx` 在 JSX 中读取会话同步资源；加载目标会话时该资源会向上 suspend，直接触发全屏 fallback。
- `packages/app/src/components/session/maintenance-status-pill.tsx` 直接读取维护资源，打开或刷新面板也会触发相同路径。
- `packages/app/src/pages/directory-layout.tsx` 在新建会话路由中调用 `sync.session.sync(undefined)`，造成多余的 `Session not found` 请求和重试。
- 仅依赖调用方守卫不够：延迟 effect 或集成调用在运行时仍可能把空 ID 传入公共同步入口。

## 推荐解决方案

将连接门改为只管理启动期健康检查的显式状态，不再作为全应用资源的 Suspense 边界；会话和维护请求改为非阻塞读取，并只在存在会话 ID 时同步。共享同步入口也必须拒绝空 ID。会话正文的切换空档仅由本地 timeline handoff 处理，不允许上升为全屏加载。

## 状态

已解决
