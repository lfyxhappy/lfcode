import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system", () => {
  test("default prompt keeps routine coding work in the direct loop", () => {
    const prompt = SystemPrompt.provider({ capabilities: { patch_editing: true } } as never).join("\n")

    expect(prompt).toContain("Do not perform a ritualized preflight")
    expect(prompt).toContain("Do not look up memory unless the user explicitly asks")
    expect(prompt).toContain("When the stated objective is complete, stop")
  })

  test("editing strategy directs fresh reads and long-line ranges", () => {
    const prompt = SystemPrompt.editingStrategy(true)

    expect(prompt).toContain("single edit tool")
    expect(prompt).toContain("fresh read")
    expect(prompt).toContain("offset, limit=1, startChar, and endChar")
    expect(prompt).toContain("Never bypass a failed structured edit")
  })

  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".lfcode", "skills", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const originalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          expect(first).toContain("<available_skills> catalog with every currently usable Skill")
          expect(first).toContain("Before any substantive answer or non-Skill tool action")
          expect(first).toContain("MUST call skill with the exact name")
          expect(first).toContain("Never use search_tool to find Skills")
          expect(first).not.toContain("alpha-skill")
        },
      })
    } finally {
      Object.defineProperty(Global.Path, "home", originalHome!)
    }
  })
})
