# 工具调用过程被重复写入对话正文

## 状态

未解决

## 问题

模型在调用 `python`、`shell` 等工具后，会把命令、输出和中间判断再次写进 assistant 正文，例如“调用了 shell”“PowerShell 又卡在……”等。

## 原因

工具调用本身已经以结构化 tool part 展示，但当前工具提示词没有严格禁止模型复述完整命令、完整输出和内部推理。模型因此把工具执行过程当成普通回答内容输出。

## 推荐解决方案

1. 在系统提示词和工具提示词中明确：调用工具时不复述完整命令、完整输出、密码、token、环境变量或内部推理。
2. 工具执行期间只显示短状态，例如“正在检查项目文件”。
3. 工具结束后只输出结论、关键数字、失败原因和下一步。
4. 对 assistant 普通文本中的敏感参数增加服务端脱敏，不能只依赖 UI 折叠。
5. 对连续工具调用增加统一的过程摘要，避免每一步都生成自然语言汇报。

## 相关代码

- `packages/lfcode/src/tool/bash.txt`
- `packages/ui/src/components/basic-tool.tsx`
- `packages/ui/src/components/message-part.tsx`
