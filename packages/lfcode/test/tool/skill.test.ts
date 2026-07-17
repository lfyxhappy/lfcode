import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

function useManagedSkillHome(home: string) {
  const original = Object.getOwnPropertyDescriptor(Global.Path, "home")
  Object.defineProperty(Global.Path, "home", { configurable: true, value: home })
  return () => Object.defineProperty(Global.Path, "home", original!)
}

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

describe("tool.skill", () => {
  it.live("execute returns skill content block with files", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const restoreHome = useManagedSkillHome(dir)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              restoreHome()
            }),
          )

          const skill = path.join(dir, ".lfcode", "skills", "tool-skill")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skill, "SKILL.md"),
              `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
            ),
          )
          yield* Effect.promise(() => Bun.write(path.join(skill, "scripts", "demo.txt"), "demo"))

          const registry = yield* ToolRegistry.Service
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = (yield* registry.tools({
            providerID: "lfcode" as any,
            modelID: "gpt-5" as any,
            agent,
          })).find((tool) => tool.id === SkillTool.id)
          if (!tool) throw new Error("Skill tool not found")

          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = yield* tool.execute({ name: "tool-skill" }, ctx)
          const file = path.resolve(skill, "scripts", "demo.txt")

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")
          expect(result.metadata.dir).toBe(skill)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(skill).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        }),
      { git: true },
    ),
  )

  it.live("keyword input returns matching skill candidates without loading", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const restoreHome = useManagedSkillHome(dir)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              restoreHome()
            }),
          )

          const alpha = path.join(dir, ".lfcode", "skills", "react-testing")
          const beta = path.join(dir, ".lfcode", "skills", "vite-build")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(alpha, "SKILL.md"),
              `---
name: react-testing
description: Testing React UI behavior.
---

# React Testing
`,
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(
              path.join(beta, "SKILL.md"),
              `---
name: vite-build
description: Build and bundle Vite projects.
---

# Vite Build
`,
            ),
          )

          const registry = yield* ToolRegistry.Service
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = (yield* registry.tools({
            providerID: "lfcode" as any,
            modelID: "gpt-5" as any,
            agent,
          })).find((tool) => tool.id === SkillTool.id)
          if (!tool) throw new Error("Skill tool not found")

          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = yield* tool.execute({ name: "react test" }, ctx)

          expect(requests.length).toBe(0)
          expect(result.metadata.mode).toBe("search")
          expect(result.metadata.matches).toContain("react-testing")
          expect(result.output).toContain("<skill_search_results>")
          expect(result.output).toContain("- react-testing: Testing React UI behavior.")
          expect(result.output).toContain("Call the skill tool again with one of the exact names above")
        }),
      { git: true },
    ),
  )

  it.live("blank or list-style input returns the current available skills without error", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const restoreHome = useManagedSkillHome(dir)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              restoreHome()
            }),
          )

          const alpha = path.join(dir, ".lfcode", "skills", "alpha-skill")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(alpha, "SKILL.md"),
              `---
name: alpha-skill
description: Alpha skill for list mode.
---

# Alpha Skill
`,
            ),
          )

          const registry = yield* ToolRegistry.Service
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = (yield* registry.tools({
            providerID: "lfcode" as any,
            modelID: "gpt-5" as any,
            agent,
          })).find((tool) => tool.id === SkillTool.id)
          if (!tool) throw new Error("Skill tool not found")

          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const blank = yield* tool.execute({ name: "   " }, ctx)
          const list = yield* tool.execute({ name: "现在有哪些可用技能" }, ctx)

          expect(requests.length).toBe(0)
          expect(blank.metadata.mode).toBe("list")
          expect(blank.output).toContain("<available_skills>")
          expect(blank.output).toContain("<name>alpha-skill</name>")
          expect(list.metadata.mode).toBe("list")
          expect(list.output).toContain("<name>alpha-skill</name>")
        }),
      { git: true },
    ),
  )
})
