---
name: skill-creator
description: Use when creating, updating, packaging, or validating an Lfcode skill. Covers normal user-managed skills stored under `~/.lfcode/skills/<name>/` and built-in bundled skills shipped from `packages/lfcode/src/skill/lfcode/.bundle/<name>/`.
---

# Lfcode Skill Creator

Create only the files another Lfcode agent needs.

## Choose the skill type

1. Create a user-managed skill under `~/.lfcode/skills/<skill-name>/` when the skill should live in user data and be editable from the app.
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

## Write triggerable metadata

- Put all trigger guidance in `description`, because that is what Lfcode sees before loading the body.
- Describe both the task and the situations that should activate the skill.
- Keep the body concise. Move large references, scripts, or assets into files beside `SKILL.md` inside the same skill folder.

## Add bundled resources only when they help

- Add `scripts/` when the same deterministic steps would otherwise be rewritten each time.
- Add `references/` when the skill needs domain rules, APIs, or schemas that should be read only on demand.
- Add `assets/` when the skill needs templates or other files to copy or transform.
- Do not create extra documentation like `README.md` or changelogs just for the skill.

## Validate the right path

For a user-managed skill:

1. Create or update files under `~/.lfcode/skills/<skill-name>/`.
2. Confirm the folder contains `SKILL.md`.
3. Refresh skills in the app or call the skill discovery path again if needed.

For a built-in skill:

1. Create or update files under `packages/lfcode/src/skill/lfcode/.bundle/<skill-name>/`.
2. Remember that the bundle extractor copies everything under that folder into the runtime `lfcode-skills/<version>/skills/<skill-name>/` directory.
3. Add or update a test in `packages/lfcode/test/skill/skill.test.ts` so discovery proves the bundled skill exists and contains the expected instructions.

## Verify before finishing

1. Re-read `SKILL.md` and check that the folder name, frontmatter `name`, and intended trigger wording match.
2. For built-in skills, run `bun test test/skill/skill.test.ts` from `packages/lfcode`.
3. If the built-in skill should be available in the packaged desktop app, rebuild the desktop package so the bundle is refreshed.
