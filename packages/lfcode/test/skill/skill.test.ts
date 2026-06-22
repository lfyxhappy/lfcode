import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "../../src/global"
import { Skill } from "../../src/skill"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"

const originalDisableComposeSkills = process.env.LFCODE_DISABLE_COMPOSE_SKILLS
const originalDisableLfcodeSkills = process.env.LFCODE_DISABLE_LFCODE_SKILLS

beforeAll(() => {
  process.env.LFCODE_DISABLE_COMPOSE_SKILLS = "true"
  process.env.LFCODE_DISABLE_LFCODE_SKILLS = "true"
})

afterAll(() => {
  if (originalDisableComposeSkills === undefined) delete process.env.LFCODE_DISABLE_COMPOSE_SKILLS
  else process.env.LFCODE_DISABLE_COMPOSE_SKILLS = originalDisableComposeSkills
  if (originalDisableLfcodeSkills === undefined) delete process.env.LFCODE_DISABLE_LFCODE_SKILLS
  else process.env.LFCODE_DISABLE_LFCODE_SKILLS = originalDisableLfcodeSkills
})

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Skill.defaultLayer, node))

describe("skill", () => {
  it.live("discovers skills from the managed global skills directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const originalConfig = Global.Path.config
          Object.assign(Global.Path, { config: dir })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              Object.assign(Global.Path, { config: originalConfig })
            }),
          )

          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, "skills", "test-skill", "SKILL.md"),
              `---\nname: test-skill\ndescription: A test skill for verification.\n---\n\n# Test Skill\n\nInstructions here.\n`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "test-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A test skill for verification.")
          expect(item!.location).toContain(path.join("skills", "test-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("returns skill directories from Skill.dirs", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const originalConfig = Global.Path.config
          Object.assign(Global.Path, { config: dir })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              Object.assign(Global.Path, { config: originalConfig })
            }),
          )

          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, "skills", "dir-skill", "SKILL.md"),
              `---\nname: dir-skill\ndescription: Skill for dirs test.\n---\n\n# Dir Skill\n`,
            ),
          )

          const skill = yield* Skill.Service
          const dirs = yield* skill.dirs()
          expect(dirs).toContain(path.join(dir, "skills", "dir-skill"))
          expect(dirs.length).toBe(1)
        }),
      { git: true },
    ),
  )

  it.live("discovers multiple skills from the managed global skills directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const originalConfig = Global.Path.config
          Object.assign(Global.Path, { config: dir })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              Object.assign(Global.Path, { config: originalConfig })
            }),
          )

          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, "skills", "skill-one", "SKILL.md"),
                `---\nname: skill-one\ndescription: First test skill.\n---\n\n# Skill One\n`,
              ),
              Bun.write(
                path.join(dir, "skills", "skill-two", "SKILL.md"),
                `---\nname: skill-two\ndescription: Second test skill.\n---\n\n# Skill Two\n`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "skill-one")).toBeDefined()
          expect(list.find((x) => x.name === "skill-two")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skips skills with missing frontmatter", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const originalConfig = Global.Path.config
          Object.assign(Global.Path, { config: dir })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              Object.assign(Global.Path, { config: originalConfig })
            }),
          )

          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, "skills", "no-frontmatter", "SKILL.md"),
              `# No Frontmatter\n\nJust some content without YAML frontmatter.\n`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("does not discover project-local or external skill directories outside the managed root", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const originalConfig = Global.Path.config
          Object.assign(Global.Path, { config: dir })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              Object.assign(Global.Path, { config: originalConfig })
            }),
          )

          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".lfcode", "skills", "project-skill", "SKILL.md"),
                `---\nname: project-skill\ndescription: Project skill.\n---\n`,
              ),
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---\nname: claude-skill\ndescription: Claude skill.\n---\n`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---\nname: agent-skill\ndescription: Agent skill.\n---\n`,
              ),
              Bun.write(
                path.join(dir, ".codex", "skills", "codex-skill", "SKILL.md"),
                `---\nname: codex-skill\ndescription: Codex skill.\n---\n`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers bundled Lfcode Playwright browser skill", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          process.env.LFCODE_DISABLE_LFCODE_SKILLS = "false"
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.LFCODE_DISABLE_LFCODE_SKILLS = "true"
            }),
          )

          const skill = yield* Skill.Service
          const item = (yield* skill.all()).find((x) => x.name === "playwright-browser")
          expect(item).toBeDefined()
          expect(item!.description).toContain("embedded side browser")
          expect(item!.description).toContain("hidden or collapsed")
          expect(item!.content).toContain("persist:lfcode-browser")
          expect(item!.content).toContain("hidden, inactive")
          expect(item!.content).toContain("Create or open a side browser tab only when no embedded browser target exists")
          expect(item!.location).toContain(path.join("lfcode-skills"))
        }),
      { git: true },
    ),
  )

  it.live("discovers bundled Lfcode skill creator skill", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          process.env.LFCODE_DISABLE_LFCODE_SKILLS = "false"
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.LFCODE_DISABLE_LFCODE_SKILLS = "true"
            }),
          )

          const skill = yield* Skill.Service
          const item = (yield* skill.all()).find((x) => x.name === "skill-creator")
          expect(item).toBeDefined()
          expect(item!.description).toContain("creating, updating, packaging, or validating an Lfcode skill")
          expect(item!.description).toContain("built-in bundled skills")
          expect(item!.content).toContain("Create a user-managed skill under `<lfcode-config-root>/skills/<skill-name>/`")
          expect(item!.content).toContain("packages/lfcode/src/skill/lfcode/.bundle/<skill-name>/")
          expect(item!.content).toContain("bun test test/skill/skill.test.ts")
          expect(item!.location).toContain(path.join("lfcode-skills"))
        }),
      { git: true },
    ),
  )
})
