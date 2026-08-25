# 重启后子智能体入口消失及工具调用失败

## 问题

应用重启后，已有 session 的子智能体没有恢复到右侧“子智能体”栏；消息中的子智能体工具卡点击时只展开结果，不能切换到对应 agent 视图。并行审查的子 agent 还会反复出现 `tree` 权限拒绝、`search` 路径类型错误或权限拒绝。

## 原因

- `packages/app/src/context/sync.tsx` 在消息缓存和 session 缓存命中时提前返回，未独立恢复 actors 快照。
- actor 工具卡复用了可折叠 `BasicTool` 触发器，点击事件没有禁止折叠。
- 子 agent 工具授权将主 session 的旧规则放在 agent 规则之后，过期的 session 级 `* deny` 会覆盖 explore/general 自身能力。
- `packages/lfcode/src/tool/search.ts` 的 path 搜索实现只接受目录，但工具描述允许模型传入文件路径。

## 推荐解决方案

保留 actor 视图路由和像素头像；让 session sync 在 actors 未缓存时继续请求 actors；actor 卡片禁用折叠并派发统一视图切换事件；子 agent 以自身能力规则为最终规则；path 搜索对具体文件直接进行匹配并返回该文件。

## 状态

已解决

2026-07-19：已完成代码修复。`packages/lfcode` search/actor 定向测试通过，`packages/app`、`packages/ui`、`packages/lfcode` typecheck 通过；Windows 使用版已快速打包、同步并启动，`app:control health/state` 正常。仍需人工确认：重启后右侧子智能体列表出现、点击消息卡切换 agent 视图，以及并行审查中 tree/search 不再重复失败。
