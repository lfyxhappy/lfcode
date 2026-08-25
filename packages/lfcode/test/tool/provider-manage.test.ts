import path from "path"
import * as fs from "fs/promises"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { ProviderManageTool } from "../../src/tool/provider_manage"
import { ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

function useGlobalConfig(directory: string) {
  const original = Global.Path.config
  ;(Global.Path as { config: string }).config = directory
  return () => {
    ;(Global.Path as { config: string }).config = original
  }
}

describe("tool.provider_manage", () => {
  it.live("creates and removes a custom Provider through the registry without exposing its credential", () =>
    provideTmpdirInstance(
      (directory) =>
        Effect.gen(function* () {
          const globalConfig = path.join(directory, "global-config")
          yield* Effect.promise(() => fs.mkdir(globalConfig, { recursive: true }))
          const restoreConfig = useGlobalConfig(globalConfig)
          yield* Effect.addFinalizer(() => Effect.sync(restoreConfig))
          const registry = yield* ToolRegistry.Service
          const tool = (yield* registry.tools({
            providerID: "lfcode" as never,
            modelID: "gpt-5" as never,
            agent: { name: "build", mode: "primary", permission: [], options: {}, toolAllowlist: [ProviderManageTool.id] },
          })).find((item) => item.id === ProviderManageTool.id)
          if (!tool) throw new Error("provider_manage tool not found")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            sessionID: SessionID.make("ses_provider_manage"),
            messageID: MessageID.make(""),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => Effect.void,
            ask: (request) => Effect.sync(() => requests.push(request)),
          }

          const saved = yield* tool.execute(
            {
              action: "save_custom",
              provider_id: "managed-provider",
              api_key: "test-secret-not-returned",
              config: {
                name: "Managed Provider",
                npm: "@ai-sdk/openai-compatible",
                protocol: "openai-chat",
                options: { baseURL: "https://example.test/v1" },
                models: { "managed-model": { name: "Managed model" } },
              },
              reason: "Create a managed provider for this task",
            },
            ctx,
          )
          expect(requests[0]?.permission).toBe("edit")
          expect(saved.output).toContain("managed-provider")
          expect(saved.output).not.toContain("test-secret-not-returned")

          const listed = yield* tool.execute({ action: "list", reason: "Review managed providers" }, ctx)
          expect(listed.output).toContain("managed-provider")
          expect(listed.output).not.toContain("test-secret-not-returned")

          const route = yield* tool.execute(
            {
              action: "set_route",
              route: "review",
              provider_id: "managed-provider",
              model_id: "managed-model",
              reason: "Route review tasks through the managed model",
            },
            ctx,
          )
          expect(route.output).toContain('"route": "review"')
          const configured = yield* Effect.promise(() => Bun.file(path.join(globalConfig, "lfcode.jsonc")).text())
          expect(configured).toContain('"review"')
          expect(configured).toContain('"managed-provider/managed-model"')

          const disabled = yield* tool.execute(
            { action: "disable", provider_id: "managed-provider", reason: "Disable the managed provider for this test" },
            ctx,
          )
          expect(disabled.output).toContain('"enabled": false')
          expect(yield* Effect.promise(() => Bun.file(path.join(globalConfig, "lfcode.jsonc")).text())).toContain('"disabled_providers"')

          const enabled = yield* tool.execute(
            { action: "enable", provider_id: "managed-provider", reason: "Re-enable the managed provider for this test" },
            ctx,
          )
          expect(enabled.output).toContain('"enabled": true')

          yield* tool.execute(
            { action: "remove_custom", provider_id: "managed-provider", reason: "Remove the test provider" },
            ctx,
          )
          const after = yield* tool.execute({ action: "list", reason: "Confirm test provider removal" }, ctx)
          expect(after.output).not.toContain("managed-provider")
        }),
      { git: true },
    ),
  )
})
