# 删除供应商后错误打开模型设置弹窗

## 问题

在设置页的“模型”页面移除供应商后，会在当前设置页面上再次弹出一个“模型”设置弹窗，形成底层设置页与上层设置弹窗叠加的界面。删除确认框取消时也可能触发同样的问题。

## 原因

`packages/app/src/components/settings-models.tsx` 同时被两种场景复用：

- 通过 `SettingsView` 作为主设置页直接渲染；
- 通过 `DialogSettings` 包装后作为设置弹窗渲染。

供应商删除按钮统一传入 `onClose={reopenSettingsModels}`。该回调在 `settings-models.tsx` 中无条件执行：

```tsx
dialog.show(() => <x.DialogSettings defaultValue="models" />)
```

因此，当用户从主设置页删除供应商时，删除确认框关闭会重新创建一个 `DialogSettings`。原本已经存在的主设置页不会被移除，于是出现截图中的叠加界面。

此外，`dialog-delete-custom-provider.tsx` 的 `close()` 在存在 `onClose` 时只调用回调、不执行普通的 `dialog.close()`，所以取消删除和删除成功/失败都会走同一条“重新打开设置弹窗”的路径。

相关代码：

- `packages/app/src/pages/layout.tsx:2913-2916`：主设置页直接渲染 `SettingsView`。
- `packages/app/src/components/dialog-settings.tsx:114-115`：设置页的模型面板使用 `SettingsModels`。
- `packages/app/src/components/settings-models.tsx:85-88`：无条件重新打开 `DialogSettings`。
- `packages/app/src/components/settings-models.tsx:459-465`：删除供应商时绑定 `reopenSettingsModels`。
- `packages/app/src/components/dialog-delete-custom-provider.tsx:25-31`：`onClose` 存在时不关闭当前弹窗。

## 推荐解决方案

将“删除后返回哪个界面”的行为从 `SettingsModels` 中解耦，不要在共享的模型设置组件内无条件打开 `DialogSettings`。建议：

1. 为 `SettingsModels` 增加明确的展示场景或返回策略：主设置页删除后只关闭确认框并留在当前页面，弹窗场景才返回对应的模型管理弹窗。
2. 让删除确认框的关闭逻辑始终先关闭当前确认框，再按调用方提供的返回动作处理，避免把 `onClose` 同时当作“关闭”和“重新打开”使用。
3. 分别验证以下场景：主设置页删除、设置弹窗删除、模型管理弹窗删除、取消删除、删除失败。

## 状态

已解决

## 实际修复

- `SettingsModels` 仅在确实由设置弹窗承载时恢复父级 `DialogSettings`；从主设置页删除供应商只关闭确认框，不再创建叠加弹窗。
- `DialogRemoveProvider` 关闭时始终先关闭当前确认框，再执行可选的父级恢复回调，取消、成功和失败路径保持一致。
