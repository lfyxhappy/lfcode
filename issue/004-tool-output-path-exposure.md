# 工具输出文件路径暴露到对话

## 状态

已解决

## 当前实现

- 截断输出改为 `tool-output:<id>` 不透明引用，真实路径不再写入模型输出或工具元数据。
- 新增受限 `tool_output` 工具，只能按引用执行有界 read/search，不能读取任意路径；终端卡片显示“已捕获输出”提示。
- 输出持久化与预览统一脱敏。V2 的历史 `outputPaths` 事件字段仍是内部保留字段，尚未完成完整引用迁移。

## 问题

工具输出过长时，模型和用户可能看到内部输出文件路径；旧版路径还可能表现为 `.lfcode/scratch/code/...`，增加了内部存储细节和敏感路径暴露。

## 原因

shell 工具会把超长输出写入文件，并把路径放入模型可见的输出文本。模型可能继续复述该路径。当前新版源码已经使用独立的 `tool-output` 目录，但历史代码块编辑器仍会生成 `scratch/code` 路径。

## 推荐解决方案

1. 模型侧使用不透明引用，例如 `tool-output:<id>`，不要直接传递真实文件系统路径。
2. 用户界面只显示“输出过长，已保存”，通过专用查看动作读取完整内容。
3. 对输出中的密码、token、Cookie、环境变量做统一脱敏。
4. 区分工具输出引用和代码块 scratch 文件，避免两者复用同一套路径展示语义。
5. 清理旧版 scratch 输出时保留正在编辑的代码块，避免历史消息打开失败。

## 当前事实

当前源码的 shell 截断目录是 `Global.Path.data/tool-output`；截图中的 `.lfcode/scratch/code/bash/...` 是消息代码块编辑器生成的路径。

## 相关代码

- `packages/lfcode/src/tool/truncation-dir.ts`
- `packages/lfcode/src/tool/truncate.ts`
- `packages/app/src/pages/session/message-code-block-path.ts`
- `packages/core/src/tool-output-store.ts`
