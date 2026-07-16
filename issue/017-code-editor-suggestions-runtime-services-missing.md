# 代码编辑器因 Runtime 服务缺失与菜单焦点锁无法输入

## 优先级

高。真实使用版会随机进入“只能输入回车和 Tab、字母无效”的半失效状态，并可能无法把焦点切回会话输入框；同一 Runtime 问题还会破坏补全、Code Lens、Inlay Hints 和 Code Action。

## 状态

已解决

## 问题

Windows 桌面使用版中，代码编辑器进入编辑模式后会间歇性无法输入普通字母，只剩回车和 Tab 等编辑器命令仍有响应。故障出现后，用户还可能无法通过点击把焦点切回会话输入框。

同一故障会让 TypeScript 文件无论正常输入还是显式执行“触发补全”都不显示 Monaco 建议列表。用户无法感知变量、成员、类型、代码片段或 LSP 补全已经存在。

最小探针中输入：

```ts
const account = { name: "Ada", age: 37 }
account.
```

光标位于 `account.` 后时，预期应出现 `name` 和 `age` 成员建议；实际没有任何补全弹窗。与此同时，TypeScript 语法诊断仍能返回 `Identifier expected.`，说明语言识别和 TypeScript worker 并非整体失效。

## 原因

### 已确认

- 真实使用版的 Renderer 事件记录了：`SuggestController2 depends on UNKNOWN service ISuggestMemories`。补全建议控制器在实例化时因依赖服务缺失直接失败。
- 主文件编辑器通过 `packages/app/src/components/code-editor/core/runtime.ts` 加载 `runtime-core.ts`，后者直接使用 `monaco.editor.create` 创建普通 standalone editor。
- `runtime-core.ts` 仅在命中 TypeScript/JavaScript 时动态加载 `monaco.contribution`；该 contribution 同时注册完整 editor contributions 及 Suggest、Code Lens、Inlay Hints、Code Action、拖放等依赖服务。
- Monaco `StandaloneServices.initialize(...)` 只在第一次初始化时把后注册的 singleton descriptors 补进服务集合；初始化完成后直接复用现有 `InstantiationService`。因此，如果首个编辑器是 C++、Python 或其他基础语言，服务集合会在 TypeScript contribution 加载前冻结。
- 修复前仓库同时存在 `packages/ui/src/components/monaco-vscode-runtime.ts`，该 Runtime 会调用 `@codingame/monaco-vscode-api` 的 `initialize(...)`，并使用 `createConfiguredEditor` / `createConfiguredDiffEditor` 注入 VS Code compatibility services；该 compatibility Runtime 已随本次重构移除。
- 运行中编辑器自动化状态为 `compatibilityRuntimeInitialized: false`，证明主编辑器创建时没有完成上述 compatibility Runtime 初始化。
- 同一次使用版运行还记录了 `ICodeLensCache`、`IInlayHintsCache`、`actionWidgetService` 和 `treeViewsDndService` 缺失，说明问题不只影响补全。
- 编辑器命令条、文件 tab 模式菜单和消息代码块菜单使用 Portal `DropdownMenu`，而 Kobalte 菜单默认 `modal=true`：打开时会 trap focus 并禁用外部 pointer events。Portal 内容又不在 `CodeEditorHost` 的 `data-prevent-autofocus` 保护树内，因此会与会话页全局字符键自动聚焦发生冲突。

### 高概率原因

- 输入故障是否出现取决于首个编辑器的语言和贡献加载顺序：先打开基础语言再打开 TypeScript/JavaScript 时更容易稳定触发，因此表现为“经常”而非每次必现。
- 字母输入会进入 Suggest/quick suggestion 等贡献链并触发缺失服务异常；回车和 Tab 主要走已创建的编辑器命令链，所以仍可能响应。

### 待验证

- 预注册 `editor.all` 后，需要确认首个编辑器是基础语言时，后续 TypeScript/JavaScript 编辑器也不再出现缺失服务。
- 菜单改为非模态后，需要确认键盘导航、外部点击关闭和焦点恢复仍符合预期。

## 推荐解决方案

1. 保留现有纯 Monaco editable runtime，在其第一次创建 editor/model 或读取 `StandaloneServices` 前加载 `monaco-editor/esm/vs/editor/editor.all`，一次性注册完整 editor contributions 与 singleton services；继续让语言 worker 和语言语法定义按需加载。
2. 不把主编辑器重新切回 `createConfiguredEditor`，避免重新引入 compatibility runtime 对 editable model 的异步接管、plaintext 回退和命令类型冲突。
3. 编辑器命令条、文件 tab 和消息代码块的 Portal 菜单设置 `modal={false}`，并在 Content/SubContent 上添加 `data-prevent-autofocus`，避免焦点被菜单和会话自动聚焦逻辑来回争抢。
4. 为 Runtime 初始化增加显式失败状态和诊断事件；Suggest Controller 等关键 contribution 创建失败时，不应只在 Renderer 控制台静默报错。
5. 增加安装版回归：先打开基础语言文件，再打开真实 TS 文件输入字母和 `account.`；验证建议列表、Enter/Tab 接受、菜单关闭及会话输入框重新聚焦，并断言 Renderer 没有服务缺失错误。

## 相关代码

- `packages/app/src/components/code-editor/core/runtime.ts`
- `packages/app/src/components/code-editor/core/runtime-core.ts`
- `packages/app/src/components/code-editor/core/host.tsx`
- `packages/app/src/components/code-editor/core/command-strip.tsx`
- `packages/app/src/components/code-editor/core/language-service.ts`
- `packages/app/src/components/code-editor/core/server-lsp.ts`
- `packages/ui/src/components/monaco-kernel.ts`
- `packages/ui/src/components/code-diff-runtime.ts`
- `packages/ui/src/components/code-diff-view.tsx`
- `packages/app/src/pages/session/file-tabs.tsx`
- `packages/app/src/pages/session/message-code-editor-frame.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/desktop/src/main/automation-server.ts`

## 复现条件

- 环境：2026-07-14 正在运行的 Windows 使用版 `C:\算法\小应用\Lfcode\Lfcode.exe`。
- 操作：打开 `.ts` 文件并进入编辑模式，输入 `const account = { name: "Ada", age: 37 }` 和 `account.`，将光标置于点号后；等待自动建议或执行“触发补全”。
- 预期：显示包含 `name`、`age` 的 TypeScript 成员补全列表。
- 实际：没有建议列表；Renderer 报 `SuggestController2 depends on UNKNOWN service ISuggestMemories`。
- 频率：输入故障随首个编辑器语言与打开顺序间歇出现；“基础语言 -> TypeScript”顺序下可稳定触发服务缺失。

## 现场证据

- 使用安装版 automation bridge 确认活动编辑器为 `phase0`、语言为 `typescript`，光标位于 `account.` 后，且 `compatibilityRuntimeInitialized: false`。
- 显式执行 `triggerSuggest` 后截图中没有补全建议列表。
- 同一编辑器能够返回 TypeScript 语法诊断 `Identifier expected.`，说明 worker 和 diagnostics 已加载，但 Suggest UI 控制器不可用。
- Renderer 事件中稳定出现 `SuggestController2 depends on UNKNOWN service ISuggestMemories`；同时还出现 Code Lens、Inlay Hints、Code Action 和拖放编辑的服务缺失错误。
- 现场截图显示编辑器操作菜单处于打开状态；该菜单使用 Kobalte 默认模态行为，源码确认其会 trap focus 并禁用外部 pointer events。
- `packages/app` 定向语言服务与 server-LSP 单测为 8 pass / 0 fail；这进一步说明当前缺口位于真实 Runtime/交互闭环，而不是静态 Provider 配置。
- 2026-07-14：已开始正式修复，执行计划为 `.codex/editor-input-runtime-fix.md`；完成安装版验证前保持 `解决中`。
- 2026-07-16：单一 pure Monaco Kernel、版本化 document registry、长生命周期 editor controller、provider cancellation 与焦点边界已完成切换；compatibility Runtime 与其依赖已移除。
- 2026-07-16：完成 fast Windows package、同步和正常使用版重启。隔离 hidden portable 安装版依次打开 C++、Python、TypeScript fixture，均得到 `phase0` 编辑器、正确语言和 model URI，且没有 `failureMessage`。诊断事件中 `ISuggestMemories`、`ICodeLensCache`、`IInlayHintsCache`、`actionWidgetService`、`treeViewsDndService` 缺失为 0，renderer runtime error 为 0。
- 自动化未发送系统鼠标、键盘或焦点命令；中文 IME、真实点击切焦、菜单关闭后焦点恢复以及完整补全接受链保留为用户人工验收，不阻塞本 issue 按当前范围关闭。
- 2026-07-16：继续现场验收确认“打开编辑器后点击对话输入框会使编辑器不可用”。根因是文件编辑器和消息代码块把 Monaco blur 误作手动保存，点击对话输入框因此启动保存/同步链并可能替换活动 model。已移除全部 blur 保存链，仅保留 Ctrl+S、显式保存和文件编辑器防抖自动保存；重新打包、同步并重启使用版后，用户确认编辑器与对话输入框切换已恢复正常。

## 验收标准

- 在打包并同步后的 `C:\算法\小应用\Lfcode\Lfcode.exe` 中，TS 最小探针 `account.` 自动或手动触发后稳定显示 `name`、`age`。
- 变量、函数、类型、snippet 和跨文件 LSP 补全都能在真实文件 tab 中显示，并可通过键盘选择和 Enter/Tab 接受。
- Renderer 事件中不再出现 `ISuggestMemories`、`ICodeLensCache`、`IInlayHintsCache`、`actionWidgetService` 或 `treeViewsDndService` 缺失错误。
- 编辑器菜单打开、关闭及外部点击后，焦点可以稳定返回编辑器或会话输入框；字母、回车和 Tab 均按当前焦点正常工作。
- 主文件编辑器、消息内编辑器、diff 和 session review 同页使用时，不发生重复初始化、service registry 冲突或 worker 覆盖。
- 保留 TypeScript/JavaScript/JSON 内建语言服务以及 Python、C/C++ server-LSP fallback；诊断、补全、参数提示和跳转行为不回退。
- 完成定向单测、app 构建、fast package、同步、重启，并只通过运行中的安装使用版 automation bridge 完成上述交互验收。
