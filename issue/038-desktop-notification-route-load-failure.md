# 桌面通知点击可能将内部会话路由作为页面加载，触发 ERR_UNEXPECTED

## 问题

Windows 桌面版偶发弹出“Lfcode failed to load”，主窗口加载地址形如：

```text
oc://renderer/Qzpc566X5rOVXOWwj-W6lOeUqFzpl7LogYo/session/ses_…
```

并显示 `-9 ERR_UNEXPECTED`。该地址缺少正常桌面壳使用的 `index.html#`：正常会话路由应为 `oc://renderer/index.html#/…/session/…`。

生产使用版日志已记录两组同类故障：`2026-07-25 14:26:58` 至 `14:27:03` 的连续四次尝试，以及 `2026-07-25 16:39:29` 的一次尝试。每次尝试都会分别触发 `did-fail-provisional-load` 和 `did-fail-load`，两条事件不代表两次独立用户操作。

## 原因

已确认的代码链路如下：

1. `packages/desktop/src/renderer/index.tsx` 使用 `MemoryRouter`，并将内部路由同步到 URL hash；正常导航只应改变 `index.html#/…` 的 hash，见 `syncRendererRoute`。
2. `packages/app/src/pages/layout.tsx` 在 Layout 初始化时通过 `setNavigate(navigate)` 注册内部导航函数。
3. `packages/desktop/src/renderer/index.tsx` 的通知点击回调调用 `handleNotificationClick(href)`。
4. `packages/app/src/utils/notification-click.ts` 在导航函数尚未注册时，退回到 `window.location.assign(href)`。对 `/…/session/…` 这样的应用内部 href，这会发起整页加载，得到日志中缺少 `index.html#` 的错误 URL。
5. `packages/desktop/src/main/windows.ts` 的 `oc://renderer` 协议处理器将 URL pathname 映射为打包 renderer 目录下的静态文件并用 `net.fetch(file:)` 读取。会话路由不是静态文件，因此该整页加载在 Chromium 中以 `ERR_UNEXPECTED` 失败。

因此根因不是会话、服务端或网络失败，而是通知点击与路由初始化存在竞态：例如窗口刚启动、当前 renderer 尚未挂载 Layout，或发出通知的 renderer 实例尚未完成路由初始化时，点击通知会走错误的浏览器级导航兜底。

日志中可以确认故障 URL、错误码和窗口为 `main`；但当前没有记录“哪个通知、哪个 renderer 实例、当时 nav 是否为空”，所以不能仅凭现有日志断言每一次的具体通知来源。`window.location.assign` 是现有源码中唯一会把此类内部 href 转成页面导航的路径。

## 推荐解决方案

1. 删除或限制 `handleNotificationClick` 的 `window.location.assign(href)` 兜底：对以 `/` 开头的应用内部路由，导航函数未就绪时应暂存一次待处理 href，等待路由注册后通过 `navigate` 消费；不能整页加载。
2. 对外部绝对 URL 保留显式外部打开逻辑，不与应用内路由共用 `location.assign`。
3. 注册 `setNavigate` 后立即消费待处理通知；需要定义最后一次点击覆盖、窗口销毁和重复点击的语义。
4. 增加最小回归测试：当 `nav` 未注册时点击 `/encoded-project/session/ses_x`，不得调用 `location.assign`；注册后应恰好通过内部 `navigate` 导航一次。
5. 增加脱敏诊断日志，记录通知 href 类型、是否已有导航函数、窗口标识和最终导航方式，便于确认竞态的发生频率；不得记录完整会话内容或凭据。
6. 在修复后用 `C:\算法\小应用\Lfcodepre` 的打包副本验证：冷启动后尽早点击内部通知、主窗口最小化/恢复、以及存在 detached side panel 时的通知点击均应保留 `oc://renderer/index.html#/…`，且不出现 `renderer load failed`。

用户临时遇到该弹窗时，`Reload` 往往只会重试同一个错误路径；应使用 `Relaunch`，让主窗口从 `index.html` 重新启动。

## 状态

已解决

2026-07-26：内部通知在 Router 尚未注册时仅暂存最后一个 href，注册后消费一次；不会再对内部路径调用 `location.assign`。外部 `http/https` 目标改为明确的外部打开路径。桌面主窗口增加 renderer 路径恢复，误入 `oc://renderer/<route>` 的顶层导航会回到 `oc://renderer/index.html#/<route>`；正常 `index.html#…` 与 `loading.html#…` 的 hash 导航不受拦截。

验证：通知点击 App 回归 7/7、Desktop renderer route 回归 5/5、App/Desktop 类型检查通过。Windows 预发布安装版冷启动及 detached side panel 共存时，主窗口始终保持 `index.html#` URL，自动化诊断未发现 `ERR_UNEXPECTED` 或 renderer load failure。
