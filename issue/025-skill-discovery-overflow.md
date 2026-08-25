# Skill 发现被残留目录与无效 Frontmatter 干扰

## 问题

会话 `ses_07fdac10cffedgd9rc3aXLR4WX` 无法通过 `skill` 加载 `archive-extract`：先列出 149 个 Skill 后输出被截断，随后按“解压”“压缩”“archive”查询均失败。

## 原因

- `C:\Users\liangfeng\.lfcode\skills` 当前有 153 个 `SKILL.md`；会话中的 `skill(可用技能)` 产出 50,305 字符并被标记 `truncated`，全量列表不适合用作定位特定 Skill 的依据。
- `archive-extract/SKILL.md` 的 YAML `description` 含未加引号的冒号（`flatten):`），`gray-matter` 解析失败；`packages/lfcode/src/skill/index.ts` 会跳过无效 frontmatter，因此该 Skill 不会进入运行时可用列表。
- 所有可用 Skill 还会由 `packages/lfcode/src/session/system.ts` 注入系统上下文；会话首轮输入已达到 46,639 tokens，残留 Skill 会增加上下文体积、延迟和截断风险。

## 推荐解决方案

- 仅保留 `archive-extract`，删除历史自动复制进 `C:\Users\liangfeng\.lfcode\skills` 的其他目录；随后重启使用版以刷新实例内 Skill 缓存。
- 已将 `archive-extract` 的 `description` 改为有效的 YAML 双引号字符串。
- 保持 `skill` 的关键字搜索路径；当可用 Skill 数量很大时，不依赖全量列表的截断输出，而应以关键字返回候选后再精确加载。

## 状态

已解决

2026-07-21：受管目录现仅保留 `archive-extract` 与 `yaml-skill-test` 两个有效 Skill，均已实际通过 frontmatter 解析。发现器不再跟随受管目录内的符号链接，也不再自动迁移外部目录；关键字候选、紧凑清单和链接回归测试均已通过。
