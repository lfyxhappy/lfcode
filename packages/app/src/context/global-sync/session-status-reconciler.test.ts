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
  const callbacks = new Map<number, () => void>()
  return {
    api: {
      set(fn: () => void, _ms: number) {
        const id = ++nextID
        callbacks.set(id, fn)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clear(id: ReturnType<typeof setTimeout>) {
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
})
