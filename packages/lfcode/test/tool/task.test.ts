import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { CapabilityPersistence } from "../../src/capability/persistence"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { TaskRegistry } from "../../src/task/registry"
import { Truncate } from "../../src/tool"
import { TaskTool } from "../../src/tool/task"
import { transformedToolSchema } from "../../src/tool/registry"
import { shellWrap } from "../../src/tool/shell-wrap"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(() => Instance.disposeAll())

const it = testEffect(
  Layer.mergeAll(
    Bus.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    TaskRegistry.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = (sessionID: string) => ({
  sessionID: SessionID.make(sessionID),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("task tool", () => {
  it.live("create with summary returns new task id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: { action: "create", summary: "Implement auth" } }, ctx(sess.id))
        expect(result.output).toContain("T1")
        expect(result.metadata.id).toBe("T1")
      }),
    ),
  )

  it.live("list returns tasks for current session", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const reg = yield* TaskRegistry.Service
        const sess = yield* session.create({ title: "Test" })
        yield* reg.create({ session_id: sess.id, summary: "a" })
        yield* reg.create({ session_id: sess.id, summary: "b" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: { action: "list" } }, ctx(sess.id))
        expect(result.metadata.count).toBe(2)
        expect(CapabilityPersistence.listAudit({ capability: "context_read" })).toContainEqual(
          expect.objectContaining({ reason: "Task list", rollback: expect.objectContaining({ sessions: [sess.id], tasks: ["T1", "T2"] }) }),
        )
      }),
    ),
  )

  it.live("set_status=done transitions task", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const reg = yield* TaskRegistry.Service
        const sess = yield* session.create({ title: "Test" })
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        yield* tool.execute({ operation: { action: "done", id: t.id } }, ctx(sess.id))
        const after = yield* reg.get({ session_id: sess.id, id: t.id })
        expect(after?.status).toBe("done")
      }),
    ),
  )

  it.live("rename with summary renames the task", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const reg = yield* TaskRegistry.Service
        const sess = yield* session.create({ title: "Test" })
        const t = yield* reg.create({ session_id: sess.id, summary: "old name" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        yield* tool.execute({ operation: { action: "rename", id: t.id, summary: "new name" } }, ctx(sess.id))
        const after = yield* reg.get({ session_id: sess.id, id: t.id })
        expect(after?.summary).toBe("new name")
      }),
    ),
  )

  it.live("rejects old flat JSON shape", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ action: "create", summary: "Implement auth" } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live("rejects create without summary", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(tool.execute({ operation: { action: "create" } } as any, ctx(sess.id)))
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live("rejects progress without event_summary", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const reg = yield* TaskRegistry.Service
        const sess = yield* session.create({ title: "Test" })
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ operation: { action: "progress", id: t.id } } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live("create ignores a model-supplied id because the registry allocates it", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: { action: "create", id: "T99", summary: "Generated id" } } as any,
          ctx(sess.id),
        )
        expect(result.metadata.id).toBe("T1")
        expect(result.output).toContain("Created T1")
      }),
    ),
  )

  it.live("create accepts harmless fields copied from a task-list item", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          {
            operation: {
              action: "create",
              id: "unused",
              parent_id: "unused",
              summary: "Implement the kanban board",
              event_summary: "prepare implementation",
              include_archived: false,
              include_terminal: false,
              status: "open",
              session_id: sess.id,
            },
          } as any,
          ctx(sess.id),
        )
        expect(result.metadata.id).toBe("T1")
        expect(result.output).toContain("Implement the kanban board")
      }),
    ),
  )

  it.live("create still rejects missing summary after id normalization", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ operation: { action: "create", id: "T99" } } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          expect(String(exit.cause)).toContain("summary")
          expect(String(exit.cause)).toContain("task id is generated")
        }
      }),
    ),
  )

  it.live("emits a flat nested operation schema for openai-compatible models", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const info = yield* TaskTool
        const tool = yield* info.init()
        const schema = transformedToolSchema(
          { providerID: "jws", api: { id: "grok-4.5", npm: "@ai-sdk/openai-compatible" } } as any,
          tool.parameters,
        ) as any
        expect(schema.properties.operation.type).toBe("object")
        expect(schema.properties.operation.anyOf).toBeUndefined()
        expect(schema.properties.operation.oneOf).toBeUndefined()
        expect(schema.properties.operation.required).toEqual(["action"])
        expect(schema.properties.operation.properties.action.enum).toContain("create")
        expect(schema.properties.operation.properties.action.enum).toContain("done")
      }),
    ),
  )
})

describe("task tool: deprecated verbs are rejected", () => {
  it.live("set_status operation itself is rejected (replaced by independent verbs)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ operation: { action: "set_status", id: "T1", status: "blocked" } } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live("progress operation is rejected", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ operation: { action: "progress", id: "T1", event_summary: "x" } } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live("approve operation is rejected", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ operation: { action: "approve", id: "T1" } } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live("rename with spec_ref is rejected", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(
          tool.execute({ operation: { action: "rename", id: "T1", spec_ref: "x" } } as any, ctx(sess.id)),
        )
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )
})

describe("task tool: independent lifecycle verbs", () => {
  it.live("block operation accepted", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const def = yield* info.init()
        const result = def.parameters.safeParse({ operation: { action: "block", id: "T1", event_summary: "waiting" } })
        expect(result.success).toBe(true)
      }),
    ),
  )

  it.live("unblock operation accepted", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const def = yield* info.init()
        const result = def.parameters.safeParse({ operation: { action: "unblock", id: "T1" } })
        expect(result.success).toBe(true)
      }),
    ),
  )

  it.live("done operation accepted", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const def = yield* info.init()
        const result = def.parameters.safeParse({ operation: { action: "done", id: "T1", event_summary: "complete" } })
        expect(result.success).toBe(true)
      }),
    ),
  )

  it.live("abandon operation accepted", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const def = yield* info.init()
        const result = def.parameters.safeParse({ operation: { action: "abandon", id: "T1" } })
        expect(result.success).toBe(true)
      }),
    ),
  )

  it.live("block with invalid status field is rejected (strict)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const def = yield* info.init()
        const result = def.parameters.safeParse({ operation: { action: "block", id: "T1", status: "in_progress" } })
        expect(result.success).toBe(false)
      }),
    ),
  )

  it.live("shell-wrapped task create does not crash and renders operation=create", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sess = yield* session.create({ title: "Test" })
        const info = yield* TaskTool
        const def = yield* info.init()
        const wrapped = shellWrap({ ...def, id: info.id })
        const result = yield* wrapped.execute({ script: 'task create "x"' }, ctx(sess.id) as any)
        // Regression: nested discriminator { operation: { action } } used to crash
        // shell-wrap with "H.replace is not a function". The XML attribute must
        // reflect the action verb, not "[object Object]".
        expect(result.output).toContain('operation="create"')
        expect(result.output).not.toContain("[object Object]")
        expect(result.metadata.success).toBe(1)
      }),
    ),
  )
})
