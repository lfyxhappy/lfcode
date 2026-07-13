# 设置页脱离目录 SDK 时不再崩溃

## 状态

已完成

## 变更

修复全局设置覆盖层挂载“编辑器设置”时调用目录级 SDK context，导致整个应用进入错误页的问题。

## 范围

- 编辑器设置中的 LSP 状态读取。
- 全局设置覆盖层向编辑器设置传递当前目录。
- 设置入口和编辑器标签的稳定 automation token。
- Windows 快速打包所需的 Effect Node 共享运行时直接依赖。

## 不包含

- 不调整其他设置项或 SDK Provider 层级。
- 不改变 LSP 服务端接口和状态语义。

## 实施

`SettingsEditor` 改用始终存在的 GlobalSDK，并只在设置覆盖层提供活动目录时创建目录客户端读取 LSP 状态；没有活动目录时不发起请求，沿用现有空状态。设置开关与编辑器标签增加稳定 automation token，支持安装版自动回归。`packages/lfcode` 显式声明 `@effect/platform-node-shared`，修复快速打包时 Bun 无法解析间接依赖的问题。

## 验证

- `packages/app`: `bun run typecheck` 通过。
- `packages/app`: `bun test --preload ./happydom.ts ./src/components/dialog-settings-logic.test.ts`，3 项通过。
- `packages/desktop`: `sync:win-use-copy:fast` 完成；CLI smoke test 返回 `1.1.3`，Windows 使用版已同步并重启。
- 安装版 `app:control`：设置开关可见并成功打开；“编辑器”标签可见、点击后进入选中态；编辑器设置内容正常渲染。
- `/diagnostics/events?type=renderer.error&limit=20` 返回空数组，没有复现 `SDK context must be used within a context provider`。
- 截图：`C:\Users\liangfeng\.lfcode\state\electron\com.lfyxhappy.lfcode\output\automation\settings-editor-fixed-1783939399220-1.png`。

## 关联

无
