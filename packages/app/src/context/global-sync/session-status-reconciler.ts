import type { LfcodeClient, SessionStatus } from "@lfcode-ai/sdk/v2/client"
import type { SetStoreFunction, Store } from "solid-js/store"
import type { State } from "./types"
import { isSessionStreaming } from "@/utils/session-status"
import { normalizeWorkspacePath } from "@/utils/persist"

type TimerID = ReturnType<typeof setTimeout>

function keyFor(directory: string, sessionID: string) {
  return `${directory}\n${sessionID}`
}

function splitKey(key: string) {
  const [directory, sessionID] = key.split("\n")
  return { directory, sessionID }
}

export function createSessionStatusReconciler(input: {
  getClient: (directory: string) => LfcodeClient
  getStore: (directory: string) => [Store<State>, SetStoreFunction<State>]
  delayMs?: number
  timers?: {
    set: (fn: () => void, ms: number) => TimerID
    clear: (timer: TimerID) => void
  }
}) {
  const delayMs = input.delayMs ?? 2000
  const timers = input.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (timer) => clearTimeout(timer),
  }
  const pending = new Map<string, { timer: TimerID; token: symbol }>()

  const stop = (directory: string, sessionID?: string) => {
    directory = normalizeWorkspacePath(directory)
    if (!directory) return
    if (sessionID) {
      const key = keyFor(directory, sessionID)
      const current = pending.get(key)
      if (!current) return
      timers.clear(current.timer)
      pending.delete(key)
      return
    }
    for (const [key, current] of pending) {
      if (!key.startsWith(directory + "\n")) continue
      timers.clear(current.timer)
      pending.delete(key)
    }
  }

  const schedule = (directory: string, sessionID: string) => {
    directory = normalizeWorkspacePath(directory)
    if (!directory || !sessionID) return
    const key = keyFor(directory, sessionID)
    const current = pending.get(key)
    if (current) timers.clear(current.timer)
    const token = Symbol(key)
    const timer = timers.set(() => {
      void reconcile(directory, sessionID, token)
    }, delayMs)
    pending.set(key, { timer, token })
  }

  const reconcile = async (directory: string, sessionID: string, token: symbol) => {
    const key = keyFor(directory, sessionID)
    if (pending.get(key)?.token !== token) return
    pending.delete(key)

    const [store, setStore] = input.getStore(directory)
    if (!isSessionStreaming(store.session_status[sessionID])) return

    try {
      const snapshot = await input.getClient(directory).session.status().then((x) => x.data ?? {})
      const [latestStore] = input.getStore(directory)
      if (pending.has(key)) return
      if (!isSessionStreaming(latestStore.session_status[sessionID])) return
      const next = snapshot[sessionID] as SessionStatus | undefined
      if (!isSessionStreaming(next)) {
        setStore("session_status", sessionID, next ?? { type: "idle" })
        return
      }
      setStore("session_status", sessionID, next)
      schedule(directory, sessionID)
    } catch {
      const [latestStore] = input.getStore(directory)
      if (!isSessionStreaming(latestStore.session_status[sessionID])) return
      schedule(directory, sessionID)
    }
  }

  const refresh = (directory: string, sessionID?: string) => {
    directory = normalizeWorkspacePath(directory)
    if (!directory) return
    if (sessionID) {
      const [store] = input.getStore(directory)
      if (!isSessionStreaming(store.session_status[sessionID])) {
        stop(directory, sessionID)
        return
      }
      schedule(directory, sessionID)
      return
    }

    const [store] = input.getStore(directory)
    const active = new Set<string>()
    for (const [id, status] of Object.entries(store.session_status)) {
      if (!isSessionStreaming(status)) continue
      active.add(id)
      schedule(directory, id)
    }
    for (const key of [...pending.keys()]) {
      const item = splitKey(key)
      if (item.directory !== directory) continue
      if (active.has(item.sessionID)) continue
      stop(directory, item.sessionID)
    }
  }

  const dispose = () => {
    for (const [key, current] of pending) {
      timers.clear(current.timer)
      pending.delete(key)
    }
  }

  return {
    markBusy(directory: string, sessionID: string) {
      schedule(directory, sessionID)
    },
    stop,
    refresh,
    dispose,
  }
}
