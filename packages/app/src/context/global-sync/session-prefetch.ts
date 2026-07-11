const key = (directory: string, sessionID: string) => `${directory}\n${sessionID}`

export const SESSION_PREFETCH_TTL = 15_000

type Meta = {
  scope?: "all"
  limit: number
  cursor?: string
  complete: boolean
  at: number
}

export function shouldSkipSessionPrefetch(input: { message: boolean; info?: Meta; chunk: number; now?: number }) {
  if (input.info?.scope !== "all") return false

  if (input.message) {
    if (input.info.complete) return true
    if (input.info.limit > input.chunk) return true
  } else {
    if (!input.info) return false
  }

  return (input.now ?? Date.now()) - input.info.at < SESSION_PREFETCH_TTL
}

const cache = new Map<string, Meta>()
const inflight = new Map<string, { controller: AbortController; promise: Promise<Meta | undefined> }>()
const rev = new Map<string, number>()

const version = (id: string) => rev.get(id) ?? 0

export function getSessionPrefetch(directory: string, sessionID: string) {
  return cache.get(key(directory, sessionID))
}

export function getSessionPrefetchPromise(directory: string, sessionID: string) {
  return inflight.get(key(directory, sessionID))?.promise
}

export function clearSessionPrefetchInflight() {
  for (const [id, pending] of inflight) {
    rev.set(id, version(id) + 1)
    pending.controller.abort()
  }
  inflight.clear()
}

/** Cancels speculative work without throwing away a completed warm cache. */
export function cancelSessionPrefetch(directory: string, sessionIDs: Iterable<string>) {
  for (const sessionID of sessionIDs) {
    if (!sessionID) continue
    const id = key(directory, sessionID)
    rev.set(id, version(id) + 1)
    const pending = inflight.get(id)
    pending?.controller.abort()
    inflight.delete(id)
  }
}

export function isSessionPrefetchCurrent(directory: string, sessionID: string, value: number) {
  return version(key(directory, sessionID)) === value
}

export function runSessionPrefetch(input: {
  directory: string
  sessionID: string
  task: (input: { revision: number; signal: AbortSignal }) => Promise<Meta | undefined>
}) {
  const id = key(input.directory, input.sessionID)
  const pending = inflight.get(id)
  if (pending) return pending.promise

  const controller = new AbortController()
  const revision = version(id)

  const promise = input.task({ revision, signal: controller.signal }).finally(() => {
    if (inflight.get(id)?.promise === promise) inflight.delete(id)
  })

  inflight.set(id, { controller, promise })
  return promise
}

export function setSessionPrefetch(input: {
  directory: string
  sessionID: string
  scope: "all"
  limit: number
  cursor?: string
  complete: boolean
  at?: number
}) {
  cache.set(key(input.directory, input.sessionID), {
    scope: input.scope,
    limit: input.limit,
    cursor: input.cursor,
    complete: input.complete,
    at: input.at ?? Date.now(),
  })
}

export function clearSessionPrefetch(directory: string, sessionIDs: Iterable<string>) {
  const ids = Array.from(sessionIDs)
  cancelSessionPrefetch(directory, ids)
  for (const sessionID of ids) {
    if (!sessionID) continue
    const id = key(directory, sessionID)
    cache.delete(id)
  }
}

export function clearSessionPrefetchDirectory(directory: string) {
  const prefix = `${directory}\n`
  const keys = new Set([...cache.keys(), ...inflight.keys()])
  for (const id of keys) {
    if (!id.startsWith(prefix)) continue
    rev.set(id, version(id) + 1)
    cache.delete(id)
    const pending = inflight.get(id)
    pending?.controller.abort()
    inflight.delete(id)
  }
}
