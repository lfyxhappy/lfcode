---
name: skill-creator
description: Use when creating, updating, packaging, or validating an Lfcode skill. Covers user-managed and built-in bundled skills. 用户提到创建 Skill、更新 Skill、打包 Skill、校验 Skill 或技能规范时使用。
---

# Lfcode Skill Creator

Create only the files another Lfcode agent needs.

## Choose the skill type

1. Create a user-managed skill through **Settings → Skills**. The runtime resolves its managed root from the active Lfcode profile: ordinary installations use `~/.lfcode/skills/<skill-name>/`; the pre-release installation uses `C:\Users\liangfeng\.lfcodepre\skills/<skill-name>/`.
2. Create a built-in skill under `packages/lfcode/src/skill/lfcode/.bundle/<skill-name>/` when the skill should ship with Lfcode itself.
3. Keep the folder name identical to the skill `name`. Use lowercase letters, digits, and hyphens only.

## Create the minimum structure

Every skill needs `SKILL.md` with YAML frontmatter:

```md
---
name: your-skill-name
description: Explain what the skill does and when Lfcode should use it.
---
```

Then write the body as operational instructions, not user-facing marketing text.

## Write discoverable metadata

- Put all discovery guidance in `description`, because that is what Lfcode sees before loading the body.
- Describe both the task and the situations where the skill is useful. For deterministic automatic activation, write literal user phrases in the standard description: `用户提到解压、改后缀或拍平时使用。` Do not add a `triggers` field. A matching phrase activates the body directly; unrelated descriptive words do not.
- Use only `name` and `description` in `SKILL.md` frontmatter. Do not add private activation fields such as `triggers`, `auto_activate`, or `hidden`.
- Keep the body under 500 lines whenever possible. Put the essential safety rules and workflow in `SKILL.md`; move long examples, history, API details and variant-specific guidance into directly linked `references/` files.
- Include `agents/openai.yaml` for user-facing metadata. Settings-created Skills generate it automatically; when authoring manually, keep `interface.display_name`, `interface.short_description`, and a `$skill-name` `interface.default_prompt` in sync with `SKILL.md`.

## Add bundled resources only when they help

- Add `scripts/` when the same deterministic steps would otherwise be rewritten each time.
- Add `references/` when the skill needs domain rules, APIs, or schemas that should be read only on demand.
- Add `assets/` when the skill needs templates or other files to copy or transform.
- Do not create extra documentation like `README.md` or changelogs just for the skill.

## Validate the right path

For a user-managed skill:

1. Create or update the Skill through Settings → Skills, or resolve the active managed profile root before editing files directly.
2. Confirm the folder contains `SKILL.md`.
3. Refresh skills in the app or call the skill discovery path again if needed.

For a built-in skill:

1. Create or update files under `packages/lfcode/src/skill/lfcode/.bundle/<skill-name>/`.
2. Remember that the bundle extractor copies everything under that folder into the runtime `lfcode-skills/<version>/skills/<skill-name>/` directory.
3. Add or update a test in `packages/lfcode/test/skill/skill.test.ts` so discovery proves the bundled skill exists and contains the expected instructions.

## Verify before finishing

1. Re-read `SKILL.md` and check that the folder name, frontmatter `name`, literal `用户提到……时使用` trigger phrases, and `agents/openai.yaml` metadata match.
2. For built-in skills, run `bun test test/skill/skill.test.ts` from `packages/lfcode`.
3. If the built-in skill should be available in the packaged desktop app, rebuild the desktop package so the bundle is refreshed.
