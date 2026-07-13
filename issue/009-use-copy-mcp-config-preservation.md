# 使用版同步遗留配置清理

## 问题

快速同步使用版时，旧的 `opencode.jsonc` 兼容配置可能被保留，造成 Lfcode 和旧产品配置并存。

## 原因

此前同步脚本试图保留 `opencode.jsonc`，把已经废弃的兼容配置当作用户配置处理。这与 Lfcode-only 的配置边界冲突，也会让用户误以为旧产品仍在生效。

## 推荐解决方案

使用版只保留 `lfcode.jsonc`、`data`、`state` 和 Lfcode 目录。同步前显式删除 `opencode.jsonc`，不复制、不生成也不再读取该文件。

## 状态

已解决
