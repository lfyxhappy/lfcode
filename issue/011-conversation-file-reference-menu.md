# 对话正文文件路径的右键菜单与“选择打开方式”失效

## 优先级

高。对话正文中的本地文件地址无法稳定显示操作菜单，且 Windows 的指定应用打开会误导用户或退化成默认应用打开；这与末尾文件修改卡片的正常行为不一致。

## 状态

已解决

## 问题

在 Windows 桌面端，对助手正文内被识别为本地路径的文本右键时，菜单会出现空白容器而没有可用操作项。对话末尾“已编辑文件”卡片的右键菜单则正常。

即使菜单正常显示，“选择打开方式”也会列出未安装的编辑器。选择这些项目后，实际不会使用所选应用，而会静默回退为 Windows 默认应用打开。

## 原因

### 已确认

- 正文路径与末尾文件卡片没有共用同一套菜单接线。正文由 `Markdown` 在运行时把文本节点替换为 `data-kind="file-ref"` 链接，再通过受控 `ContextMenu` 处理；卡片直接使用独立的 `FileReference` 组件。
- `Markdown` 的 `onContextMenuCapture` 仅记录路径，并把 `menu.open` 保持为先前值：首次右键时该值为 `false`。菜单开启依赖随后由 Kobalte Trigger 发出的状态回调，路径和打开状态存在时序竞争；现场截图与“菜单容器存在、所有条件菜单项均未渲染”相符。
- Windows 的 `checkAppExists()` 当前无条件返回 `true`，导致 VS Code、Cursor、Zed、PowerShell、Sublime Text 全被加入 `openWithApps`，无论程序是否安装。
- 渲染层打开指定应用前会调用 `resolveAppPath()`；未解析到程序时传入 `undefined`，主进程转而执行 `shell.openPath()`。因此“选择打开方式”会静默变成默认应用打开。
- 本机实际可解析的候选命令为 `code` 和 `powershell`；`cursor`、`zed`、`Sublime Text` 不存在。

### 待验证

- 桌面自动化桥目前没有右键输入动作，尚未能在运行安装版中自动化重放该事件。现有用户截图、运行态与源码链路已足以确认问题归属；修复后仍需做真实安装版右键回归。

## 推荐解决方案

1. 将正文路径菜单恢复为显式的右键处理：识别到文件引用后先 `preventDefault()`，以鼠标坐标作为稳定锚点，并在同一次状态更新中写入 `open: true`、路径和文件类型；不要依赖 ContextMenu Trigger 随后的隐式开关回调。
2. 保持正文路径与 `FileReference` 的菜单项、打开方式与错误处理一致，或抽取共享菜单动作层，避免两条链路继续漂移。
3. 在 Windows 实现真实的应用可用性检测：以 `resolveWindowsAppPath()` 的结果作为 `checkAppExists()` 的依据。解析失败的候选项不得显示。
4. 若指定应用在调用时无法解析，返回明确错误并显示 toast；不得回退到 `shell.openPath()`，以免用户以为已按所选程序打开。
5. 补充回归验证：安装版中分别右键正文绝对路径、相对路径和末尾文件卡片，确认菜单项完整；验证 VS Code/PowerShell 可打开，未安装应用不出现，且选择的应用与实际启动程序一致。

## 相关代码

- `packages/ui/src/components/markdown.tsx`：正文路径装饰、右键捕获、受控 ContextMenu 和子菜单。
- `packages/ui/src/components/file-reference.tsx`：末尾文件修改卡片使用的独立 ContextMenu 实现。
- `packages/app/src/pages/session.tsx`：Windows 打开方式候选加载及正文路径操作回调。
- `packages/app/src/components/session/session-open-apps.ts`：Windows 打开方式候选列表。
- `packages/desktop/src/main/apps.ts`：Windows 程序存在性与路径解析。
- `packages/desktop/src/renderer/index.tsx`：指定应用解析失败后的 `openPath` 调用。
- `packages/desktop/src/main/ipc.ts`：`open-path` IPC 的默认应用与指定应用分支。

## 现场证据

- 2026-07-12 用户截图：正文路径右键后只出现细小空白菜单框；同一轮次末尾 `hello.cpp` 文件卡片的右键菜单正常显示“默认应用打开 / 打开所在文件夹 / 选择打开方式 / 复制路径”。
- 2026-07-12 运行态检查：安装版 `C:\算法\小应用\Lfcode\Lfcode.exe`（1.1.3）正在运行，桌面自动化健康检查通过。
- `packages/ui/src/components/markdown.tsx` 的当前工作区内容被 Git 标记为 `assume-unchanged`；普通 `git status` 不会提示其与 `HEAD` 的差异，后续修复前应先解除该标记或明确保留其本地修改。

## 修复记录

- 2026-07-13：正文 file-ref 右键在 Kobalte trigger 处理前同步写入目标路径、显示文本和文件类型，菜单项只依赖该已解析状态，不再由首次 open 状态竞争决定是否渲染。
- Windows 应用候选改为使用真实路径解析结果过滤；指定应用无法解析时抛出明确错误，不会退回系统默认应用。
- `packages/ui` typecheck 已通过。安装版原生右键事件不在当前 automation bridge 能力范围内，仍保留为使用版手工验收项。
