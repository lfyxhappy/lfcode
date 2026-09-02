import { describe, expect, test } from "bun:test"
import type { Message, Part, PermissionRequest, Project, QuestionRequest, Session } from "@lfcode-ai/sdk/v2/client"
import { isInlineImageCacheUrl, resolveInlineImageUrl } from "@lfcode-ai/ui/inline-image-cache"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { applyActivitySnapshot, applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./event-reducer"

const rootSession = (input: { id: string; parentID?: string; archived?: number }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    time: {
      created: 1,
      updated: 1,
      archived: input.archived,
    },
  }) as Session

const userMessage = (id: string, sessionID: string, agentID?: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "assistant",
    agentID,
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const textPart = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "text",
    text: id,
  }) as Part

const imagePart = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "file",
    mime: "image/png",
    filename: "image.png",
    url: "data:image/png;base64," + "A".repeat(400_000),
  }) as Part

const toolPart = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "tool",
    callID: "call_1",
    tool: "read",
    state: {
      status: "completed",
      input: {},
      output: "Image read successfully",
      title: "Read image",
      metadata: {},
      time: {
        start: 1,
        end: 2,
      },
      attachments: [imagePart("prt_tool_img", sessionID, messageID)],
    },
  }) as Part

const permissionRequest = (id: string, sessionID: string, title = id) =>
  ({
    id,
    sessionID,
    permission: title,
    patterns: ["*"],
    metadata: {},
    always: [],
  }) as PermissionRequest

const questionRequest = (id: string, sessionID: string, title = id) =>
  ({
    id,
    sessionID,
    questions: [
      {
        question: title,
        header: title,
        options: [{ label: title, description: title }],
      },
    ],
  }) as QuestionRequest

const baseState = (input: Partial<State> = {}) =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider: {} as State["provider"],
    config: {} as State["config"],
    path: { directory: "/tmp" } as State["path"],
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_goal: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    vcs: undefined,
    limit: 10,
    message: {},
    messageByAgent: {},
    actor: {},
    part: {},
    ...input,
  }) as State

describe("applyGlobalEvent", () => {
  test("upserts project.updated in sorted position", () => {
    const project = [{ id: "a" }, { id: "c" }] as Project[]
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "project.updated", properties: { id: "b" } },
      project,
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject(next) {
        if (typeof next === "function") next(project)
      },
    })

    expect(project.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(refreshCount).toBe(0)
  })

  test("handles global.disposed by triggering refresh", () => {
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "global.disposed" },
      project: [],
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject() {},
    })

    expect(refreshCount).toBe(1)
  })

  test("ignores server.connected without triggering refresh", () => {
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "server.connected" },
      project: [],
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject() {},
    })

    expect(refreshCount).toBe(0)
  })
})

describe("applyDirectoryEvent", () => {
  test("reconciles an activity snapshot while preserving a newer in-flight event", () => {
    const [store, setStore] = createStore(
      baseState({
        activity: {
          ses_1: [
            {
              id: "act_1",
              sessionID: "ses_1",
              kind: "main",
              status: "running",
              revision: 3,
              createdAt: 1,
              updatedAt: 30,
            },
            {
              id: "act_2",
              sessionID: "ses_1",
              kind: "background",
              status: "running",
              revision: 1,
              createdAt: 2,
              updatedAt: 2,
            },
            {
              id: "act_3",
              sessionID: "ses_1",
              kind: "subagent",
              status: "queued",
              revision: 1,
              createdAt: 3,
              updatedAt: 3,
            },
          ],
        },
      }),
    )

    applyActivitySnapshot({
      sessionID: "ses_1",
      activities: [
        {
          id: "act_1",
          sessionID: "ses_1",
          kind: "main",
          status: "queued",
          revision: 2,
          time: { created: 1, updated: 20 },
        },
      ],
      store,
      setStore,
      revisionsBeforeRequest: new Map([
        ["act_1", 2],
        ["act_2", 1],
      ]),
    })

    expect(store.activity?.ses_1).toHaveLength(2)
    expect(store.activity?.ses_1?.find((item) => item.id === "act_1")?.revision).toBe(3)
    expect(store.activity?.ses_1?.find((item) => item.id === "act_2")).toBeUndefined()
    expect(store.activity?.ses_1?.find((item) => item.id === "act_3")).toBeDefined()
  })

  test("inserts root sessions in sorted order and updates sessionTotal", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "b" })],
        sessionTotal: 1,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "a" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["a", "b"])
    expect(store.sessionTotal).toBe(2)

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "c", parentID: "a" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.sessionTotal).toBe(2)
  })

  test("cleans session caches when archived", () => {
    const message = userMessage("msg_1", "ses_1")
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" }), rootSession({ id: "ses_2" })],
        sessionTotal: 2,
        message: { ses_1: [message] },
        part: { [message.id]: [textPart("prt_1", "ses_1", message.id)] },
        session_diff: { ses_1: [] },
        todo: { ses_1: [] },
        permission: { ses_1: [] },
        question: { ses_1: [] },
        session_status: { ses_1: { type: "busy" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_2"])
    expect(store.sessionTotal).toBe(1)
    expect(store.message.ses_1).toBeUndefined()
    expect(store.part[message.id]).toBeUndefined()
    expect(store.session_diff.ses_1).toBeUndefined()
    expect(store.todo.ses_1).toBeUndefined()
    expect(store.permission.ses_1).toBeUndefined()
    expect(store.question.ses_1).toBeUndefined()
    expect(store.session_status.ses_1).toBeUndefined()
  })

  test("cleans session caches when deleted and decrements only root totals", () => {
    const cases = [
      { info: rootSession({ id: "ses_1" }), expectedTotal: 1 },
      { info: rootSession({ id: "ses_2", parentID: "ses_1" }), expectedTotal: 2 },
    ]

    for (const item of cases) {
      const message = userMessage("msg_1", item.info.id)
      const [store, setStore] = createStore(
        baseState({
          session: [
            rootSession({ id: "ses_1" }),
            rootSession({ id: "ses_2", parentID: "ses_1" }),
            rootSession({ id: "ses_3" }),
          ],
          sessionTotal: 2,
          message: { [item.info.id]: [message] },
          part: { [message.id]: [textPart("prt_1", item.info.id, message.id)] },
          session_diff: { [item.info.id]: [] },
          todo: { [item.info.id]: [] },
          permission: { [item.info.id]: [] },
          question: { [item.info.id]: [] },
          session_status: { [item.info.id]: { type: "busy" } },
        }),
      )

      applyDirectoryEvent({
        event: { type: "session.deleted", properties: { info: item.info } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

      expect(store.session.find((x) => x.id === item.info.id)).toBeUndefined()
      expect(store.sessionTotal).toBe(item.expectedTotal)
      expect(store.message[item.info.id]).toBeUndefined()
      expect(store.part[message.id]).toBeUndefined()
      expect(store.session_diff[item.info.id]).toBeUndefined()
      expect(store.todo[item.info.id]).toBeUndefined()
      expect(store.permission[item.info.id]).toBeUndefined()
      expect(store.question[item.info.id]).toBeUndefined()
      expect(store.session_status[item.info.id]).toBeUndefined()
    }
  })

  test("cleans caches for trimmed sessions on session.created", () => {
    const dropped = rootSession({ id: "ses_b" })
    const kept = rootSession({ id: "ses_a" })
    const message = userMessage("msg_1", dropped.id)
    const todos: string[] = []
    const [store, setStore] = createStore(
      baseState({
        limit: 1,
        session: [dropped],
        message: { [dropped.id]: [message] },
        part: { [message.id]: [textPart("prt_1", dropped.id, message.id)] },
        session_diff: { [dropped.id]: [] },
        todo: { [dropped.id]: [] },
        permission: { [dropped.id]: [] },
        question: { [dropped.id]: [] },
        session_status: { [dropped.id]: { type: "busy" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: kept } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      setSessionTodo(sessionID, value) {
        if (value !== undefined) return
        todos.push(sessionID)
      },
    })

    expect(store.session.map((x) => x.id)).toEqual([kept.id])
    expect(store.message[dropped.id]).toBeUndefined()
    expect(store.part[message.id]).toBeUndefined()
    expect(store.session_diff[dropped.id]).toBeUndefined()
    expect(store.todo[dropped.id]).toBeUndefined()
    expect(store.permission[dropped.id]).toBeUndefined()
    expect(store.question[dropped.id]).toBeUndefined()
    expect(store.session_status[dropped.id]).toBeUndefined()
    expect(todos).toEqual([dropped.id])
  })

  test("cleanupDroppedSessionCaches clears part-only orphan state", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_keep" })],
        part: { msg_1: [textPart("prt_1", "ses_drop", "msg_1")] },
      }),
    )

    cleanupDroppedSessionCaches(store, setStore, store.session)

    expect(store.part.msg_1).toBeUndefined()
  })

  test("stores session.goal state and verdicts from goal events", () => {
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: {
        type: "session.goal",
        properties: {
          sessionID: "ses_1",
          goal: {
            status: "paused",
            objective: "Ship release",
            condition: "Ship release",
            stats: {
              elapsed: 120_000,
              tokens: {
                input: 12,
                output: 8,
                reasoning: 3,
                cache: { read: 5, write: 1 },
              },
            },
            time: { created: 1, updated: 2 },
          },
          lastVerdict: {
            ok: false,
            reason: "installer still missing",
            attempt: 2,
            messageID: "msg_goal_1",
          },
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session_goal.ses_1?.state?.status).toBe("paused")
    expect(store.session_goal.ses_1?.state?.stats?.tokens?.input).toBe(12)
    expect(store.session_goal.ses_1?.lastMessageID).toBe("msg_goal_1")
    expect(store.session_goal.ses_1?.verdicts.msg_goal_1?.reason).toBe("installer still missing")
  })

  test("upserts and removes messages while clearing orphaned parts", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        message: { [sessionID]: [userMessage("msg_1", sessionID), userMessage("msg_3", sessionID)] },
        part: { msg_2: [textPart("prt_1", sessionID, "msg_2")] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "message.updated", properties: { info: userMessage("msg_2", sessionID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2", "msg_3"])

    applyDirectoryEvent({
      event: {
        type: "message.updated",
        properties: {
          info: {
            ...userMessage("msg_2", sessionID),
            role: "assistant",
          } as Message,
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.find((x) => x.id === "msg_2")?.role).toBe("assistant")

    applyDirectoryEvent({
      event: { type: "message.removed", properties: { sessionID, messageID: "msg_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_3"])
    expect(store.part.msg_2).toBeUndefined()
  })

  test("removes actor caches and message slices on actor.removed", () => {
    const sessionID = "ses_actors"
    const childA = userMessage("msg_child_a", sessionID, "child-1")
    const childB = userMessage("msg_child_b", sessionID, "child-1")
    const other = userMessage("msg_other", sessionID, "child-2")
    const main = userMessage("msg_main", sessionID)
    const [store, setStore] = createStore(
      baseState({
        actor: {
          [sessionID]: [
            {
              actorID: "child-1",
              sessionID,
              mode: "subagent",
              status: "idle",
              description: "child 1",
              time: { created: 1 },
            },
            {
              actorID: "child-2",
              sessionID,
              mode: "subagent",
              status: "idle",
              description: "child 2",
              time: { created: 1 },
            },
          ],
        },
        message: { [sessionID]: [main, childA, childB, other] },
        messageByAgent: {
          [sessionID]: {
            main: [main],
            "child-1": [childA, childB],
            "child-2": [other],
          },
        },
        part: {
          [childA.id]: [textPart("prt_child_a", sessionID, childA.id)],
          [childB.id]: [textPart("prt_child_b", sessionID, childB.id)],
          [other.id]: [textPart("prt_other", sessionID, other.id)],
        },
      }),
    )

    applyDirectoryEvent({
      event: { type: "actor.removed", properties: { sessionID, actorID: "child-1" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.actor[sessionID]?.map((item) => item.actorID)).toEqual(["child-2"])
    expect(store.message[sessionID]?.map((item) => item.id)).toEqual(["msg_main", "msg_other"])
    expect(store.messageByAgent[sessionID]?.["child-1"]).toBeUndefined()
    expect(store.messageByAgent[sessionID]?.["child-2"]?.map((item) => item.id)).toEqual(["msg_other"])
    expect(store.part[childA.id]).toBeUndefined()
    expect(store.part[childB.id]).toBeUndefined()
    expect(store.part[other.id]?.map((item) => item.id)).toEqual(["prt_other"])
  })

  test("adds visible actors and applies live status updates", () => {
    const sessionID = "ses_actors"
    const [store, setStore] = createStore(baseState())
    const input = {
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    }

    applyDirectoryEvent({
      ...input,
      event: {
        type: "actor.registered",
        properties: {
          sessionID,
          actorID: "child-1",
          mode: "subagent",
          description: "研究员：检查认证",
          agent: "explore",
          visible: true,
        },
      },
    })
    applyDirectoryEvent({
      ...input,
      event: { type: "actor.status", properties: { sessionID, actorID: "child-1", status: "running" } },
    })
    applyDirectoryEvent({
      ...input,
      event: {
        type: "actor.registered",
        properties: {
          sessionID,
          actorID: "checkpoint-writer-1",
          mode: "subagent",
          description: "internal",
          visible: false,
        },
      },
    })

    expect(store.actor[sessionID]).toEqual([
      expect.objectContaining({ actorID: "child-1", description: "研究员：检查认证", status: "running" }),
    ])
  })

  test("upserts and prunes message parts", () => {
    const sessionID = "ses_1"
    const messageID = "msg_1"
    const [store, setStore] = createStore(
      baseState({
        part: { [messageID]: [textPart("prt_1", sessionID, messageID), textPart("prt_3", sessionID, messageID)] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "message.part.updated", properties: { part: textPart("prt_2", sessionID, messageID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.part[messageID]?.map((x) => x.id)).toEqual(["prt_1", "prt_2", "prt_3"])

    applyDirectoryEvent({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            ...textPart("prt_2", sessionID, messageID),
            text: "changed",
          } as Part,
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    const updated = store.part[messageID]?.find((x) => x.id === "prt_2")
    expect(updated?.type).toBe("text")
    if (updated?.type === "text") expect(updated.text).toBe("changed")

    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_1" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_3" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part[messageID]).toBeUndefined()
  })

  test("stashes oversized inline image parts on update and clears them on removal", () => {
    const sessionID = "ses_1"
    const messageID = "msg_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: { type: "message.part.updated", properties: { part: imagePart("prt_img", sessionID, messageID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const stored = store.part[messageID]?.[0]
    expect(stored?.type).toBe("file")
    if (stored?.type === "file") {
      expect(isInlineImageCacheUrl(stored.url)).toBe(true)
      expect(resolveInlineImageUrl(stored)).toContain("data:image/png;base64,")
    }

    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_img" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part[messageID]).toBeUndefined()
    if (stored?.type === "file") {
      expect(resolveInlineImageUrl(stored)).toBeUndefined()
    }
  })

  test("stashes oversized tool attachments on update and clears them on message removal", () => {
    const sessionID = "ses_1"
    const messageID = "msg_1"
    const [store, setStore] = createStore(baseState({ message: { [sessionID]: [userMessage(messageID, sessionID)] } }))

    applyDirectoryEvent({
      event: { type: "message.part.updated", properties: { part: toolPart("prt_tool", sessionID, messageID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const stored = store.part[messageID]?.[0]
    expect(stored?.type).toBe("tool")
    if (stored?.type === "tool" && stored.state.status === "completed") {
      const attachment = stored.state.attachments?.[0]
      expect(attachment).toBeDefined()
      expect(isInlineImageCacheUrl(attachment!.url)).toBe(true)
      expect(resolveInlineImageUrl(attachment!)).toContain("data:image/png;base64,")
    }

    applyDirectoryEvent({
      event: { type: "message.removed", properties: { sessionID, messageID } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part[messageID]).toBeUndefined()
    if (stored?.type === "tool" && stored.state.status === "completed") {
      expect(resolveInlineImageUrl(stored.state.attachments?.[0]!)).toBeUndefined()
    }
  })

  test("tracks permission and question request lifecycles", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        permission: { [sessionID]: [permissionRequest("perm_1", sessionID), permissionRequest("perm_3", sessionID)] },
        question: { [sessionID]: [questionRequest("q_1", sessionID), questionRequest("q_3", sessionID)] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_2", sessionID) },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.map((x) => x.id)).toEqual(["perm_1", "perm_2", "perm_3"])

    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_2", sessionID, "updated") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.find((x) => x.id === "perm_2")?.permission).toBe("updated")

    applyDirectoryEvent({
      event: { type: "permission.replied", properties: { sessionID, requestID: "perm_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.map((x) => x.id)).toEqual(["perm_1", "perm_3"])

    applyDirectoryEvent({
      event: { type: "question.asked", properties: questionRequest("q_2", sessionID) },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.map((x) => x.id)).toEqual(["q_1", "q_2", "q_3"])

    applyDirectoryEvent({
      event: { type: "question.asked", properties: questionRequest("q_2", sessionID, "updated") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.find((x) => x.id === "q_2")?.questions[0]?.header).toBe("updated")

    applyDirectoryEvent({
      event: { type: "question.rejected", properties: { sessionID, requestID: "q_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.map((x) => x.id)).toEqual(["q_1", "q_3"])
  })

  test("updates vcs branch in store and cache", () => {
    const [store, setStore] = createStore(baseState({ vcs: { branch: "main", default_branch: "main" } }))
    const [cacheStore, setCacheStore] = createStore({
      value: { branch: "main", default_branch: "main" } as State["vcs"],
    })

    applyDirectoryEvent({
      event: { type: "vcs.branch.updated", properties: { branch: "feature/test" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      vcsCache: {
        store: cacheStore,
        setStore: setCacheStore,
        ready: () => true,
      },
    })

    expect(store.vcs).toEqual({ branch: "feature/test", default_branch: "main" })
    expect(cacheStore.value).toEqual({ branch: "feature/test", default_branch: "main" })
  })

  test("routes disposal and lsp events to side-effect handlers", () => {
    const [store, setStore] = createStore(baseState())
    const pushes: string[] = []
    let lspLoads = 0

    applyDirectoryEvent({
      event: { type: "server.instance.disposed" },
      store,
      setStore,
      push(directory) {
        pushes.push(directory)
      },
      directory: "/tmp",
      loadLsp() {
        lspLoads += 1
      },
    })

    applyDirectoryEvent({
      event: { type: "lsp.updated" },
      store,
      setStore,
      push(directory) {
        pushes.push(directory)
      },
      directory: "/tmp",
      loadLsp() {
        lspLoads += 1
      },
    })

    expect(pushes).toEqual(["/tmp"])
    expect(lspLoads).toBe(1)
  })

  test("keeps a compact, deduplicated Hook activity feed per session", () => {
    const [store, setStore] = createStore(baseState())
    const apply = (timeCreated: number, summary: string) =>
      applyDirectoryEvent({
        event: {
          type: "hook.run.completed",
          properties: {
            sessionID: "ses_1",
            hookID: "hook_1",
            hookName: "Guard",
            event: "PreToolUse",
            status: "completed",
            durationMs: 12,
            summary,
            timeCreated,
          },
        },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    apply(1, "first")
    apply(1, "updated")
    for (let index = 2; index <= 8; index++) apply(index, String(index))

    expect(store.hook_run?.ses_1).toHaveLength(6)
    expect(store.hook_run?.ses_1?.[0]?.summary).toBe("8")
    expect(store.hook_run?.ses_1?.at(-1)?.summary).toBe("3")
    expect(store.activity?.ses_1).toHaveLength(8)
    expect(store.activity?.ses_1?.[0]?.kind).toBe("hook")
  })

  test("upserts and removes generic session activity without requiring a backend type", () => {
    const [store, setStore] = createStore(baseState())
    const apply = (type: string, properties: unknown) =>
      applyDirectoryEvent({
        event: { type, properties },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    apply("activity.created", {
      sessionID: "ses_1",
      activity: { id: "act_1", kind: "background-job", status: "running", createdAt: 10 },
    })
    apply("activity.updated", {
      sessionID: "ses_1",
      activity: { id: "act_1", kind: "background-job", status: "completed", createdAt: 10, updatedAt: 20 },
    })

    expect(store.activity?.ses_1).toEqual([
      { id: "act_1", sessionID: "ses_1", kind: "background-job", status: "completed", createdAt: 10, updatedAt: 20 },
    ])

    apply("activity.removed", { sessionID: "ses_1", activityID: "act_1" })
    expect(store.activity?.ses_1).toEqual([])
  })

  test("accepts the durable activity event envelope and nested time fields", () => {
    const [store, setStore] = createStore(baseState())
    applyDirectoryEvent({
      event: {
        type: "activity.completed",
        properties: {
          activity: {
            id: "act_2",
            sessionID: "ses_1",
            kind: "subagent",
            status: "completed",
            sourceType: "actor",
            sourceID: "actor_1",
            revision: 2,
            metadata: { dispatch: { id: "dispatch-2", agent: "reviewer", description: "Review" } },
            time: { created: 100, updated: 120 },
          },
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.activity?.ses_1?.[0]).toMatchObject({
      id: "act_2",
      kind: "subagent",
      status: "completed",
      createdAt: 100,
      updatedAt: 120,
      metadata: { dispatch: { id: "dispatch-2", agent: "reviewer", description: "Review" } },
    })
  })
})
