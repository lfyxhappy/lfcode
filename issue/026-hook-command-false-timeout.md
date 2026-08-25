# Hook 命令执行完成但记录为超时

## 问题

Windows 使用版中，PowerShell 命令型 Hook 实际已输出并退出，但 Hook 运行记录在 30 秒后显示 `Hook timed out; failed open`。

## 原因

`packages/lfcode/src/hook/runtime.ts` 同时等待 stdout、stderr 的管道 `end` 事件与子进程退出；Electron/Windows 管道可能在进程退出后不发送其中一个 `end`，导致收集 Promise 一直不结束。

## 推荐解决方案

以 Node `child_process` 的子进程 `close` 事件作为唯一完成信号，实时收集 stdout/stderr；保留超时 kill、UTF-8 输出和失败开放语义。

## 状态

已解决
