# Windows 中文编码链路问题

## 优先级

高

## 状态

已解决

## 当前实现

- 前台与后台 PowerShell 7 都显式设置 UTF-8 `[Console]::OutputEncoding` 和 `$OutputEncoding`。
- 子进程错误文本和 V2 Read 已接入 UTF-8、UTF-16 与 GB18030 检测，工具输出落盘前保持脱敏。
- 已完成使用版打包启动校验；GBK/UTF-16 文件与中文 stdout/stderr 的真实安装版回归仍待执行。

## 问题

Lfcode 在 Windows 安装版中处理中文时存在编码不一致：Agent 执行 PowerShell 命令时，命令输出可能出现乱码或 `�`；读取 GBK/GB18030 或 UTF-16 中文文件时，V2 Read 工具可能读取失败。

## 原因

1. 安装版默认使用随包携带的 PowerShell，当前环境下 PowerShell 的非 PTY 输出编码实测为 `gb2312`，中文输出字节为 GBK。
2. Lfcode 的子进程输出链路统一按 UTF-8 解码：`AppProcess` 使用 `Stream.decodeText` 和 `toString("utf8")`，Bash 工具直接消费这些结果，没有根据 Windows 子进程实际编码处理。
3. Windows PTY 路径只设置了 `LC_ALL`、`LC_CTYPE` 和 `LANG=C.UTF-8`，这些变量不能可靠地改变 PowerShell 的实际输出编码。
4. V2 内置 Read 工具在 `packages/core/src/tool/read-filesystem.ts` 中固定使用严格 UTF-8 解码；仓库另一套 `packages/lfcode/src/file/index.ts` 已经支持 UTF-8 BOM、UTF-16 和 GB18030，但两套实现没有统一。

## 推荐解决方案

1. 统一 Windows 子进程的文本编码策略。优先让 bundled PowerShell 在非 PTY 命令执行入口显式设置 UTF-8 输出编码，并为 `stdout`、`stderr` 保留明确的字节到文本解码边界。
2. 不要把 `LC_ALL=C.UTF-8` 当作 Windows PowerShell 编码配置；对 PowerShell 7 显式设置 `[Console]::OutputEncoding`，必要时同步设置 `$OutputEncoding`，并覆盖命令执行、安装脚本和后台 Shell 执行路径。
3. 为 Windows 子进程增加中文回归测试，至少覆盖：中文 stdout、中文 stderr、中文路径、中文文件名，以及 GBK/UTF-8 混合输出。
4. 让 V2 Read 工具复用统一的文本检测逻辑：优先识别 UTF-8 BOM、UTF-16 BOM，再检测 UTF-8，最后兼容 GB18030；分页读取也必须使用同一编码策略。
5. 增加编码元信息或检测结果，避免后续写回文件时把原始 GB18030/UTF-16 文件无意转换成 UTF-8。
6. 修复后通过真实安装版验证，而不仅是源码测试：执行 PowerShell 中文输出、读取 GBK/UTF-16 文件，并检查实际 UI 中的 Agent 输出和文件内容。

## 相关代码

- `packages/desktop/src/main/bootstrap.ts`
- `packages/lfcode/src/shell/shell.ts`
- `packages/lfcode/src/pty/index.ts`
- `packages/core/src/process.ts`
- `packages/core/src/tool/bash.ts`
- `packages/lfcode/src/tool/bash.ts`
- `packages/core/src/tool/read-filesystem.ts`
- `packages/core/src/tool/builtins.ts`
- `packages/lfcode/src/file/index.ts`

## 现场证据

- 当前 Windows 安装版为 `1.1.3`，正在运行。
- bundled PowerShell 的管道输出编码实测为 `gb2312`；`"中文"` 输出字节为 `d6 d0 ce c4`。
- 使用 node-pty 的终端输出“中文”暂未复现乱码，因此当前优先级应放在非 PTY 子进程输出和 V2 文件读取链路。
