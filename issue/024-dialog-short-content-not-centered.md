# 普通短弹窗视觉上未垂直居中

## 问题

供应商配置、额度配置等短内容弹窗打开后会明显偏上，用户感知为弹窗没有垂直居中。

## 原因

`packages/ui/src/components/dialog.css` 曾给所有普通 Dialog 容器固定 `height: min(calc(100vh - 16px), 512px)`。外层虽然使用了 `align-items: center`，但短内容实际位于这个固定高度盒子的顶部；同时 `justify-items` 对 column flex 容器不起作用，因此无法修正内容位置。

## 推荐解决方案

普通 Dialog 容器改用内容自身高度，并只保留统一的视口 `max-height`；内容区域同步使用最大高度限制。`large` 和 `x-large` 继续显式保留固定工作区高度。不要为单个弹窗增加 `translate` 或额外的定位补偿。

## 状态

解决中

## 验证

- `packages/ui/src/components/dialog-layout.test.ts`：2 个回归测试通过。
- `packages/app`：类型检查通过，额度和使用统计定向测试通过。
- 安装版几何验收尚未执行；当前未获得同步或启动预发布版的授权。
