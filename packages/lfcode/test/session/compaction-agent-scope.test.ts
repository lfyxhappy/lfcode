import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import * as Compaction from "../../src/session/compaction"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Log } from "../../src/util"

const root = path.join(__dirname, "../..")
void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((s) => s.create(input)))
  },
  remove(id: SessionID) {
    return run(SessionNs.Service.use((s) => s.remove(id)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((s) => s.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((s) => s.updatePart(part)))
  },
}

async function addUser(sessionID: SessionID, text: string, agentID?: string) {
  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    agentID,
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  await svc.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: id,
    type: "text",
    text,
  })
  return id
}

async function completeCompaction(sessionID: SessionID, agentID: string) {
  const messages = await run(SessionNs.Service.use((session) => session.messages({ sessionID, agentID })))
  const boundary = messages.findLast((message) => message.parts.some((part) => part.type === "compaction"))
  if (!boundary) throw new Error("Expected a compaction boundary")

  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "assistant",
    parentID: boundary.info.id,
    time: { created: Date.now() + 1 },
    agent: "compaction",
    agentID,
    mode: "compaction",
    summary: true,
    providerID: ProviderID.make("test"),
    modelID: ModelID.make("test"),
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Info)
  await svc.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: id,
    type: "text",
    synthetic: true,
    text: "summary",
  })
}

describe("compaction scope is (session_id, agent_id)", () => {
  test("create({sessionID, agentID}) inserts a compaction-boundary part tagged with that agent_id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        // Main thread: 3 messages (agent_id IS NULL)
        await addUser(session.id, "main-1")
        await addUser(session.id, "main-2")
        await addUser(session.id, "main-3")

        // Subagent "writer-1": 3 messages
        await addUser(session.id, "writer-msg-1", "writer-1")
        await addUser(session.id, "writer-msg-2", "writer-1")
        await addUser(session.id, "writer-msg-3", "writer-1")

        // Insert a compaction boundary scoped to writer-1.
        await Compaction.create({
          sessionID: session.id,
          agent: "compaction",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          auto: true,
          agentID: "writer-1",
        })
        await completeCompaction(session.id, "writer-1")

        // A boundary is only active once its summary exists. Then writer-1's
        // continuation slice begins at the synthetic marker and summary,
        // skipping the prior actor history.
        const writerMsgs = await Effect.runPromise(
          MessageV2.filterCompactedEffect(session.id, { agentID: "writer-1" }),
        )
        expect(writerMsgs).toHaveLength(2)
        expect(writerMsgs[0].info.role).toBe("user")
        expect(writerMsgs[0].info.agentID).toBe("writer-1")
        const boundaryPart = writerMsgs[0].parts.find((p) => p.type === "compaction")
        expect(boundaryPart).toBeDefined()
        expect((boundaryPart as MessageV2.CompactionPart).auto).toBe(true)

        // Main agent's view (agent_id IS NULL) is untouched: still 3 messages,
        // no compaction boundary.
        const mainMsgs = await Effect.runPromise(
          MessageV2.filterCompactedEffect(session.id, { agentID: "main" }),
        )
        expect(mainMsgs).toHaveLength(3)
        expect(mainMsgs.map((m) => (m.parts[0] as MessageV2.TextPart).text)).toEqual([
          "main-1",
          "main-2",
          "main-3",
        ])
        for (const m of mainMsgs) {
          expect(m.info.agentID).toBe("main")
          expect(m.parts.some((p) => p.type === "compaction")).toBe(false)
        }

        await svc.remove(session.id)
      },
    })
  })

  test("compacting writer-1 leaves writer-2's history untouched", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        await addUser(session.id, "writer-1-a", "writer-1")
        await addUser(session.id, "writer-1-b", "writer-1")
        await addUser(session.id, "writer-2-a", "writer-2")
        await addUser(session.id, "writer-2-b", "writer-2")

        await Compaction.create({
          sessionID: session.id,
          agent: "compaction",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          auto: true,
          agentID: "writer-1",
        })
        await completeCompaction(session.id, "writer-1")

        // writer-2 unchanged: 2 messages, no boundary.
        const w2Msgs = await Effect.runPromise(
          MessageV2.filterCompactedEffect(session.id, { agentID: "writer-2" }),
        )
        expect(w2Msgs).toHaveLength(2)
        expect(w2Msgs.map((m) => (m.parts[0] as MessageV2.TextPart).text)).toEqual([
          "writer-2-a",
          "writer-2-b",
        ])
        for (const m of w2Msgs) {
          expect(m.parts.some((p) => p.type === "compaction")).toBe(false)
        }

        // writer-1 is compacted: its valid slice starts at the boundary and
        // includes its generated summary.
        const w1Msgs = await Effect.runPromise(
          MessageV2.filterCompactedEffect(session.id, { agentID: "writer-1" }),
        )
        expect(w1Msgs).toHaveLength(2)
        expect(w1Msgs[0].parts.some((p) => p.type === "compaction")).toBe(true)
        expect(w1Msgs[0].info.agentID).toBe("writer-1")

        await svc.remove(session.id)
      },
    })
  })
})

describe("overflow replay selection", () => {
  test("selects the previous real user turn exactly once and excludes the boundary", () => {
    const previous = { id: "u-prev", sessionID: "session", role: "user", time: { created: 1 } } as MessageV2.User
    const failed = {
      id: "a-failed",
      sessionID: "session",
      role: "assistant",
      parentID: "u-prev",
      time: { created: 2 },
    } as MessageV2.Assistant
    const boundary = { id: "u-boundary", sessionID: "session", role: "user", time: { created: 3 } } as MessageV2.User
    const history = [
      {
        info: { id: "u-old", sessionID: "session", role: "user", time: { created: 0 } } as MessageV2.User,
        parts: [{ id: "p-old", sessionID: "session", messageID: "u-old", type: "text", text: "older" }],
      },
      {
        info: previous,
        parts: [{ id: "p-prev", sessionID: "session", messageID: "u-prev", type: "text", text: "replay me once" }],
      },
      { info: failed, parts: [] },
      {
        info: boundary,
        parts: [{ id: "p-boundary", sessionID: "session", messageID: "u-boundary", type: "compaction", auto: true }],
      },
    ] as MessageV2.WithParts[]

    const selected = Compaction.selectOverflowReplay(history, MessageID.make("u-boundary"))

    expect(selected.history.map((message) => message.info.id)).toEqual([MessageID.make("u-old")])
    expect(selected.replay?.info.id).toBe(MessageID.make("u-prev"))
    expect(selected.replay?.parts).toHaveLength(1)
    expect(selected.replay?.parts[0]).toMatchObject({ type: "text", text: "replay me once" })
  })

  test("does not replay when dropping the candidate would leave no summary source", () => {
    const history = [
      {
        info: { id: "u-only", sessionID: "session", role: "user", time: { created: 0 } } as MessageV2.User,
        parts: [{ id: "p-only", sessionID: "session", messageID: "u-only", type: "text", text: "only turn" }],
      },
      {
        info: { id: "u-boundary", sessionID: "session", role: "user", time: { created: 1 } } as MessageV2.User,
        parts: [{ id: "p-boundary", sessionID: "session", messageID: "u-boundary", type: "compaction", auto: true }],
      },
    ] as MessageV2.WithParts[]

    const selected = Compaction.selectOverflowReplay(history, MessageID.make("u-boundary"))

    expect(selected.history).toBe(history)
    expect(selected.replay).toBeUndefined()
  })
})
