import type { SelectedLineRange } from "@/context/file"

type HandoffSession = {
  prompt: string
  files: Record<string, SelectedLineRange | null>
  browser?: {
    url: string
    title?: string
  }
}

const MAX = 40
export const SESSION_HANDOFF_EVENT = "lfcode:session-handoff"

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}

const touch = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

export const setSessionHandoff = (key: string, patch: Partial<HandoffSession>) => {
  const prev = store.session.get(key) ?? { prompt: "", files: {} }
  const next = { ...prev, ...patch }
  touch(store.session, key, next)
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SESSION_HANDOFF_EVENT, {
        detail: {
          key,
          patch,
          value: next,
        },
      }),
    )
  }
}

export const getSessionHandoff = (key: string) => store.session.get(key)

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
