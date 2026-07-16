import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Stream, ManagedRuntime, Layer } from "effect"
import { LLM } from "../../src/session/llm"
import { ActorRegistry } from "../../src/actor/registry"
import { Session as SessionNs } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Global } from "../../src/global"
import { Memory } from "../../src/memory"
import { Database } from "../../src/storage"
import { MemoryFtsTable } from "../../src/memory/fts.sql"
import fs from "fs/promises"

// Reuses the same HTTP-mock approach from llm.test.ts to capture the
// system prompt the LLM layer assembled before sending. The system prompt
// is the only place buildMemoryInstructions content lands ("# Memory system");
// asserting on body.system gives a concrete check that the agentID guard
// fired without having to extract the private helper.

type Capture = { url: URL; headers: Headers; body: Record<string, unknown> }

const queueState = {
  server: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Array<{
    path: string
    response: Response
    resolve: (value: Capture) => void
  }>,
}

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => (result.resolve = resolve))
  return result
}

function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  queueState.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

function createChatStream(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] })}`,
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

async function seedMemoryRoot() {
  const rt = ManagedRuntime.make(Layer.mergeAll(Memory.defaultLayer))
  try {
    const root = await rt.runPromise(Memory.Service.use((svc) => svc.root()))
    await Bun.write(path.join(root, "global", "MEMORY.md"), "durable memory entry")
    await rt.runPromise(Memory.Service.use((svc) => svc.reconcile()))
  } finally {
    await rt.dispose()
  }
}

async function resetMemoryState() {
  const rt = ManagedRuntime.make(Layer.mergeAll(Memory.defaultLayer))
  try {
    const root = await rt.runPromise(Memory.Service.use((svc) => svc.root()))
    await fs.rm(root, { recursive: true, force: true })
    Database.use((db) => db.delete(MemoryFtsTable).run())
  } finally {
    await rt.dispose()
  }
}

async function loadFixture(providerID: string, modelID: string) {
  const fixturePath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")
  const data = await Filesystem.readJson<Record<string, any>>(fixturePath)
  const provider = data[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return { provider, model }
}

beforeAll(() => {
  queueState.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const next = queueState.queue.shift()
      if (!next) return new Response("unexpected request", { status: 500 })
      const url = new URL(req.url)
      const body = (await req.json()) as Record<string, unknown>
      next.resolve({ url, headers: req.headers, body })
      if (!url.pathname.endsWith(next.path)) return new Response("not found", { status: 404 })
      return next.response
    },
  })
})

beforeEach(() => {
  queueState.queue.length = 0
  return resetMemoryState()
})

afterAll(() => {
  void queueState.server?.stop()
})

async function getModel(providerID: ProviderID, modelID: ModelID) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.getModel(providerID, modelID)
    }),
  )
}

function makeBaseUser(sessionID: SessionID, providerID: string, modelID: ModelID): MessageV2.User {
  return {
    id: MessageID.make("user-llm-sysprompt"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: ProviderID.make(providerID), modelID },
  } satisfies MessageV2.User
}

function makeAgent(): Agent.Info {
  return {
    name: "test",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  } satisfies Agent.Info
}

function tmpConfig(providerID: string, baseURL: string) {
  return JSON.stringify({
    $schema: "https://lfcode.ai/config.json",
    enabled_providers: [providerID],
    provider: {
      [providerID]: { options: { apiKey: "test-key", baseURL } },
    },
  })
}

describe("session.llm system prompt — memory-instructions guard", () => {
  test("main agent (no agentID) — '# Memory system' IS appended", async () => {
    const server = queueState.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "lfcode.json"), tmpConfig(providerID, `${server.url.origin}/v1`))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await seedMemoryRoot()
        const resolved = await getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
        const sessionRt = ManagedRuntime.make(SessionNs.defaultLayer)
        let sessionID: SessionID
        try {
          const info = await sessionRt.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          sessionID = info.id
        } finally {
          await sessionRt.dispose()
        }
        const rt = ManagedRuntime.make(Layer.mergeAll(LLM.defaultLayer))
        try {
          await rt.runPromise(
            LLM.Service.use((svc) =>
              svc
                .stream({
                  user: makeBaseUser(sessionID, providerID, resolved.id),
                  sessionID,
                  model: resolved,
                  agent: makeAgent(),
                  system: ["You are a helpful assistant."],
                  messages: [{ role: "user", content: "Hello" }],
                  tools: {},
                })
                .pipe(Stream.runDrain),
            ),
          )
        } finally {
          await rt.dispose()
        }
        const capture = await request
        const messages = capture.body.messages as Array<{ role: string; content: string }>
        const sysMsgs = messages.filter((m) => m.role === "system")
        const allSys = sysMsgs.map((m) => m.content).join("\n")
        expect(allSys).toContain("# Memory system")
      },
    })
  })

  test("system-spawned actor — '# Memory system' is NOT appended", async () => {
    const server = queueState.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "lfcode.json"), tmpConfig(providerID, `${server.url.origin}/v1`))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await seedMemoryRoot()
        const resolved = await getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
        // Create a real session row first — actor_registry.session_id is a FK to session.id.
        const sessionRt = ManagedRuntime.make(SessionNs.defaultLayer)
        let sessionID: SessionID
        try {
          const info = await sessionRt.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          sessionID = info.id
        } finally {
          await sessionRt.dispose()
        }

        // Register a system-spawn actor at this session BEFORE the stream call.
        // ActorRegistry uses the global Database, which is shared with the
        // LLM-runtime's actorRegistry layer instance, so the row is visible
        // to isSystemSpawned() during stream assembly.
        const regRt = ManagedRuntime.make(ActorRegistry.defaultLayer)
        try {
          await regRt.runPromise(
            ActorRegistry.Service.use((svc) =>
              svc.register({
                sessionID,
                actorID: "checkpoint-writer-1",
                mode: "subagent",
                agent: "checkpoint-writer",
                description: "writer fixture",
                contextMode: "full",
                background: true,
                lifecycle: "ephemeral",
              }),
            ),
          )
        } finally {
          await regRt.dispose()
        }

        const rt = ManagedRuntime.make(Layer.mergeAll(LLM.defaultLayer))
        try {
          await rt.runPromise(
            LLM.Service.use((svc) =>
              svc
                .stream({
                  user: makeBaseUser(sessionID, providerID, resolved.id),
                  sessionID,
                  model: resolved,
                  agent: makeAgent(),
                  system: ["You are a helpful assistant."],
                  messages: [{ role: "user", content: "Hello" }],
                  tools: {},
                  agentID: "checkpoint-writer-1",
                })
                .pipe(Stream.runDrain),
            ),
          )
        } finally {
          await rt.dispose()
        }
        const capture = await request
        const messages = capture.body.messages as Array<{ role: string; content: string }>
        const sysMsgs = messages.filter((m) => m.role === "system")
        const allSys = sysMsgs.map((m) => m.content).join("\n")
        expect(allSys).not.toContain("# Memory system")
      },
    })
  })

  test("main agent (no agentID) — Active recall protocol IS in system prompt (F4a)", async () => {
    const server = queueState.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "lfcode.json"), tmpConfig(providerID, `${server.url.origin}/v1`))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await seedMemoryRoot()
        const resolved = await getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
        const sessionRt = ManagedRuntime.make(SessionNs.defaultLayer)
        let sessionID: SessionID
        try {
          const info = await sessionRt.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          sessionID = info.id
        } finally {
          await sessionRt.dispose()
        }
        const rt = ManagedRuntime.make(Layer.mergeAll(LLM.defaultLayer))
        try {
          await rt.runPromise(
            LLM.Service.use((svc) =>
              svc
                .stream({
                  user: makeBaseUser(sessionID, providerID, resolved.id),
                  sessionID,
                  model: resolved,
                  agent: makeAgent(),
                  system: ["You are a helpful assistant."],
                  messages: [{ role: "user", content: "Hello" }],
                  tools: {},
                })
                .pipe(Stream.runDrain),
            ),
          )
        } finally {
          await rt.dispose()
        }
        const capture = await request
        const messages = capture.body.messages as Array<{ role: string; content: string }>
        const sysMsgs = messages.filter((m) => m.role === "system")
        const allSys = sysMsgs.map((m) => m.content).join("\n")
        expect(allSys).toContain("Active recall protocol")
        expect(allSys).toContain("targeted `read(offset)`")
        expect(allSys).toContain("do not Read them again as whole files")
      },
    })
  })

  test("buildMemoryInstructions keeps compact ownership rules (F22)", async () => {
    const server = queueState.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "lfcode.json"), tmpConfig(providerID, `${server.url.origin}/v1`))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await seedMemoryRoot()
        const resolved = await getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
        const sessionRt = ManagedRuntime.make(SessionNs.defaultLayer)
        let sessionID: SessionID
        try {
          const info = await sessionRt.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          sessionID = info.id
        } finally {
          await sessionRt.dispose()
        }
        const rt = ManagedRuntime.make(Layer.mergeAll(LLM.defaultLayer))
        try {
          await rt.runPromise(
            LLM.Service.use((svc) =>
              svc
                .stream({
                  user: makeBaseUser(sessionID, providerID, resolved.id),
                  sessionID,
                  model: resolved,
                  agent: makeAgent(),
                  system: ["You are a helpful assistant."],
                  messages: [{ role: "user", content: "Hello" }],
                  tools: {},
                })
                .pipe(Stream.runDrain),
            ),
          )
        } finally {
          await rt.dispose()
        }
        const capture = await request
        const messages = capture.body.messages as Array<{ role: string; content: string }>
        const sysMsgs = messages.filter((m) => m.role === "system")
        const allSys = sysMsgs.map((m) => m.content).join("\n")

        expect(allSys).toContain("Active recall protocol")
        expect(allSys).toContain("only scratchpad")
        expect(allSys).toContain("MEMORY.md")
        expect(allSys).toContain("Do not create other ad-hoc memory files")
        expect(allSys).toContain("higher-priority instruction explicitly requires it")
        expect(allSys).toContain("relevant topic memory")
        expect(allSys).not.toContain("Subagent return format")
      },
    })
  })

  test("memory instructions degrade when memory is not initialized", async () => {
    const server = queueState.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "lfcode.json"), tmpConfig(providerID, `${server.url.origin}/v1`))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
        const sessionRt = ManagedRuntime.make(SessionNs.defaultLayer)
        let sessionID: SessionID
        try {
          const info = await sessionRt.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          sessionID = info.id
        } finally {
          await sessionRt.dispose()
        }
        const rt = ManagedRuntime.make(Layer.mergeAll(LLM.defaultLayer))
        try {
          await rt.runPromise(
            LLM.Service.use((svc) =>
              svc
                .stream({
                  user: makeBaseUser(sessionID, providerID, resolved.id),
                  sessionID,
                  model: resolved,
                  agent: makeAgent(),
                  system: ["You are a helpful assistant."],
                  messages: [{ role: "user", content: "Hello" }],
                  tools: {},
                })
                .pipe(Stream.runDrain),
            ),
          )
        } finally {
          await rt.dispose()
        }
        const capture = await request
        const messages = capture.body.messages as Array<{ role: string; content: string }>
        const sysMsgs = messages.filter((m) => m.role === "system")
        const allSys = sysMsgs.map((m) => m.content).join("\n")
        expect(allSys).toContain("Memory is currently not initialized as a reliable searchable corpus")
        expect(allSys).not.toContain("You have a persistent file-based memory system")
      },
    })
  })

  test("main agent memory instructions use absolute memory paths", async () => {
    const server = queueState.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const request = waitRequest(
      "/chat/completions",
      new Response(createChatStream("Hi"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "lfcode.json"), tmpConfig(providerID, `${server.url.origin}/v1`))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await seedMemoryRoot()
        const resolved = await getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
        const sessionRt = ManagedRuntime.make(SessionNs.defaultLayer)
        let sessionID: SessionID
        try {
          const info = await sessionRt.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          sessionID = info.id
        } finally {
          await sessionRt.dispose()
        }
        const rt = ManagedRuntime.make(Layer.mergeAll(LLM.defaultLayer))
        try {
          await rt.runPromise(
            LLM.Service.use((svc) =>
              svc
                .stream({
                  user: makeBaseUser(sessionID, providerID, resolved.id),
                  sessionID,
                  model: resolved,
                  agent: makeAgent(),
                  system: ["You are a helpful assistant."],
                  messages: [{ role: "user", content: "Hello" }],
                  tools: {},
                })
                .pipe(Stream.runDrain),
            ),
          )
        } finally {
          await rt.dispose()
        }
        const capture = await request
        const allSys = (capture.body.messages as Array<{ role: string; content: string }>)
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n")
        expect(allSys).toContain(path.join(Global.Path.data, "memory", "projects", Instance.current.project.id, "MEMORY.md"))
        expect(allSys).toContain(path.join(Global.Path.data, "memory", "sessions", sessionID, "checkpoint.md"))
        expect(allSys).toContain(path.join(Global.Path.data, "memory", "sessions", sessionID, "notes.md"))
        expect(allSys).toContain("Global memory")
        expect(allSys).toContain(path.join(Global.Path.data, "memory", "global", "MEMORY.md"))
        expect(allSys).not.toContain("<data>/memory/projects")
        expect(allSys).not.toContain("<data>/memory/sessions")
      },
    })
  })
})
