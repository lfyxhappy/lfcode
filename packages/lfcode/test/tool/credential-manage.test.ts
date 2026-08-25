import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { CredentialManageTool } from "../../src/tool/credential_manage"
import { ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.credential_manage", () => {
  it.live("stores and removes credentials without returning secret values", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.tools({
          providerID: "lfcode" as never,
          modelID: "gpt-5" as never,
          agent: { name: "build", mode: "primary", permission: [], options: {}, toolAllowlist: [CredentialManageTool.id] },
        })).find((item) => item.id === CredentialManageTool.id)
        if (!tool) throw new Error("credential_manage tool not found")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          sessionID: SessionID.make("ses_credential_manage"),
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: (request) => Effect.sync(() => requests.push(request)),
        }
        const secret = "credential-test-value-not-returned"

        const saved = yield* tool.execute(
          { action: "set_api_key", provider_id: "credential-test", api_key: secret, reason: "Store a test credential" },
          ctx,
        )
        expect(requests[0]?.permission).toBe("edit")
        expect(saved.output).not.toContain(secret)

        const listed = yield* tool.execute({ action: "list", reason: "Inspect credential metadata" }, ctx)
        expect(listed.output).toContain("credential-test")
        expect(listed.output).toContain('"type": "api"')
        expect(listed.output).not.toContain(secret)

        const removed = yield* tool.execute(
          { action: "remove", provider_id: "credential-test", reason: "Remove a test credential" },
          ctx,
        )
        expect(removed.output).toContain('"removed": true')
      }),
    ),
  )
})
