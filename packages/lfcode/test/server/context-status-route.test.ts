import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { ModelID, ProviderID } from "@/provider/schema"
import { Server } from "@/server/server"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("GET /session/:sessionID/context-status", () => {
  test("returns diagnostics without exposing stored context content", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const session = yield* sessions.create({ title: "context status" })
            const user = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: session.id,
              agent: "build",
              model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
              time: { created: Date.now() },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: user.id,
              type: "text",
              text: "private prompt content must stay out of diagnostics",
            })
            return session.id
          }),
        ),
    })

    const response = await Server.Default().app.request(`/session/${sessionID}/context-status`, {
      headers: { "x-lfcode-directory": tmp.path },
    })
    const body = (await response.json()) as Record<string, unknown>
    const activeContextTokens = Number(body.active_context_tokens)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      active_context_tokens: expect.any(Number),
      used_tokens: 0,
      pressure: "idle",
      source: "raw",
      projection: { media: 0, reasoning: 0, tool_results: 0 },
      checkpoint: { exists: false, writer_running: false, watermark: null },
    })
    expect(body.active_context_tokens).not.toBeNull()
    expect(activeContextTokens).toBeGreaterThan(0)
    expect(JSON.stringify(body)).not.toContain("private prompt content")
  })
})
