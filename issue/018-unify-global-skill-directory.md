# 全局 skill 目录统一到 `C:\Users\liangfeng\.lfcode\skills`

## 优先级

中

## 状态

未解决

## 问题

Lfcode 当前无法发现用户放置在 `C:\Users\liangfeng\.lfcode\skills\<name>\SKILL.md` 下的全局 skill，例如 `archive-extract`。

用户侧已经形成以 `C:\Users\liangfeng\.lfcode\skills` 为统一全局 skill 根目录的使用习惯，但当前代码把全局 skill 目录解释为 `Global.Path.config\skills`，在当前安装版运行态中对应 `C:\Users\liangfeng\.lfcode\config\skills`。因此同一台机器上出现两个全局 skill 根目录，导致目录下存在合法 `SKILL.md` 仍不会进入可用 skill 列表。

## 原因

### 已确认

- `C:\Users\liangfeng\.lfcode\skills\archive-extract\SKILL.md` 存在，且包含合法的 `name` 与 `description` frontmatter。
- `packages/lfcode/src/skill/index.ts` 使用 `path.join(Global.Path.config, "skills")` 扫描全局 skill。
- `packages/lfcode/src/server/routes/instance/skills.ts` 的创建、导入、管理删除等全局 skill 操作同样使用 `path.join(Global.Path.config, "skills")`。
- 当前运行中的安装版为 `C:\算法\小应用\Lfcode\Lfcode.exe`，不是本仓库的 source dev 进程。

### 待验证

- 需要确认把根目录切换到 `Global.Path.home\.lfcode\skills` 后，是否还要兼容迁移或读取现有的 `Global.Path.config\skills`。
- 需要确认设置页、技能刷新接口、技能权限白名单、导入/删除安全边界是否全部复用同一个目录函数，避免改完扫描路径后管理接口仍写入旧目录。

## 推荐解决方案

1. 将用户全局 skill 的规范根目录统一定义为 `Global.Path.home\.lfcode\skills`，即 `C:\Users\liangfeng\.lfcode\skills`。
2. 抽取唯一的全局 skill 根目录解析函数或常量，统一供 skill 扫描、`dirs()` 权限白名单、创建、导入、刷新、隐藏、删除和设置页接口使用。
3. 明确兼容策略：优先读取新目录；如需平滑迁移，对旧的 `Global.Path.config\skills` 提供一次性迁移或只读兼容，并记录重复名称的覆盖顺序。
4. 更新相关文案、配置说明和测试中的目录假设，避免继续把 `Global.Path.config\skills` 称为唯一全局 skill 目录。
5. 完成代码验证后，重新打包并同步到 `C:\算法\小应用\Lfcode`，在实际安装版中刷新技能并加载 `archive-extract`，确认相对路径下的 `flatten.py`、`matryoshka_extract.py` 等资源仍可访问。

## 相关代码

- `packages/lfcode/src/skill/index.ts`
- `packages/lfcode/src/server/routes/instance/skills.ts`
- `packages/lfcode/src/agent/agent.ts`
- `packages/app/src/components/settings-skills.tsx`
- `packages/app/src/components/settings-skills-helpers.ts`
- `packages/core/src/global.ts`

## 复现条件

- 环境：Windows，当前安装版 `C:\算法\小应用\Lfcode\Lfcode.exe`。
- 前置条件：存在 `C:\Users\liangfeng\.lfcode\skills\archive-extract\SKILL.md`。
- 操作：在 Lfcode 中刷新或请求可用 skill，并尝试按名称加载 `archive-extract`。
- 预期：skill 出现在可用列表中，并能按 skill 根目录加载其附属脚本。
- 实际：当前扫描根目录为 `C:\Users\liangfeng\.lfcode\config\skills`，`archive-extract` 不出现在可用列表中。

## 验收标准

- `C:\Users\liangfeng\.lfcode\skills\archive-extract\SKILL.md` 能被 Lfcode 的 skill discovery 发现。
- 设置页显示的本地 skill 位置、创建、导入、隐藏和删除行为均指向 `C:\Users\liangfeng\.lfcode\skills`。
- `skill.dirs()` 返回统一后的实际根目录，技能相关的权限白名单不再遗漏该目录。
- 刷新或重启安装版后，`archive-extract` 能按精确名称加载，且 skill 内相对路径资源仍能正常读取。
- 若保留旧目录兼容，重复 skill 名称的优先级、迁移结果和删除行为有明确测试覆盖。

## 现场证据

- 目录检查确认 `C:\Users\liangfeng\.lfcode\skills\archive-extract\SKILL.md` 存在。
- 源码检查确认全局扫描入口为 `packages/lfcode/src/skill/index.ts:180`，使用 `Global.Path.config\skills`。
- 管理接口检查确认 `packages/lfcode/src/server/routes/instance/skills.ts:1014` 的 `localSkillRoot()` 同样返回 `path.join(Global.Path.config, "skills")`。
- 当前进程检查确认实际运行进程为 `C:\算法\小应用\Lfcode\Lfcode.exe`。
