# app-control 默认连接生产版自动化端点

## 问题

在生产版与 `LfcodePre` 同时运行时，仓库根目录的 `bun run app:control` 未指定预发布数据根目录，会默认读取 `C:\Users\liangfeng\.lfcode\state\automation\desktop.json`，从而连接生产版而不是当前预发布副本。常规预发布验证因此容易误读生产窗口状态，或对生产窗口执行可写自动化操作。

## 原因

`packages/desktop/src/automation-discovery.ts` 在缺少 `LFCODE_STATE_DIR` 和 `LFCODE_AUTOMATION_STATE_FILE` 时固定回退到用户主目录下的 `.lfcode`。`packages/desktop/scripts/app-control.ts` 不提供预发布通道参数，也不输出已解析的发现文件和目标进程。实际运行中，默认命令连接到了生产版 PID，而设置 `LFCODE_STATE_DIR=C:\Users\liangfeng\.lfcodepre\state` 后才连接到预发布 PID。

## 推荐解决方案

为 `app-control` 增加显式预发布通道选项，并在解析后输出目标版本、PID 和状态文件；预发布同步与验证脚本使用该选项。保持默认行为兼容现有生产版控制，不根据是否存在预发布文件做隐式切换。

已实现 `--pre` 参数和 `app:control:pre` 脚本。该参数固定使用 `C:\\Users\\liangfeng\\.lfcodepre\\state` 发现文件，并拒绝与显式 `LFCODE_AUTOMATION_STATE_FILE` 混用，防止通道选择含糊。

## 状态

已解决

已验证：`packages/desktop` 的定向测试通过；预发布快速打包、同步和重启后，`bun run app:control:pre meta` 返回新的预发布 PID，`state 1` 返回可见且聚焦的 `LfcodePre` 窗口。生产使用版未停止或写入。
