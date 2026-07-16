# README 字标恢复 opencode 几何风格

## 状态

已完成

## 变更

将 README 的 `LFCODE` 字标从普通等线像素字改为原版 opencode 字标的块状几何风格，保留固定网格、内嵌阴影块和分段灰阶，同时继续显示独立品牌名 `LFCODE`。

## 范围

- `.github/readme/lfcode-wordmark-dark.svg`
- `.github/readme/lfcode-wordmark-light.svg`
- README 现有引用保持不变。

## 不包含

- 不恢复 opencode 名称或旧产品定位。
- 不修改应用内图标、console 品牌资源、README 正文或功能占位图。
- 不执行桌面打包、use-copy 同步或 Release。

## 实施

已复用仓库原版 opencode 字标的 16px 几何网格、双色层次和 `C/O/D/E` 字形结构，并重新绘制同风格的 `L/F`，生成深浅主题两份 `LFCODE` SVG。README 引用路径无需修改。

## 验证

- 两份 SVG 均通过 XML 解析，且不使用 `<text>` 或外部字体。
- 已使用本机 Chrome 同屏渲染深浅主题，确认字形、内嵌阴影块与灰阶分段正常。
- `README.md` 与 `README.en.md` 均通过 GitHub Markdown API 预渲染，字标引用保持有效。
- `git diff --check` 通过。

## 关联

`.codex/readme-brand-refresh-plan.md`
