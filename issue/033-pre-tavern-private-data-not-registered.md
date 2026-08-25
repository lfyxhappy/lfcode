# Pre 版酒馆插件私有数据未登记

## 问题

Pre 安装版启动后，酒馆界面读取角色、世界书和设置时出现 `Plugin does not expose private UI data`，应用进入错误页。

## 原因

桌面 pre 版将运行时根目录设为 `C:\Users\liangfeng\.lfcodepre`，而插件实际位于该根目录的 `plugins/`。插件发现逻辑只扫描配置目录及项目 `.lfcode` 目录，未扫描 pre 根目录，因此 `packages/lfcode/src/plugin/index.ts` 没有登记 `lfcode-tavern` 的私有 data 目录。前端 `packages/app/src/pages/session/message-timeline.tsx` 的设置读取也未做失败降级。

## 推荐解决方案

在 `packages/lfcode/src/config/paths.ts` 将桌面数据根的上级运行时根加入本地插件发现范围，并保留只有存在 `plugins/*/package.json` 时才加入的条件。酒馆前端数据读取失败时返回默认设置，让单个插件功能降级而不是终止应用初始化。

## 状态

已解决
