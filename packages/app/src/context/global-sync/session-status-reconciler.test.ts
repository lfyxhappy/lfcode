import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { SessionStatus } from "@lfcode-ai/sdk/v2/client"
import { createSessionStatusReconciler } from "./session-status-reconciler"
import type { State } from "./types"

const directory = "C:/repo/project"

const baseState = (status: Record<string, SessionStatus>) =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: false,
    command_ready: false,
    permission_ready: false,
    permission_error: false,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: directory, directory, home: "" },
    session: [],
    sessionTotal: 0,
    session_status: status,
    session_goal: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: false,
    mcp: {},
    lsp_ready: false,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    messageByAgent: {},
    actor: {},
    part: {},
  }) as State

function createTimers() {
  let nextID = 0
  let scheduled = 0
  let cleared = 0
  const callbacks = new Map<number, () => void>()
  return {
    api: {
      set(fn: () => void, _ms: number) {
        const id = ++nextID
        scheduled += 1
        callbacks.set(id, fn)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clear(id: ReturnType<typeof setTimeout>) {
        cleared += 1
        callbacks.delete(id as unknown as number)
      },
    },
    async flushAll() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const fn of pending) fn()
      await Promise.resolve()
      await Promise.resolve()
    },
    size() {
      return callbacks.size
    },
    scheduled() {
      return scheduled
    },
    cleared() {
      return cleared
    },
  }
}

describe("session status reconciler", () => {
  test("clears stale busy when session.status snapshot no longer contains the session", async () => {
    const [store, setStore] = createStore(baseState({ ses_1: { type: "busy" } }))
    const timers = createTimers()
    let calls = 0
    const reconciler = createSessionStatusReconciler({
      delayMs: 1,
      timers: timers.api,
      getStore: () => [store, setStore],
      getClient: () =>
        ({
          session: {
            status: async () => {
              calls += 1
              return { data: {} }
            },
          },
        }) as any,
    })

    reconciler.refresh(directory)
    expect(timers.size()).toBe(1)

    await timers.flushAll()

    expect(calls).toBe(1)
    expect(store.session_status.ses_1).toEqual({ type: "idle" })
    expect(timers.size()).toBe(0)
  })

  test("keeps polling while snapshot still reports busy", async () => {
    const [store, setStore] = createStore(baseState({ ses_1: { type: "busy" } }))
    const timers = createTimers()
    let calls = 0
    const reconciler = createSessionStatusReconciler({
      delayMs: 1,
      timers: timers.api,
      getStore: () => [store, setStore],
      getClient: () =>
        ({
          session: {
            status: async () => {
              calls += 1
              return { data: { ses_1: { type: "busy" } } }
            },
          },
        }) as any,
    })

    reconciler.markBusy(directory, "ses_1")
    await timers.flushAll()

    expect(calls).toBe(1)
    expect(store.session_status.ses_1).toEqual({ type: "busy" })
    expect(timers.size()).toBe(1)

    reconciler.stop(directory, "ses_1")
    expect(timers.size()).toBe(0)
  })

  test("keeps the stop state while stream activity arrives after a stale idle snapshot", async () => {
    const [store, setStore] = createStore(baseState({ ses_1: { type: "busy" } }))
    const timers = createTimers()
    let now = 0
    const reconciler = createSessionStatusReconciler({
      delayMs: 1,
      activityWindowMs: 4000,
      now: () => now,
      timers: timers.api,
      getStore: () => [store, setStore],
      getClient: () =>
        ({
          session: {
            status: async () => ({ data: {} }),
          },
        }) as any,
    })

    reconciler.noteActivity(directory, "ses_1")
    await timers.flushAll()

    expect(store.session_status.ses_1).toEqual({ type: "busy" })
    expect(timers.size()).toBe(1)

    now = 4001
    await timers.flushAll()

    expect(store.session_status.ses_1).toEqual({ type: "idle" })
    expect(timers.size()).toBe(0)
  })

  test("reuses the pending status check across consecutive stream deltas", async () => {
    const [store, setStore] = createStore(baseState({ ses_1: { type: "busy" } }))
    const timers = createTimers()
    let now = 0
    let calls = 0
    const reconciler = createSessionStatusReconciler({
      delayMs: 1000,
      now: () => now,
      timers: timers.api,
      getStore: () => [store, setStore],
      getClient: () =>
        ({
          session: {
            status: async () => {
              calls += 1
              return { data: { ses_1: { type: "busy" } } }
            },
          },
        }) as any,
    })

    reconciler.noteActivity(directory, "ses_1")
    now = 100
    reconciler.noteActivity(directory, "ses_1")
    now = 200
    reconciler.noteActivity(directory, "ses_1")

    expect(timers.scheduled()).toBe(1)
    expect(timers.cleared()).toBe(0)

    await timers.flushAll()

    expect(calls).toBe(1)
    expect(timers.size()).toBe(1)
  })
})
