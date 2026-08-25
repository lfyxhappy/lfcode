# 会话最终正文未投影

## 问题

会话 `ses_07b0ded2dffemvtcA2fSG9Lv6o` 的最终 assistant 消息以 `stop` 正常结束并记录了输出 token，但只保留前导正文，最终分析正文没有出现在消息 Part 中。

## 原因

`packages/lfcode/src/session/processor.ts` 仅在收到 `text-start` 后创建正文 Part；若供应商流直接发出 `text-delta` 或事件顺序异常，处理器直接返回并静默丢弃正文。普通供应商流没有统一保证正文事件生命周期，因此该缺口会影响兼容 Anthropic 协议的供应商。

## 推荐解决方案

在会话处理器内为孤立 `text-delta` 隐式创建正文 Part，并在 LLM 流封装层补齐缺失的正文开始/结束事件。增加乱序正文流回归测试，验证最终正文能持久化。已落地 `normalizeTextLifecycle`，并让处理器在异常事件顺序下自愈创建正文 Part。

## 状态

已解决

2026-07-21：`packages/lfcode` 定向回归和 typecheck 通过；Windows 快速打包、原子同步、使用版重启及自动化健康检查通过（`status: ok`）。
