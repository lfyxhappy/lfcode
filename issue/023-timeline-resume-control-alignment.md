# 返回底部按钮与消息列未居中对齐

## 问题

在桌面端会话页面显示右侧 Environment/摘要面板时，时间线底部的“返回底部”按钮向右偏移，未与消息列和输入框的水平中心对齐。

## 原因

`packages/app/src/pages/session/message-timeline.tsx:679-702` 中，`timeline-resume-control` 是时间线完整根容器的绝对定位子元素，并使用 `left-1/2 -translate-x-1/2` 居中。该根容器仍覆盖右侧面板所占的区域。

同一组件中的消息内容容器在 `rightInset` 开启时，将宽度缩窄为 `calc(100% - clamp(336px, 22vw, 440px))`，见 `packages/app/src/pages/session/message-timeline.tsx:760-765`。输入框区域也采用完全相同的宽度规则，见 `packages/app/src/pages/session/composer/session-composer-region.tsx:150-158`。

`rightInset` 由 `desktopSummaryCardVisible()` 传入时间线和输入框，见 `packages/app/src/pages/session.tsx:3706-3708` 与 `packages/app/src/pages/session.tsx:3865-3866`。因此右侧面板显示后，消息列和输入框会左移并缩窄，返回底部按钮仍按完整宽度居中，产生约等于右侧预留宽度一半的右移偏差。

## 推荐解决方案

让 `timeline-resume-control` 使用与消息内容和输入框一致的 `rightInset` 宽度约束，再在该缩窄区域内居中；也可以将按钮移入已应用该宽度约束的内容容器。需要覆盖以下场景：

- 右侧面板关闭时，按钮保持原有居中位置。
- 右侧面板显示时，按钮与消息列、输入框中心对齐。
- 窄窗口及移动端布局不出现额外偏移、遮挡或无法点击。

## 状态

已解决

2026-07-21：已修复 `packages/app/src/pages/session/message-timeline.tsx`。控件现在使用与消息列和输入框相同的右侧预留宽度，并在该可用区域内居中；App typecheck 已通过。后续若在使用版复测中发现右侧面板、窄窗口或移动端仍有偏移，再新建 issue 跟踪。
