# 受管插件项目未显示在左侧项目栏

## 问题

酒馆受管项目已创建且会话可以打开，但左侧项目栏只显示手动打开过的普通项目，看不到“酒馆”。

## 原因

`packages/app/src/context/layout.tsx` 的侧栏项目来源是本机持久化的 `server.projects` 打开列表；`bootstrapGlobal` 虽会获取全局 Project 列表，却没有将带 `extension` 的受管 Project 加入该列表。

## 推荐解决方案

全局项目元数据就绪后，自动将所有带 `extension` 的受管项目加入本机打开列表。普通项目继续保持用户手动打开的行为；插件停用时受管项目仍保留在侧栏，方便查看其历史内容。

## 状态

已解决

2026-07-23：已在 `C:\算法\小应用\Lfcodepre\LfcodePre.exe` 验证，左侧第一项显示“酒馆”，并可进入其受管工作目录 `C:\Users\liangfeng\.lfcodepre\plugins\lfcode-tavern\data\projects\tavern`。
