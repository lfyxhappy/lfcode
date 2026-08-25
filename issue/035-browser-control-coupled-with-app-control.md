# 内置浏览器控制与 App Control 总开关耦合

## 优先级

高

## 状态

已解决

2026-07-26：已将 `browser_control` 拆为独立全局配置和设置页区域。浏览器工具改用独立验权，不再被 `app_control.enabled` 短路；缺失配置默认完整控制，旧 `browser_control` 配置在保存时迁移为 App 的 `session_control` 加浏览器 `interactive`。取消首次打开的重复确认，并为浏览器关闭、只读权限不足、自动化服务不可达和无活动 tab 提供稳定错误码及恢复建议。

验证：`packages/lfcode/test/tool/app-control.test.ts` 21/21、App 设置 helper 7/7 通过，Lfcode/App/SDK 类型检查和 SDK 生成通过。Windows 预发布安装版中已确认独立“内置浏览器控制”设置可见、默认显示交互控制，且浏览器可正常打开。

## 问题

Lfcode 的内置侧边浏览器属于独立的浏览器运行面，但模型调用 `app_open_browser`、`app_browser_snapshot`、`app_read_browser_page` 等工具时，仍然先经过 App Control 的全局启用开关。

这造成了两个不一致：

- 桌面自动化服务在 HTTP 层已经把 `/browser/*` 路由单独归类为 `browser_control`，但模型侧执行入口仍要求 `app_control.enabled = true`。
- 工具 registry 已经让浏览器工具在 App Control 关闭时保持可见，模型实际调用后却收到 `App Control is disabled in global settings.`，用户无法区分“浏览器控制未授权”“App Control 未启用”和“桌面自动化服务不可用”。

此外，首次打开侧边浏览器还要求工具参数传 `confirm=true`。用户在自然语言中明确说“只读排查 bug”或“打开这个网页”，本身已经表达了当前任务范围内的授权，但当前实现没有把该用户授权传递给浏览器会话授权状态，导致模型再次向用户索要一轮确认。

## 原因

### 已确认

- `packages/lfcode/src/tool/app_browser_shared.ts` 中所有浏览器工具通过 `app.client("browser_control")` 获取客户端。
- `packages/lfcode/src/app-control/client.ts` 的 `ensureAppControlAccess()` 先检查 `current.enabled`，关闭时直接抛出 `App Control is disabled in global settings.`，随后才检查 `browser_control` 权限等级。
- `packages/lfcode/src/config/config.ts` 只定义了 `app_control.enabled` 和 `app_control.permission`；`browser_control` 只是权限等级，不是独立的启用配置。
- `packages/desktop/src/automation-security.ts` 已将 `/browser/*` 路由最低能力定义为 `browser_control`，说明桌面自动化层已经具备浏览器与普通 App Control 分级的基础。
- `packages/app/src/components/settings-app-control.tsx` 只有“允许模型控制应用”一个总开关和一个权限级别选择，没有浏览器控制专属的启用状态或授权说明。
- `packages/lfcode/src/tool/app_open_browser.ts` 的首次打开逻辑把 `confirm=true` 定义为“用户明确批准打开当前会话的侧边浏览器”，但授权状态由模型工具参数触发，没有和当前用户消息的授权意图建立明确的运行时边界。
- `packages/lfcode/src/tool/registry.ts` 当前已让浏览器工具在 App Control 关闭或权限不足时继续出现在模型 schema 中，因此主要故障已经从“工具不可见”转移为“执行入口错误耦合”。
- 定向测试 `packages/lfcode/test/tool/app-control.test.ts` 当前有 15 个测试通过、2 个测试失败；失败包含关闭 App Control 时的执行错误预期与实际服务发现错误不一致，说明权限检查、服务发现和测试契约已经发生漂移。

### 高概率原因

- `app_control` 同时承担了“是否允许模型控制 Lfcode 应用”和“是否允许模型控制内置浏览器”两个不同职责。
- `browser_control` 被实现成 App Control 权限层级，而不是独立的浏览器访问策略；因此浏览器工具无法在不开放普通应用控制的情况下单独工作。
- 会话浏览器的首次打开授权属于浏览器资源访问授权，但当前通过 `confirm` 参数由模型自行回传，没有明确的用户消息授权投影或统一授权事件。
- 工具执行入口没有把配置拒绝、会话授权拒绝、自动化服务缺失分别转换成稳定且可行动的错误类型，模型容易将配置拒绝误报为功能不存在。

## 推荐解决方案

1. **拆分能力边界，但默认授予最大权限**
   - 保留 `app_control` 负责 Lfcode 主界面、会话、编辑器、输入框等应用控制能力。
   - 新增独立的全局 `browser_control` 配置，至少包含 `enabled` 和 `permission: "read_only" | "interactive"`。
   - 浏览器工具统一调用 `ensureBrowserControlAccess()`，不再调用 `ensureAppControlAccess()`。
   - `app_control.enabled = false` 时，只关闭普通 Lfcode 应用控制；只要 `browser_control` 允许，内置浏览器仍可独立工作，反过来也成立。
   - 缺失配置时默认启用两类能力并授予最高权限：`app_control.enabled = true`、`app_control.permission = "full_app_control"`，以及 `browser_control.enabled = true`、`browser_control.permission = "interactive"`。只有用户明确关闭或降低权限时，才执行限制。
   - 桌面 automation server 的 `/browser/*` 能力等级继续作为底层认证和路由安全边界，但不能因为上层 App Control 开关关闭而被错误短路。

2. **默认允许完整浏览器操作，支持显式收窄**
   - 只读能力包括当前 tab 查询、页面读取、DOM snapshot、截图、控制台/网络诊断、资源元数据读取和缓存资源列表。
   - 交互能力包括打开或导航 tab、点击、输入、滚动、等待、聚焦、关闭和下载资源。
   - 默认 `browser_control.permission = "interactive"`，模型可以直接完成打开、读取和后续交互，不为普通浏览器操作增加二次确认。
   - 用户或设置明确要求“只读”“仅限某个域名”或关闭浏览器控制时，才把当前 session 的有效权限收窄；自然语言中的限制应被继承，不应再重复询问同一授权。
   - `app_open_browser` 虽然会创建 tab，但它不是普通 Lfcode 界面控制，不应因此要求开启整个 App Control。

3. **取消重复确认，将用户授权接入 session 上下文**
   - 用户消息明确要求打开、查看或排查网页时，当前 session 直接继承浏览器访问授权；在默认最大权限下，首次打开侧边浏览器不应再要求模型额外猜测并传 `confirm=true`。
   - `app_open_browser` 和 Playwright `browser_navigate` 继续共用同一 session 授权服务，但该服务负责记录 session、权限范围和审计信息，不把普通首次打开阻断成第二轮确认。
   - `confirm` 参数可以保留用于旧客户端兼容，但在浏览器控制已启用且没有显式收窄策略时不应是必填条件。
   - 用户明确说“只读排查”时，session 有效权限可以收窄为只读；用户没有提出限制时，不应由工具或模型擅自降级默认的最大权限。

4. **返回稳定、可行动的错误**
   - 分别定义浏览器控制被用户关闭、浏览器权限被用户降低、当前 session 被显式收窄、automation 服务缺失和没有活动 tab 等错误类型。
   - 对缺失配置不要返回“功能已关闭”；缺失配置应解析为最大权限。只有用户明确关闭或降低权限时，错误才提示“请在设置 > 浏览器控制中恢复权限”。
   - registry 阶段继续暴露浏览器工具；配置和服务状态在执行阶段处理，避免模型把工具不存在与工具暂不可用混淆。

5. **同步设置与迁移**
   - 在设置中新增独立的“内置浏览器控制”区域，默认显示为已启用和完整控制，并显示当前 automation 服务状态；用户可以主动降级或关闭。
   - 对完全缺失 `app_control` 的旧配置按最大权限补全：App Control 默认 `enabled: true / full_app_control`，浏览器默认 `enabled: true / interactive`。
   - 对用户已经明确写入的旧配置保留限制意图并迁移：`enabled: false` 继续关闭对应能力；`read_only` 和 `session_control` 不自动升级浏览器权限；旧 `browser_control` 映射为普通 App Control 的 `session_control` 加浏览器 `interactive`；旧 `full_app_control` 映射为两者最大权限。
   - 不得把“缺失配置”和“用户明确关闭”混为一谈。前者采用最大权限默认值，后者必须被保留并在 UI 中清晰展示。

6. **增加回归验证**
   - 覆盖缺失配置时 App Control 和 Browser Control 都默认启用最大权限，且浏览器可以直接打开、读取和交互。
   - 覆盖 App Control 开/关 × Browser Control 开/关，确认两类能力可以独立工作；覆盖用户主动降级后的只读和交互权限矩阵。
   - 覆盖缺失配置、旧配置迁移、automation 服务缺失、无 tab、首次打开、同 session 重用授权和跨 session 隔离。
   - 覆盖用户消息已明确授权浏览器操作时不再重复询问；覆盖用户明确要求只读时不会执行超出当前 session 范围的交互动作。
   - 通过预发布安装版验证真实设置页面、模型收到的工具 schema、实际 `/browser/*` 请求和侧边浏览器 tab 状态。

## 影响

- 用户已经允许模型处理网页，但 App Control 未开启时，内置浏览器仍无法使用。
- 模型收到的错误信息容易把权限配置问题解释成能力不存在，导致降级到 `webfetch` 或错误搜索 `search_tool`。
- 只读排查任务被迫重复确认，增加交互轮次、延迟和 token 消耗。
- 按默认最大权限原则，模型在新安装和缺失配置时可以直接使用完整的 Lfcode 应用和内置浏览器能力；这是明确的产品策略，不应再通过默认关闭或隐式降级规避。
- 风险控制应放在 loopback automation 认证、session 隔离、用户显式降级、审计记录和底层路由能力边界上，而不是通过默认拒绝模型能力实现。

## 相关代码

- `packages/lfcode/src/app-control/client.ts`：当前统一的 App Control 启用和权限检查。
- `packages/lfcode/src/tool/app_browser_shared.ts`：浏览器工具获取客户端的公共入口。
- `packages/lfcode/src/tool/app_open_browser.ts`：首次打开浏览器和 `confirm` 参数。
- `packages/lfcode/src/server/routes/browser-session-authorization.ts`：当前按 session 保存浏览器授权的实现。
- `packages/lfcode/src/tool/registry.ts`：浏览器工具 schema 可见性与执行前配置过滤。
- `packages/desktop/src/automation-security.ts`：桌面 automation `/browser/*` 路由能力分级。
- `packages/app/src/components/settings-app-control.tsx`：当前 App Control 设置 UI。
- `packages/lfcode/test/tool/app-control.test.ts`：当前 App Control 和浏览器工具回归测试。
