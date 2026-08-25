import path from "path"
import matter from "gray-matter"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { SkillManageTool } from "../../src/tool/skill_manage"
import { ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

function useManagedSkillHome(home: string) {
  const original = Object.getOwnPropertyDescriptor(Global.Path, "home")
  Object.defineProperty(Global.Path, "home", { configurable: true, value: home })
  return () => Object.defineProperty(Global.Path, "home", original!)
}

describe("tool.skill_manage", () => {
  it.live("creates and deletes a managed Skill through the registry", () =>
    provideTmpdirInstance(
      (directory) =>
        Effect.gen(function* () {
          const restoreHome = useManagedSkillHome(directory)
          yield* Effect.addFinalizer(() => Effect.sync(restoreHome))
          const registry = yield* ToolRegistry.Service
          const tool = (yield* registry.tools({
            providerID: "lfcode" as never,
            modelID: "gpt-5" as never,
            agent: { name: "build", mode: "primary", permission: [], options: {}, toolAllowlist: [SkillManageTool.id] },
          })).find((item) => item.id === SkillManageTool.id)
          if (!tool) throw new Error("skill_manage tool not found")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            sessionID: SessionID.make("ses_skill_manage"),
            messageID: MessageID.make(""),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => Effect.void,
            ask: (request) => Effect.sync(() => requests.push(request)),
          }

          const listed = yield* tool.execute({ action: "list" }, ctx)
          expect(listed.title).toBe("List managed Skills")
          expect(requests).toEqual([])

          yield* tool.execute({ action: "create", name: "managed-skill", description: "Created by the management tool.", reason: "Create a test Skill" }, ctx)
          expect(requests[0]?.permission).toBe("edit")
          expect(
            yield* Effect.promise(() => Bun.file(path.join(directory, ".lfcode", "skills", "managed-skill", "SKILL.md")).exists()),
          ).toBe(true)

          yield* tool.execute(
            {
              action: "create",
              name: "yaml-content-skill",
              content: `---
name: ignored-name
description: 'YAML: # and "quotes" remain valid'
---

# YAML Content Skill
`,
              reason: "Create a frontmatter-only Skill test",
            },
            ctx,
          )
          const created = yield* Effect.promise(() =>
            Bun.file(path.join(directory, ".lfcode", "skills", "yaml-content-skill", "SKILL.md")).text(),
          )
          expect(matter(created).data).toMatchObject({
            name: "yaml-content-skill",
            description: 'YAML: # and "quotes" remain valid',
          })

          yield* tool.execute({ action: "delete", name: "managed-skill", reason: "Remove the test Skill" }, ctx)
          yield* tool.execute({ action: "delete", name: "yaml-content-skill", reason: "Remove the YAML test Skill" }, ctx)
          expect(
            yield* Effect.promise(() => Bun.file(path.join(directory, ".lfcode", "skills", "managed-skill", "SKILL.md")).exists()),
          ).toBe(false)
        }),
      { git: true },
    ),
  )
})
