import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber } from "effect"
import { Hono } from "hono"
import { ErrorMiddleware } from "../../src/server/middleware"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRunState } from "../../src/session/run-state"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import { textStopResponse } from "../lib/scripted-llm-server"

void Log.init({ print: false })

function writeProviderConfig(dir: string, origin: string) {
  return Bun.write(
    path.join(dir, "lfcode.json"),
    JSON.stringify({
      $schema: "https://lfcode.ai/config.json",
      enabled_providers: ["alibaba"],
      provider: {
        alibaba: {
          options: {
            apiKey: "test-key",
            baseURL: `${origin}/v1`,
          },
        },
      },
      agent: {
        build: {
          model: "alibaba/qwen-plus",
        },
      },
    }),
  )
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("ErrorMiddleware → BusyError mapping", () => {
  test("BusyError maps to HTTP 409 Conflict", async () => {
    const app = new Hono()
    app.get("/throw-busy", () => {
      throw new Session.BusyError("ses_test_busy")
    })
    app.onError(ErrorMiddleware)

    const res = await app.request("/throw-busy")
    expect(res.status).toBe(409)
    const body = (await res.json()) as { name: string; data: { message: string } }
    expect(body.data.message).toContain("ses_test_busy")
  })
})

describe("POST /session/:sessionID/message busy-runner behavior", () => {
  test("returns 409 when session main runner is already busy", async () => {
    await using tmp = await tmpdir({})

    const status = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sess = yield* sessions.create({ title: "busy-runner test" })
            const state = yield* SessionRunState.Service

            // Occupy the main runner with an Effect that never resolves.
            // Forked so we can continue and issue the conflicting POST.
            yield* state
              .startShell(
                sess.id,
                Effect.succeed({ info: {}, parts: [] } as never),
                Effect.never as never,
              )
              .pipe(Effect.forkChild)

            // Give the scheduler a tick so the occupant marks the runner busy.
            yield* Effect.sleep("50 millis")

            // Pass ?directory= so InstanceMiddleware resolves to the same instance
            // the test created. Without this, the route handler would land in a
            // different Instance (process.cwd()) whose SessionRunState has no busy
            // runner, defeating the test.
            const app = Server.Default().app
            const res = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/message?directory=${encodeURIComponent(tmp.path)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  parts: [{ type: "text", text: "should be rejected" }],
                }),
              }),
            )

            // Best-effort: stop the occupant so afterEach disposal is clean.
            yield* state.cancel(sess.id)

            return res.status
          }),
        ),
    })

    expect(status).toBe(409)
  })

  test("POST /:sessionID/abort frees runner; subsequent POST is no longer rejected with 409", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sess = yield* sessions.create({ title: "busy-recover test" })
            const state = yield* SessionRunState.Service

            yield* state
              .startShell(
                sess.id,
                Effect.succeed({ info: {}, parts: [] } as never),
                Effect.never as never,
              )
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const app = Server.Default().app
            const dirQuery = `?directory=${encodeURIComponent(tmp.path)}`

            // 1. confirm busy → 409
            const first = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/message${dirQuery}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parts: [{ type: "text", text: "first" }] }),
              }),
            )

            // 2. abort frees the runner
            const abort = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/abort${dirQuery}`, { method: "POST" }),
            )

            // Wait for runner.cancel to take effect.
            yield* Effect.sleep("100 millis")

            // 3. subsequent POST is no longer 409 — assert just status != 409.
            //    (full success requires a real LLM; we only verify the contention
            //    is gone, not the prompt outcome.)
            const second = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/message${dirQuery}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parts: [{ type: "text", text: "second" }] }),
              }),
            )
            return { firstStatus: first.status, abortStatus: abort.status, secondStatus: second.status }
          }),
        ),
    })

    expect(result.firstStatus).toBe(409)
    expect(result.abortStatus).toBe(200)
    expect(result.secondStatus).not.toBe(409)
  })

  test("prompt_async returns 409 while the main runner is busy", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const state = yield* SessionRunState.Service
            const sess = yield* sessions.create({ title: "busy prompt_async test" })

            yield* state
              .ensureRunning(
                sess.id,
                "main",
                Effect.succeed({ info: {}, parts: [] } as never),
                Effect.never as never,
              )
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const app = Server.Default().app
            const res = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/prompt_async?directory=${encodeURIComponent(tmp.path)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agent: "main",
                  model: { providerID: "test", modelID: "test" },
                  parts: [{ type: "text", text: "steer while busy" }],
                }),
              }),
            )

            yield* state.cancel(sess.id)
            return res.status
          }),
        ),
    })

    expect(result).toBe(409)
  })

  test("prompt_async accepts delivery=steer while the main runner is busy", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const state = yield* SessionRunState.Service
            const sess = yield* sessions.create({ title: "busy prompt_async steer test" })

            yield* state
              .ensureRunning(
                sess.id,
                "main",
                Effect.succeed({ info: {}, parts: [] } as never),
                Effect.never as never,
              )
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const app = Server.Default().app
            const res = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/prompt_async?directory=${encodeURIComponent(tmp.path)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agent: "main",
                  model: { providerID: "test", modelID: "test" },
                  delivery: "steer",
                  parts: [{ type: "text", text: "steer while busy" }],
                }),
              }),
            )

            yield* state.cancel(sess.id)
            return res.status
          }),
        ),
    })

    expect(result).toBe(204)
  })

  test("prompt_async steer waits for the next safe boundary instead of starting a concurrent main run", async () => {
    const firstStarted = Promise.withResolvers<void>()
    const firstReleased = Promise.withResolvers<void>()
    const captures: Array<{ messages: Array<{ role: string; content: unknown }>; body: Record<string, unknown> }> = []
    let activeRequests = 0
    let maxConcurrentRequests = 0

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }

        const body = (await req.json()) as Record<string, unknown>
        captures.push({
          messages: Array.isArray(body.messages) ? (body.messages as Array<{ role: string; content: unknown }>) : [],
          body,
        })

        activeRequests += 1
        maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests)

        const finish = () => {
          activeRequests = Math.max(0, activeRequests - 1)
        }

        if (captures.length === 1) {
          const encoder = new TextEncoder()
          const first = `data: ${JSON.stringify({
            id: "chatcmpl-steer-held",
            object: "chat.completion.chunk",
            choices: [{ delta: { role: "assistant" } }],
          })}\n\n`
          const rest = textStopResponse("first-reply").slice(1).join("")

          return new Response(
            new ReadableStream<Uint8Array>({
              start(ctrl) {
                ctrl.enqueue(encoder.encode(first))
                firstStarted.resolve()
                void firstReleased.promise.then(() => {
                  ctrl.enqueue(encoder.encode(rest))
                  ctrl.close()
                  finish()
                })
              },
              cancel() {
                finish()
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            },
          )
        }

        const encoder = new TextEncoder()
        const lines = textStopResponse("second-reply")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              for (const line of lines) ctrl.enqueue(encoder.encode(line))
              ctrl.close()
              finish()
            },
            cancel() {
              finish()
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        )
      },
    })

    try {
      await using tmp = await tmpdir({ git: true })
      await writeProviderConfig(tmp.path, server.url.origin)

      const result = await Instance.provide({
        directory: tmp.path,
        fn: async () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const state = yield* SessionRunState.Service
              const sess = yield* sessions.create({ title: "busy prompt_async safe-boundary steer test" })
              const app = Server.Default().app
              const dirQuery = `?directory=${encodeURIComponent(tmp.path)}`

              const first = yield* Effect.promise(async () =>
                app.request(`/session/${sess.id}/prompt_async${dirQuery}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    agent: "build",
                    model: { providerID: "alibaba", modelID: "qwen-plus" },
                    parts: [{ type: "text", text: "first question" }],
                  }),
                }),
              )
              expect(first.status).toBe(204)

              yield* Effect.promise(() => firstStarted.promise)
              yield* Effect.sleep("50 millis")
              const busy = yield* state.assertNotBusy(sess.id).pipe(Effect.exit)
              expect(Exit.isFailure(busy)).toBe(true)

              const steer = yield* Effect.promise(async () =>
                app.request(`/session/${sess.id}/prompt_async${dirQuery}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    agent: "build",
                    model: { providerID: "alibaba", modelID: "qwen-plus" },
                    delivery: "steer",
                    parts: [{ type: "text", text: "second steer" }],
                  }),
                }),
              )
              expect(steer.status).toBe(204)

              yield* Effect.sleep("100 millis")
              expect(captures).toHaveLength(1)

              firstReleased.resolve()

              for (let attempt = 0; attempt < 80 && captures.length < 2; attempt++) {
                yield* Effect.sleep("25 millis")
              }

              expect(captures.length).toBeGreaterThanOrEqual(2)

              let finalIdle: Exit.Exit<void, unknown> | undefined
              for (let attempt = 0; attempt < 80; attempt++) {
                finalIdle = yield* state.assertNotBusy(sess.id).pipe(Effect.exit)
                if (Exit.isSuccess(finalIdle)) break
                yield* Effect.sleep("25 millis")
              }

              finalIdle ??= yield* state.assertNotBusy(sess.id).pipe(Effect.exit)
              expect(Exit.isSuccess(finalIdle)).toBe(true)
              expect(maxConcurrentRequests).toBe(1)
              expect(JSON.stringify(captures[1]?.messages ?? [])).toContain("second steer")

              const messages = yield* sessions.messages({ sessionID: sess.id })
              expect(messages.filter((message) => message.info.role === "user")).toHaveLength(2)
            }),
          ),
      })

      expect(result).toBeUndefined()
    } finally {
      await server.stop(true)
    }
  })

  test("SessionPrompt.cancel aborts a hung live stream and releases the runner for the next prompt", async () => {
    const firstStarted = Promise.withResolvers<void>()
    let requestCount = 0
    let activeRequests = 0

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }

        activeRequests += 1
        requestCount += 1
        let finished = false
        const finish = () => {
          if (finished) return
          finished = true
          activeRequests = Math.max(0, activeRequests - 1)
        }
        req.signal.addEventListener("abort", finish, { once: true })

        const call = requestCount
        if (call === 1) {
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream<Uint8Array>({
              start(ctrl) {
                ctrl.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      id: "chatcmpl-abort-held",
                      object: "chat.completion.chunk",
                      choices: [{ delta: { role: "assistant" } }],
                    })}\n\n`,
                  ),
                )
                firstStarted.resolve()
              },
              cancel() {
                finish()
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            },
          )
        }

        const encoder = new TextEncoder()
        const lines = textStopResponse("second-reply")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              for (const line of lines) ctrl.enqueue(encoder.encode(line))
              ctrl.close()
              finish()
            },
            cancel() {
              finish()
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        )
      },
    })

    try {
      await using tmp = await tmpdir({ git: true })
      await writeProviderConfig(tmp.path, server.url.origin)

      await Instance.provide({
        directory: tmp.path,
        fn: async () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const state = yield* SessionRunState.Service
              const prompt = yield* SessionPrompt.Service
              const sess = yield* sessions.create({ title: "live abort release test" })

              const first = yield* prompt
                .prompt({
                  sessionID: sess.id,
                  agent: "build",
                  model: { providerID: ProviderID.make("alibaba"), modelID: ModelID.make("qwen-plus") },
                  parts: [{ type: "text", text: "first question" }],
                })
                .pipe(Effect.forkChild)

              yield* Effect.promise(() => firstStarted.promise)
              yield* Effect.sleep("50 millis")
              expect(Exit.isFailure(yield* state.assertNotBusy(sess.id).pipe(Effect.exit))).toBe(true)

              const cancelExit = yield* prompt.cancel(sess.id).pipe(Effect.timeout("3 seconds"), Effect.exit)
              expect(Exit.isSuccess(cancelExit)).toBe(true)

              let idle: Exit.Exit<void, unknown> | undefined
              for (let attempt = 0; attempt < 80; attempt++) {
                idle = yield* state.assertNotBusy(sess.id).pipe(Effect.exit)
                if (Exit.isSuccess(idle)) break
                yield* Effect.sleep("25 millis")
              }
              expect(Exit.isSuccess(idle ?? (yield* state.assertNotBusy(sess.id).pipe(Effect.exit)))).toBe(true)

              const second = yield* prompt.prompt({
                sessionID: sess.id,
                agent: "build",
                model: { providerID: ProviderID.make("alibaba"), modelID: ModelID.make("qwen-plus") },
                parts: [{ type: "text", text: "second question" }],
              })

              expect(second.info.role).toBe("assistant")
              expect(requestCount).toBeGreaterThanOrEqual(2)
              yield* Fiber.interrupt(first).pipe(Effect.ignore)
            }),
          ),
      })
    } finally {
      await server.stop(true)
    }
  })

})
