# PowerShell 失败后的重复改写和无效重试

## 状态

已解决

## 当前实现

- Windows shell 明确固定为 PowerShell 7，并会拒绝常见 Bash-only 语法。
- 失败结果携带语法、路径、权限、进程或超时分类；同会话相同命令在十分钟内失败两次后被运行时熔断。
- 仍待使用版真实模型回合确认模型收到熔断提示后会改用验证过的新路径。

## 问题

Windows 命令失败后，模型会反复切换 PowerShell、cmd 或类 Bash 写法，继续尝试相同目标，并把每次失败过程写入对话。

## 原因

Windows shell 实际上是 PowerShell 7，但模型可能生成 PowerShell 5.1、cmd 或 Bash 语法。工具返回错误后，当前重试策略没有充分区分语法、路径、权限、进程和超时错误。

## 推荐解决方案

1. 工具结果增加结构化错误类别：`syntax`、`path`、`permission`、`process`、`timeout`。
2. 在 shell 提示词中明确 Windows 只能生成 PowerShell 7 语法。
3. 同一命令失败后最多自动重试一次，第二次仍失败就停止并总结原因。
4. 中文路径优先使用 `-LiteralPath`，不要自动切换到 cmd。
5. 对命令签名做重复检测，禁止只改引号或括号的无效重试。

## 相关代码

- `packages/lfcode/src/tool/bash.txt`
- `packages/lfcode/src/tool/bash.ts`
- `packages/lfcode/src/session/prompt.ts`
