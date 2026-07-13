# 项目与会话项支持右键菜单

## 状态

已完成

## 变更

让侧边栏中的整个项目项和整个会话项响应右键点击，并弹出与各自三点按钮完全相同的更多操作菜单。

## 范围

- 项目项：项目标题、图标和空白区域。
- 会话项：会话标题和行内空白区域。
- 复用现有项目/会话菜单动作、禁用态、危险操作和确认流程。

## 不包含

- 不新增或调整菜单项。
- 不改动会话正文、项目详情页、系统原生 Electron 菜单或触屏长按交互。
- 不改变三点按钮现有行为。

## 实施

后续实施时，为 `ProjectSection` 和 `SessionItem` 添加 `ContextMenu` 触发器，并从现有 menu action builders 生成右键菜单内容；右键事件需阻止 Electron/Chromium 默认的“Select All / Copy Link”菜单。

## 验证

已实现：`ProjectSection` 和 `SessionItem` 现已使用同一份 menu action builder 同时生成三点菜单与右键菜单，保留禁用态、危险操作和现有确认流程。Windows use-copy 的原生右键交互仍作为手工验收项。

## 关联

无
