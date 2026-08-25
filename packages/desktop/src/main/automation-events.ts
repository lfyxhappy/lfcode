export type AutomationEventScope = "main" | "renderer" | "server"

export type AutomationEvent = {
  id: number
  at: number
  timestamp: number
  isoTime: string
  scope: AutomationEventScope
  type: string
  windowID?: number
  data?: unknown
}

export type AutomationEventQuery = {
  after?: number
  scope?: AutomationEventScope
  type?: string
  limit?: number
}

export type AutomationEventNextResult = {
  events: AutomationEvent[]
  nextCursor: number
  oldestID: number
  latestID: number
  resetRequired: boolean
}

export function createAutomationEventBuffer(limit = 300) {
  let nextID = 1
  const events: AutomationEvent[] = []
  const waiters = new Set<() => void>()

  const push = (input: {
    scope: AutomationEventScope
    type: string
    windowID?: number
    data?: unknown
  }) => {
    const at = Date.now()
    const isoTime = new Date(at).toISOString()
    const event = {
      id: nextID++,
      at,
      timestamp: at,
      isoTime,
      scope: input.scope,
      type: input.type,
      windowID: input.windowID,
      data: input.data,
    } satisfies AutomationEvent
    events.push(event)
    if (events.length > limit) events.splice(0, events.length - limit)
    notifyWaiters(waiters)
    return event
  }

  return {
    push,
    clear() {
      events.splice(0, events.length)
      notifyWaiters(waiters)
    },
    list(input?: {
      scope?: AutomationEventScope
      type?: string
      limit?: number
    }) {
      const filtered = events.filter((event) => {
        if (input?.scope && event.scope !== input.scope) return false
        if (input?.type && event.type !== input.type) return false
        return true
      })
      if (!input?.limit || filtered.length <= input.limit) return filtered.slice()
      return filtered.slice(filtered.length - input.limit)
    },
    next(input?: AutomationEventQuery): AutomationEventNextResult {
      return readNext(events, nextID, input)
    },
    wait(input?: AutomationEventQuery & { waitMs?: number; signal?: AbortSignal }): Promise<AutomationEventNextResult> {
      const current = readNext(events, nextID, input)
      const waitMs = normalizedWaitMs(input?.waitMs)
      if (current.events.length > 0 || current.resetRequired || waitMs === 0) return Promise.resolve(current)

      return new Promise((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          waiters.delete(check)
          input?.signal?.removeEventListener("abort", finish)
          resolve(readNext(events, nextID, input))
        }
        const check = () => {
          const updated = readNext(events, nextID, input)
          if (updated.events.length > 0 || updated.resetRequired) finish()
        }
        const timer = setTimeout(finish, waitMs)
        waiters.add(check)
        input?.signal?.addEventListener("abort", finish, { once: true })
        if (input?.signal?.aborted) finish()
      })
    },
    pendingWaiterCount() {
      return waiters.size
    },
  }
}

function readNext(events: AutomationEvent[], nextID: number, input?: AutomationEventQuery): AutomationEventNextResult {
  const after = normalizedCursor(input?.after)
  const oldestID = events[0]?.id ?? nextID
  const latestID = nextID - 1
  const resetRequired = after > 0 && after < oldestID - 1
  const candidates = events.filter((event) => event.id > (resetRequired ? oldestID - 1 : after))
  const matched = candidates.filter((event) => {
    if (input?.scope && event.scope !== input.scope) return false
    if (input?.type && event.type !== input.type) return false
    return true
  })
  const limited = matched.slice(0, normalizedLimit(input?.limit))
  const nextCursor =
    limited.length < matched.length
      ? limited.at(-1)?.id ?? after
      : Math.max(after, latestID)

  return {
    events: limited,
    nextCursor,
    oldestID,
    latestID,
    resetRequired,
  }
}

function normalizedCursor(value: number | undefined) {
  if (!Number.isSafeInteger(value) || !value || value < 0) return 0
  return value
}

function normalizedLimit(value: number | undefined) {
  if (!Number.isSafeInteger(value) || !value || value < 0) return 200
  return value
}

function normalizedWaitMs(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value < 0) return 0
  return Math.floor(value)
}

function notifyWaiters(waiters: Set<() => void>) {
  for (const waiter of [...waiters]) waiter()
}
