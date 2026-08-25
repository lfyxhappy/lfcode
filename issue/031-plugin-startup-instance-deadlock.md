# 酒馆插件启动时回调实例路由导致全局加载悬挂

## 问题

pre 版启用 `lfcode-tavern` 后，会话、路径、项目、MCP 和插件设置页会一直加载。渲染器请求已带认证头，但 `/global/config` 成功后所有实例路由都没有响应。

## 原因

`packages/tavern/src/index.ts` 的插件 `server(...)` 在 `InstanceBootstrap` 内执行时，`await input.clientV2.project.createManaged(...)`。该 RPC 进入 `packages/lfcode/src/server/routes/instance/middleware.ts`，等待同一目录的 `Instance.provide(...)` 完成；而该 Instance 又正在等待插件 `server(...)` 返回，形成自等待死锁。

## 推荐解决方案

插件启动钩子不得等待当前 Instance 的 HTTP/RPC 路由。酒馆受管项目创建保留为幂等后台请求，让实例完成启动后再由同一请求继续执行；宿主对外部插件启动保留独立的 5 秒上限，并在超时后丢弃未完成插件的临时 hooks、标记 degraded，避免再次阻塞实例路由。

## 状态

已解决

2026-07-23：已将酒馆的 `createManaged` 调用改为不阻塞插件构造，并在插件宿主加入启动超时隔离。已在 `C:\算法\小应用\Lfcodepre\LfcodePre.exe` 真实验证：`/project`、`/session`、`/plugin`、`/plugin/library`、`/permission` 等实例路由均返回 200；从插件设置页点击“进入酒馆”后，成功创建受管会话并跳转到 `C:\Users\liangfeng\.lfcodepre\plugins\lfcode-tavern\data\projects\tavern`。
