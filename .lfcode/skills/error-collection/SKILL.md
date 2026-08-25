---
name: error-collection
description: 记录已验证的工程错误、根因、错误模式和防复发验收规则，作为反面教材使用。
---

# 错误合集

## 使用时机

当用户指出回归、重复修复失败、运行态与源码不一致，或发现同类低级错误时，先记录事实再继续修复。记录必须基于真实复现，不把“构建成功”当作“功能修复”。

## 记录格式

每条记录包含：

- 问题现象和用户复现步骤
- 运行态证据（页面、DOM、进程、请求结果）
- 根因和完整生命周期链路
- 错误决策（为什么之前的修复不成立）
- 正确修复和明确的非目标
- 防复发测试、切换/重载/重启验收项

## 反面案例：供应商用量按钮（2026-08-23）

### 现象

应用初始页面可以打开“查看用量”，进入具体对话后同一按钮点击无反应；按钮事件返回成功，但浮层节点不存在。切换对话时还可能残留旧供应商状态。

### 根因

这是一个完整的入口、状态、挂载和验证链路问题，不是单一接口问题：

- 入口曾经依赖受控 Kobalte Popover。Trigger 自己会 toggle，业务 click handler 又修改同一个 `open`，造成双重切换；外部 `open`、Trigger 内部状态和侧栏/会话重渲染叠加后，出现“按钮有点击但浮层不存在”。
- 通用 Popover 曾加入全局 `focusin` 失焦关闭。Portal 内容刚挂载、焦点仍在按钮或父级重渲染时，这个监听可能把刚打开的浮层立即关掉。
- 入口组件一度错误地放进 `props.children`，导致它不在稳定的 AppLayout action 区域；切换对话、目录或侧栏时组件生命周期不稳定。
- 能力/供应商状态变化没有一开始就拆成“独立浮层状态 + 当前 provider 数据”，旧会话状态因此可能泄漏到新会话。
- 验证链路不完整：反复验证首次页面和构建结果，没有在同一预发布运行窗口覆盖进入对话、切换对话、切换供应商、收起再展开侧栏、弹层内点击和弹层外点击。

### 错误决策与低效原因

- 把“点击按钮”误读成“按钮外关闭”，交互契约没有先写成可验收的状态机：按钮点击打开/再次点击切换，小窗内部点击保持，小窗外点击关闭，Escape 关闭。
- 只看源码、类型检查、打包和 HTTP 200，过早把“请求成功”当成“用户看到了弹窗”；没有优先读取真实窗口 DOM、`aria-expanded`、Portal 节点和当前 provider。
- 在同一受控 Popover 机制上连续堆 `open`、`onClick`、微任务和 focus 监听补丁，失败两次后仍未立即切换策略，违反了“同策略重复失败必须换机制”的纪律。
- 没有先画完整生命周期：入口挂载位置、provider 来源、状态所有权、Portal 挂载点、外部点击边界、会话/侧栏重渲染边界；因此修复了局部症状又引入新的生命周期问题。
- 没有把每个失败尝试按假设、证据、策略和回归项记录下来，导致重复排查、重复打包和重复人工确认，效率显著下降。
- 运行态验证没有一次性覆盖完整矩阵，迫使用户多轮发现“进入对话后失效”“切换对话后失效”“收起再展开才恢复”等本应由自动化验收捕获的问题。

### 最终修复与边界

- `ProviderQuotaSidebarAction` 使用自己的显式 `open` 状态和原生事件监听，不再依赖 Kobalte Trigger 的内部 toggle。
- 小窗通过 `Portal mount={document.body}` 独立挂载，使用固定定位和 `z-index: 2147483647`，不受侧栏 overflow、层叠上下文和父节点裁剪影响。
- 全局监听只处理 pointerdown 和 Escape：目标在触发按钮或小窗内部时保持打开，只有小窗外才关闭；小窗关闭按钮仍可显式关闭。
- 额度请求按 `providerID` 使用独立 `Map` 缓存。当前对话只提供当前 provider 的 ID/名称，不能拥有或控制小窗生命周期。
- 入口固定通过 `AppLayout quotaAction` 渲染在稳定 action 区域；provider 变化只更新显示数据，不把对话状态写入小窗。

### 防复发规则

- 共享 Popover 组件必须验证：首次打开、关闭、连续开关、切换路由/会话、重新挂载。
- 受控 Trigger 若有内部 toggle，不得在同一同步 click handler 中再次改变相同状态。
- 会话或供应商变化时，使用当前 provider key 重建有状态的浮层实例。
- 复杂组件连续两次同策略失败后，必须改用独立显式状态和显式渲染，不再继续堆补丁。
- 验收必须查询真实运行窗口中的 `aria-expanded`、浮层 DOM、`data-provider-id`，并确认当前对话供应商一致。
- 每次涉及浮层、侧栏或会话路由的修改，必须在预发布安装副本完成以下矩阵：首次打开、再次点击关闭、小窗内部点击保持、小窗外点击关闭、Escape 关闭、切换对话、切换供应商、收起/展开侧栏、刷新/重新挂载。
- 必须记录实际运行进程、窗口 ID、DOM 快照和关键属性；typecheck、构建、接口 200 只能作为前置证据，不能作为交付证据。
- 连续两次同一交互机制失败后，停止补丁式修改，重新梳理状态所有权和 DOM 挂载边界，并改用可区分根因的实验。
- 交付前先写 bug contract 和验收矩阵，再实现；每次失败都记录 hypothesis、prediction、strategy-key、verification 和 regressions，避免重复劳动。

## 反面案例：OpenCode Go reasoning 模型 shell 工具不可用（2026-08-23）

### 现象与证据

预发布选择 `opencode-go/deepseek-v4-flash-vision-exp` 后 Build 模式无法可靠使用 shell。旧运行日志出现 `Thinking mode does not support this tool_choice` 与 unavailable tool；预发布旧配置还把该模型持久化为 `reasoning:false`。修复后的真实 DOM 显示 `Shell processes 3`，三个 shell 结果均为 `completed`，输出包含当前工作目录。

### 根因与错误决策

- 工具压缩策略遗漏了 shell，导致模型看不到编码闭环。
- 没有按 provider/model wire contract 处理 reasoning 模型对 `tool_choice=required` 的限制。
- 能力归一化新增参数未接入实际调用链，静态推断正确但运行态仍被旧配置污染。
- 只看源码、测试和打包会误判“已修复”，没有尽早在预发布真实会话检查 available tools 和 tool result。

### 正确修复与防复发

- 保留 shell/read/edit/skill/task 原生工具；OpenCode Go reasoning 使用 `tool_choice=auto`。
- `inferredLast` 必须贯穿 `runtimeCapabilities -> normalizeModelCapabilities`；模型名 profile 在无显式声明时覆盖旧缓存档位。
- 验收必须在预发布安装副本真实发起 shell，检查 DOM 工具卡结果和日志，并覆盖重启、切换会话、切换模型；构建成功不等于工具可用。

### 追加教训：运行时资产必须纳入发布门禁

本次旧包缺少 tree-sitter 三个 WASM，shell 首次解析即 `ENOENT`，并沿未捕获 rejection 退出 Electron。以后所有动态导入的 WASM/worker/native 资产都必须在打包脚本中做归档清单断言，同时为解析和初始化失败提供结构化工具错误；不能只验证 JS 入口存在，也不能把“重启后暂时恢复”当作根因已解决。
