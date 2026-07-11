# 普通 bash 代码块被自动渲染成可编辑编辑器

## 状态

未解决

## 问题

模型只是在回答中展示一段 bash 命令时，消息区也会出现带有 `bash`、scratch 路径、眼睛图标和更多操作的编辑器卡片。

## 原因

消息时间线会把支持的 fenced code block 交给 `MessageCodeBlock`。只要代码块语言被识别为 `bash`，组件就会自动生成：

```text
.lfcode/scratch/code/bash/<session>/<message>-<part>-<index>.sh
```

该组件默认支持预览、编辑、保存、打开侧边栏和绑定真实文件，因此展示型命令也获得了编辑器行为。

## 推荐解决方案

1. 普通代码块默认静态展示，不自动创建 scratch 文件和编辑状态。
2. 只有用户明确要求“编辑”“保存”“运行”，或代码块包含显式 editable 标记时，才启用编辑器。
3. “展示代码”“可编辑代码”“绑定项目文件”“可运行代码”使用不同的 UI 类型和状态。
4. 对 bash 命令示例默认显示复制按钮，不显示文件路径、保存和绑定文件操作。
5. 用户主动进入编辑模式后，再创建稳定的 scratch 路径。

## 相关代码

- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/src/pages/session/message-code-block.tsx`
- `packages/app/src/pages/session/message-code-block-path.ts`
- `packages/app/src/pages/session/message-editable-code-block.tsx`
