# 对话 Markdown 普通网页链接右键出现空菜单

## 优先级

中。对话正文中的普通网页链接无法获得有效右键操作，且会出现没有菜单项的空白浮层，影响链接复制、打开等常规交互。

## 状态

已解决

## 问题

在 Windows 桌面端的对话正文中右键普通网页 URL 时，界面会显示一个空的右键菜单容器，没有任何可选项。该现象针对的是网页链接，不是本地文件路径引用。

## 复现条件

1. 在桌面端打开含普通 `https://...` 网页链接的对话 Markdown 内容。
2. 右键该网页链接。
3. 实际结果：显示空白菜单容器。
4. 期望结果：不应显示文件引用的空菜单；网页链接应保留正常浏览器右键行为，或显示至少包含复制链接、外部浏览器打开等有效操作的菜单。

## 原因

### 已确认

- `packages/app/src/pages/session.tsx` 为对话 Markdown 的文件引用功能全局传入 `allowContextMenu: true`。
- `packages/ui/src/components/markdown.tsx` 因而用 Kobalte `ContextMenu.Trigger` 包裹整个 Markdown 区域，而非仅包裹 `data-kind="file-ref"` 的本地文件引用。
- 右键普通网页 URL 时，`handleFileReferenceContextMenu()` 无法找到文件引用元素，先将 `menu.open` 设为 `false` 并返回。
- 随后 Trigger 的 `onOpenChange(true)` 仍会将菜单状态重新打开；普通 URL 没有文件路径和类型，所有依赖 `menu().path` 或 `menu().kind` 的菜单项均不渲染，最终形成空菜单。

### 待验证

- 已选择保留浏览器默认右键菜单。代码级回归测试已确认普通网页链接不会再冒泡到文件引用菜单触发器，文件引用仍可触发其菜单；预发布安装副本手工右键验收已列入本轮统一打包验收；现有自动化桥不注入鼠标右键，因此代码级验证以真实 DOM 冒泡链路覆盖。

## 推荐解决方案

1. 将文件引用菜单的触发范围限制为实际命中 `data-kind="file-ref"` 的元素；非文件引用目标不得打开该受控 Kobalte 菜单。
2. 调整受控菜单状态，防止 Trigger 的 `onOpenChange(true)` 在无效目标已关闭菜单后重新打开空容器。
3. 普通网页 URL 应明确保留原生右键行为，或实现包含有效链接操作的独立菜单，不能复用文件路径菜单状态。
4. 增加回归覆盖：右键普通网页 URL 不渲染空 `ContextMenu.Content`；右键文件引用仍显示完整文件操作菜单。
5. 修复后在 `C:\算法\小应用\Lfcodepre` 安装副本中手工右键网页 URL 验收。现有自动化桥不支持注入右键输入，不能以 DOM 单测替代此项运行态验证。

## 验收标准

- 对话正文中右键任意普通 `http://` 或 `https://` 链接时，不再出现没有菜单项的浮层。
- 网页链接采用的最终交互至少提供可用行为，或明确恢复浏览器默认右键菜单。
- 对话正文中的本地文件引用右键菜单仍可正常显示其文件操作项。
- 在预发布安装副本中完成上述两类目标的人工回归，不影响生产使用版。

## 相关代码

- `packages/app/src/pages/session.tsx`：对话 Markdown 上下文全局启用 `allowContextMenu`。
- `packages/ui/src/components/markdown.tsx`：文件引用识别、`handleFileReferenceContextMenu()`、Kobalte `ContextMenu.Trigger` 和菜单项条件渲染。
- `packages/desktop/src/main/runtime.ts`：桌面端全局原生右键菜单注册；现场检查表明该注册仍存在，不是本问题的首要原因。
- `issue/011-conversation-file-reference-menu.md`：已解决的本地文件路径右键菜单问题；与本 issue 共用 Markdown 菜单组件，但目标元素和修复边界不同。

## 现场证据

- 用户反馈：右键网站链接后显示的是空列表，没有任何选项。
- 源码检查：`handleFileReferenceContextMenu()` 对非 `file-ref` 目标清空菜单状态，而同一区域的 `ContextMenu` 仍可通过 `onOpenChange(true)` 打开；菜单项均以文件路径或类型为渲染前提。
- 预发布运行态检查：普通网页可正常加载，且 Electron 全局原生菜单注册仍存在；问题集中于对话 Markdown 的受控文件引用菜单链路。
