import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { CapabilityManageTool } from "../../src/tool/capability_manage"
import { ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.capability_manage", () => {
  it.live("manages grants through the registry with confirmation and audit", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.tools({
          providerID: "lfcode" as never,
          modelID: "gpt-5" as never,
          agent: { name: "build", mode: "primary", permission: [], options: {}, toolAllowlist: [CapabilityManageTool.id] },
        })).find((item) => item.id === CapabilityManageTool.id)
        if (!tool) throw new Error("capability_manage tool not found")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          sessionID: SessionID.make("ses_capability_manage"),
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: (request) => Effect.sync(() => requests.push(request)),
        }
        const grantID = `tool-capability-grant-${Date.now()}`
        const saved = yield* tool.execute(
          {
            action: "save_grant",
            grant_id: grantID,
            capability: "background_job",
            scope: "global",
            source: "core",
            remaining_budget: 2,
            reason: "Limit background work for this test",
          },
          ctx,
        )
        expect(requests[0]?.permission).toBe("edit")
        expect(saved.output).toContain(grantID)

        const listed = yield* tool.execute({ action: "list_grants", capability: "background_job", reason: "Review background grants" }, ctx)
        expect(listed.output).toContain(grantID)

        const revoked = yield* tool.execute({ action: "revoke_grant", grant_id: grantID, reason: "Remove test grant" }, ctx)
        expect(revoked.output).toContain('"revoked": true')
      }),
    ),
  )
})
