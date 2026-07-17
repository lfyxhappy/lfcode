import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "../../src/storage"
import { HistoryFtsTable } from "../../src/history/fts.sql"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { HistoryTool } from "../../src/tool/history"
import { History } from "../../src/history"
import { Truncate } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { SessionID, MessageID } from "../../src/session/schema"
import { CapabilityPersistence } from "../../src/capability/persistence"

afterEach(async () => {
  Database.use((db) => {
    db.delete(HistoryFtsTable).run()
    db.delete(PartTable).run()
    db.delete(MessageTable).run()
    db.delete(SessionTable).run()
    db.delete(ProjectTable).run()
  })
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(History.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("HistoryTool", () => {
  it.live("operation=search returns markdown with hits", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        Database.use((db) => {
          db.insert(HistoryFtsTable)
            .values({
              part_id: "p1",
              session_id: "ses_a",
              message_id: "msg_a",
              project_id: "proj_a",
              kind: "user_text",
              tool_name: null,
              body: "JWT signing test",
              time_created: 1000,
            })
            .run()
        })
        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: "search", query: "JWT", scope: "global", reason: "Read cross-project JWT history" },
          ctx as any,
        )
        expect(result.output).toContain("msg_a")
        expect(result.output).toContain("JWT")
        expect(result.metadata.count).toBe(1)
      }),
    ),
  )

  it.live("operation=search with no hits returns empty message", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: "search", query: "nothing", scope: "global" },
          ctx as any,
        )
        expect(result.metadata.count).toBe(0)
        expect(result.output).toContain("0 matches")
      }),
    ),
  )

  it.live("operation=around returns marked anchor message", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const now = Date.now()
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({ id: "p" as any, worktree: "/tmp", sandboxes: [] as any, time_created: now, time_updated: now } as any)
            .run()
          db.insert(SessionTable)
            .values({
              id: "ses_z" as any,
              project_id: "p" as any,
              slug: "x",
              directory: "/tmp",
              title: "t",
              version: "1",
              time_created: now,
              time_updated: now,
            })
            .run()
          for (let i = 0; i < 3; i++) {
            db.insert(MessageTable)
              .values({
                id: `m${i}` as any,
                session_id: "ses_z" as any,
                agent_id: "main",
                data: { role: "user" } as any,
                time_created: now + i,
                time_updated: now + i,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: `pt${i}` as any,
                message_id: `m${i}` as any,
                session_id: "ses_z" as any,
                data: { type: "text", text: `body ${i}` } as any,
                time_created: now + i,
                time_updated: now + i,
              })
              .run()
          }
        })
        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: "around", message_id: "m1", before: 1, after: 1 },
          ctx as any,
        )
        expect(result.output).toContain(">>> m1")
        expect(result.output).toContain("m0")
        expect(result.output).toContain("m2")
      }),
    ),
  )

  it.live("operation=session returns raw history and boundary flags", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const now = Date.now()
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({ id: "p" as any, worktree: "/tmp", sandboxes: [] as any, time_created: now, time_updated: now } as any)
            .run()
          db.insert(SessionTable)
            .values({
              id: "ses_hist" as any,
              project_id: "p" as any,
              slug: "x",
              directory: "/tmp",
              title: "t",
              version: "1",
              last_checkpoint_message_id: "m1" as any,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(MessageTable)
            .values({
              id: "m1" as any,
              session_id: "ses_hist" as any,
              agent_id: "main",
              data: { role: "user" } as any,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "p0" as any,
              message_id: "m1" as any,
              session_id: "ses_hist" as any,
              data: {
                type: "checkpoint",
                checkpointDir: "/tmp/checkpoints",
                checkpointNumber: 1,
                coveredUpTo: "m0",
              } as any,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "p1" as any,
              message_id: "m1" as any,
              session_id: "ses_hist" as any,
              data: { type: "text", text: "checkpoint body" } as any,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(MessageTable)
            .values({
              id: "m2" as any,
              session_id: "ses_hist" as any,
              agent_id: "main",
              data: { role: "assistant" } as any,
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "p2" as any,
              message_id: "m2" as any,
              session_id: "ses_hist" as any,
              data: { type: "text", text: "assistant reply" } as any,
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })
        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: "session", session_id: "ses_hist", include_boundaries: false },
          ctx as any,
        )
        expect(result.metadata.session_found).toBe(true)
        expect(result.metadata.checkpoint_found).toBe(true)
        expect(result.metadata.count).toBe(1)
        const audit = CapabilityPersistence.listAudit({ capability: "context_read" }).find(
          (item) => item.reason === "Read cross-project JWT history",
        )
        expect(audit?.rollback).toMatchObject({ projects: ["proj_a"], sessions: ["ses_a"], messages: ["msg_a"] })
        expect(result.output).toContain("ses_hist")
        expect(result.output).toContain("assistant reply")
        expect(result.output).not.toContain("checkpoint body")
        expect(result.output).not.toContain("checkpointDir")
      }),
    ),
  )

  it.live("operation=session reports missing sessions cleanly", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: "session", session_id: "missing" }, ctx as any)
        expect(result.metadata.session_found).toBe(false)
        expect(result.metadata.checkpoint_found).toBe(false)
        expect(result.output).toContain("No session with id missing")
      }),
    ),
  )

  it.live("operation=session returns raw history even when no checkpoint exists", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const now = Date.now()
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({ id: "p2" as any, worktree: "/tmp", sandboxes: [] as any, time_created: now, time_updated: now } as any)
            .run()
          db.insert(SessionTable)
            .values({
              id: "ses_raw" as any,
              project_id: "p2" as any,
              slug: "x",
              directory: "/tmp",
              title: "t",
              version: "1",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(MessageTable)
            .values({
              id: "m_raw" as any,
              session_id: "ses_raw" as any,
              agent_id: "main",
              data: { role: "user" } as any,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "p_raw" as any,
              message_id: "m_raw" as any,
              session_id: "ses_raw" as any,
              data: { type: "text", text: "plain raw history" } as any,
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: "session", session_id: "ses_raw" }, ctx as any)
        expect(result.metadata.session_found).toBe(true)
        expect(result.metadata.checkpoint_found).toBe(false)
        expect(result.output).toContain("plain raw history")
      }),
    ),
  )
})
