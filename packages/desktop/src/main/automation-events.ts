type AutomationEventScope = "main" | "renderer" | "server"

export type AutomationEvent = {
  id: number
  at: number
  isoTime: string
  scope: AutomationEventScope
  type: string
  windowID?: number
  data?: unknown
}

export function createAutomationEventBuffer(limit = 300) {
  let nextID = 1
  const events: AutomationEvent[] = []

  const push = (input: {
    scope: AutomationEventScope
    type: string
    windowID?: number
    data?: unknown
  }) => {
    const event = {
      id: nextID++,
      at: Date.now(),
      isoTime: new Date().toISOString(),
      scope: input.scope,
      type: input.type,
      windowID: input.windowID,
      data: input.data,
    } satisfies AutomationEvent
    events.push(event)
    if (events.length > limit) events.splice(0, events.length - limit)
    return event
  }

  return {
    push,
    clear() {
      events.splice(0, events.length)
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
  }
}
