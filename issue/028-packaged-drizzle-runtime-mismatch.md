# Windows 使用版 Drizzle 依赖版本不一致导致启动失败

## 问题

完成联网工具修复后的 Windows 使用版启动即退出，无法建立自动化健康检查服务。

## 原因

`packages/lfcode/package.json` 已固定兼容且包含 `utils.js` 的 `drizzle-orm@1.0.0-beta.19-d95b7a4`，但 `packages/desktop/package.json` 仍使用根目录 catalog 的 `drizzle-orm@1.0.0-rc.2`。Electron 打包以桌面包的依赖为准，产物中的 `node-sqlite/session.js` 导入不存在的 `drizzle-orm/utils.js`，启动时抛出 `ERR_MODULE_NOT_FOUND`。

## 推荐解决方案

将桌面包的 Drizzle 版本显式与运行核心对齐，重新安装依赖后快速打包、同步并验证安装版启动。保留根目录 catalog 的现状，避免扩大无关包的升级范围。

## 状态

已解决

2026-07-21：桌面包已显式固定到 `drizzle-orm@1.0.0-beta.19-d95b7a4`，重新安装后确认桌面依赖存在 `utils.js`。Windows 快速打包、原子同步和安装版自动化健康检查均通过；`C:\算法\小应用\Lfcode\Lfcode.exe` 正在运行。
