# Claude Code 会话恢复失败

## 问题

Claude Code 专用会话在桌面应用重启后可能只显示
`No conversation found with session ID`，且用户无法在当前终端页面恢复。

## 原因

`packages/lfcode/src/claude-code/index.ts` 曾以
`time_updated !== time_created` 决定是否使用 `claude --resume`，但
`time_updated` 会在 PTY 创建后立刻刷新，无法证明 Claude 已创建可恢复的
对话历史。

## 推荐解决方案

使用独立的 `can_resume` 持久状态；仅在新会话 PTY 稳定存活后允许恢复。终端
退出时保留原始输出，并提供显式的新建 Claude 会话操作来替换损坏 UUID，禁止
自动覆盖绑定。

## 状态

已解决。已在 `Lfcodepre` 验证首次彩色终端启动、重启后的恢复失败提示，以及
显式 UUID 重建后重新进入原生终端。
