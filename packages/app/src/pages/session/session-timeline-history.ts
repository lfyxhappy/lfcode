import type { Message, UserMessage } from "@lfcode-ai/sdk/v2"
import { createEffect, createMemo, on, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { same } from "@/utils/same"

const emptyUserMessages: UserMessage[] = []
const emptyMessages: Message[] = []

export function retainTimelineMessages(next: Message[] | undefined, previous: Message[] | undefined) {
  return next ?? previous ?? emptyMessages
}

export type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  messagesReady: () => boolean
  loaded: () => number
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
  storedTurnStart: () => number | undefined
  setStoredTurnStart: (value: number) => void
}

/**
 * Owns the loaded turn window for one timeline surface. The caller supplies
 * the surface-scoped data source, so the same lifecycle can later be mounted
 * for active, frozen, and preparing session surfaces without route coupling.
 */
export function createSessionHistoryWindow(input: SessionHistoryWindowInput) {
  const turnInit = 10
  const turnBatch = 8
  const turnScrollThreshold = 200
  const turnPrefetchBuffer = 16
  const prefetchCooldownMs = 400
  const prefetchNoGrowthLimit = 2

  const [state, setState] = createStore({
    turnID: undefined as string | undefined,
    turnStart: 0,
    prefetchUntil: 0,
    prefetchNoGrowth: 0,
  })

  const initialTurnStart = (messages: UserMessage[]) => {
    const len = messages.length
    if (len <= turnInit) return 0
    return len - turnInit
  }
  const normalizeTurnStart = (start: number | undefined, messages: UserMessage[]) => {
    const len = messages.length
    if (!len) return 0
    if (start === undefined || start <= 0) return 0
    if (start >= len) return initialTurnStart(messages)
    return start
  }

  const turnStart = createMemo(() => {
    const id = input.sessionID()
    const messages = input.visibleUserMessages()
    const len = messages.length
    if (!id || len <= 0) return 0
    if (state.turnID !== id) {
      const remembered = input.storedTurnStart()
      if (remembered === undefined) return initialTurnStart(messages)
      return normalizeTurnStart(remembered, messages)
    }
    return normalizeTurnStart(state.turnStart, messages)
  })

  const setTurnStart = (start: number) => {
    const id = input.sessionID()
    const next = start > 0 ? start : 0
    if (!id) {
      setState({ turnID: undefined, turnStart: next })
      return
    }
    input.setStoredTurnStart(next)
    setState({ turnID: id, turnStart: next })
  }

  const renderedUserMessages = createMemo(
    () => {
      const messages = input.visibleUserMessages()
      const start = turnStart()
      if (start <= 0) return messages
      return messages.slice(start)
    },
    emptyUserMessages,
    { equals: same },
  )

  const resetToRecent = () => setTurnStart(initialTurnStart(input.visibleUserMessages()))

  const prepareAnchorWindow = (turnID: string, fallbackStart: number) => {
    const messages = input.visibleUserMessages()
    const index = messages.findIndex((message) => message.id === turnID)
    const next = index < 0 ? normalizeTurnStart(fallbackStart, messages) : Math.max(0, index - 2)
    if (turnStart() === next) return false
    setTurnStart(next)
    return true
  }

  // virtua owns prepend anchoring. A second pixel adjustment would visibly jump.
  const preserveScroll = (action: () => void) => action()

  const backfillTurns = () => {
    const start = turnStart()
    if (start <= 0) return
    preserveScroll(() => setTurnStart(Math.max(0, start - turnBatch)))
  }

  const loadAndReveal = async () => {
    const id = input.sessionID()
    if (!id) return

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    let loaded = input.loaded()

    if (start > 0) setTurnStart(0)
    if (!input.historyMore() || input.historyLoading()) return

    let afterVisible = beforeVisible
    let added = 0
    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      afterVisible = input.visibleUserMessages().length
      const nextLoaded = input.loaded()
      const growth = nextLoaded - loaded
      added += growth
      loaded = nextLoaded

      if (afterVisible > beforeVisible || growth <= 0 || !input.historyMore()) break
    }

    if (added <= 0 || afterVisible <= beforeVisible || turnStart() !== 0) return
    if (state.prefetchNoGrowth) setState("prefetchNoGrowth", 0)
    const target = Math.min(afterVisible, beforeVisible + turnBatch)
    setTurnStart(Math.max(0, afterVisible - target))
  }

  const fetchOlderMessages = async (options?: { prefetch?: boolean }) => {
    const id = input.sessionID()
    if (!id || !input.historyMore() || input.historyLoading()) return

    if (options?.prefetch) {
      const now = Date.now()
      if (state.prefetchUntil > now || state.prefetchNoGrowth >= prefetchNoGrowthLimit) return
      setState("prefetchUntil", now + prefetchCooldownMs)
    }

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    const beforeRendered = start <= 0 ? beforeVisible : renderedUserMessages().length
    let loaded = input.loaded()
    let added = 0
    let growth = 0

    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      const nextLoaded = input.loaded()
      const raw = nextLoaded - loaded
      added += raw
      loaded = nextLoaded
      growth = input.visibleUserMessages().length - beforeVisible

      if (growth > 0 || raw <= 0 || options?.prefetch || !input.historyMore()) break
    }

    const afterVisible = input.visibleUserMessages().length
    if (options?.prefetch) {
      setState("prefetchNoGrowth", added > 0 ? 0 : state.prefetchNoGrowth + 1)
    } else if (added > 0 && state.prefetchNoGrowth) {
      setState("prefetchNoGrowth", 0)
    }

    if (added <= 0 || growth <= 0) return
    if (options?.prefetch) {
      preserveScroll(() => setTurnStart(turnStart() + growth))
      return
    }
    if (turnStart() !== start) return

    const target = Math.min(afterVisible, Math.max(beforeRendered, renderedUserMessages().length) + turnBatch)
    preserveScroll(() => setTurnStart(Math.max(0, afterVisible - target)))
  }

  const fillViewport = () => {
    if (turnStart() > 0) {
      backfillTurns()
      return
    }
    void fetchOlderMessages()
  }

  const onScrollerScroll = () => {
    if (!input.userScrolled()) return
    const root = input.scroller()
    if (!root || root.scrollTop >= turnScrollThreshold) return

    const start = turnStart()
    if (start > 0) {
      if (start <= turnPrefetchBuffer) void fetchOlderMessages({ prefetch: true })
      backfillTurns()
      return
    }
    void fetchOlderMessages()
  }

  createEffect(on(input.sessionID, () => setState({ prefetchUntil: 0, prefetchNoGrowth: 0 }), { defer: true }))
  createEffect(
    on(
      () => [input.sessionID(), input.messagesReady()] as const,
      ([id, ready]) => {
        if (!id || !ready) return
        const messages = input.visibleUserMessages()
        const remembered = input.storedTurnStart()
        const next = remembered === undefined ? initialTurnStart(messages) : normalizeTurnStart(remembered, messages)
        if (state.turnID === id && state.turnStart === next) return
        setTurnStart(next)
      },
      { defer: true },
    ),
  )

  return {
    turnStart,
    setTurnStart,
    renderedUserMessages,
    loadAndReveal,
    onScrollerScroll,
    resetToRecent,
    prepareAnchorWindow,
    fillViewport,
    loadForRestore: () => fetchOlderMessages(),
  }
}

export function buildSessionMessageViews(input: {
  messages: Message[]
  revertMessageID?: string
  viewAgentID: string
}) {
  const mainUserMessages: UserMessage[] = []
  const visibleUserMessages: UserMessage[] = []
  const viewTimelineMessages: Message[] = []
  const viewUserMessages: UserMessage[] = []
  let latestMainContextMessageID: string | undefined

  for (const message of input.messages) {
    const agentID = message.agentID ?? "main"
    const visible = !input.revertMessageID || message.id < input.revertMessageID

    if (agentID === "main" && message.role === "user") {
      mainUserMessages.push(message as UserMessage)
      if (visible) visibleUserMessages.push(message as UserMessage)
    }
    if (agentID === "main" && visible) latestMainContextMessageID = message.id
    if (agentID !== input.viewAgentID || !visible) continue
    viewTimelineMessages.push(message)
    if (message.role === "user") viewUserMessages.push(message as UserMessage)
  }

  return {
    mainUserMessages,
    visibleUserMessages,
    viewTimelineMessages,
    viewUserMessages,
    latestMainContextMessageID,
  }
}

export type SessionTimelineMessageSource = {
  messages: Accessor<Message[]>
  mainUserMessages: Accessor<UserMessage[]>
  visibleUserMessages: Accessor<UserMessage[]>
  timelineMessages: Accessor<Message[]>
  userMessages: Accessor<UserMessage[]>
  latestMainContextMessageID: Accessor<string | undefined>
}

/**
 * A timeline's message projection must be bound to its own session ID rather
 * than to whatever route happens to be active when a frozen surface disposes.
 * The source intentionally owns no DOM or scroll state, so it is safe to keep
 * around for a warm surface and inexpensive to recreate for a cold one.
 */
export function createSessionTimelineMessageSource(input: {
  sessionID: string
  messages: (sessionID: string) => Message[] | undefined
  revertMessageID: (sessionID: string) => string | undefined
  viewAgentID: Accessor<string>
}): SessionTimelineMessageSource {
  let lastReadyMessages: Message[] | undefined
  // `undefined` means this session page is loading or being refreshed. Keep
  // the last confirmed projection visible instead of presenting it as an empty
  // conversation; an explicit empty array still renders the true empty state.
  const messages = createMemo(() => {
    const next = input.messages(input.sessionID)
    if (next !== undefined) {
      lastReadyMessages = next
      return next
    }
    return retainTimelineMessages(next, lastReadyMessages)
  }, emptyMessages, { equals: same })
  const views = createMemo(() =>
    buildSessionMessageViews({
      messages: messages(),
      revertMessageID: input.revertMessageID(input.sessionID),
      viewAgentID: input.viewAgentID(),
    }),
  )

  return {
    messages,
    mainUserMessages: createMemo(() => views().mainUserMessages, emptyUserMessages, { equals: same }),
    visibleUserMessages: createMemo(() => views().visibleUserMessages, emptyUserMessages, { equals: same }),
    timelineMessages: createMemo(() => views().viewTimelineMessages, emptyMessages, { equals: same }),
    userMessages: createMemo(() => views().viewUserMessages, emptyUserMessages, { equals: same }),
    latestMainContextMessageID: createMemo(() => views().latestMainContextMessageID),
  }
}
