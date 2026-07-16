import type { Message as MessageType, UserMessage } from "@lfcode-ai/sdk/v2"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { messageIdFromHash } from "./message-id-from-hash"
import { messageHashTargetId } from "./session-hash-target"

export const useSessionHashScroll = (input: {
  sessionID: () => string | undefined
  messagesReady: () => boolean
  streaming?: () => boolean
  messages: () => MessageType[]
  visibleUserMessages: () => UserMessage[]
  turnStart: () => number
  currentMessageId: () => string | undefined
  setActiveMessage: (message: UserMessage | undefined) => void
  setTurnStart: (value: number) => void
  autoScroll: { pause: () => void; forceScrollToBottom: () => void }
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
}) => {
  const messages = createMemo(() => input.messages())
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(messages().map((m) => [m.id, m])))
  const userMessageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  const messageIndex = createMemo(() => new Map(visibleUserMessages().map((m, i) => [m.id, i])))

  const location = useLocation()
  const navigate = useNavigate()
  let lastAppliedHashKey = ""

  const frames = new Set<number>()
  const queue = (fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      fn()
    })
    frames.add(id)
  }
  const cancel = () => {
    for (const id of frames) cancelAnimationFrame(id)
    frames.clear()
  }

  const clearMessageHash = () => {
    cancel()
    if (!location.hash) return
    navigate(location.pathname + location.search, { replace: true })
  }

  const updateHash = (id: string) => {
    const hash = `#${input.anchor(id)}`
    if (location.hash === hash) return
    navigate(location.pathname + location.search + hash, {
      replace: true,
    })
  }

  const scrollToElement = (el: HTMLElement, behavior: ScrollBehavior) => {
    const root = input.scroller()
    if (!root) return false

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    const sticky = root.querySelector("[data-session-title]")
    const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
    const top = Math.max(0, a.top - b.top + root.scrollTop - inset)
    root.scrollTo({ top, behavior })
    return true
  }

  const seek = (id: string, behavior: ScrollBehavior, left = 4): boolean => {
    const root = input.scroller()
    const el = [...(root?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])].find(
      (element) => element.dataset.messageId === id,
    )
    if (el) return scrollToElement(el, behavior)
    if (left <= 0) return false
    queue(() => {
      seek(id, behavior, left - 1)
    })
    return false
  }

  const scrollToMessage = (
    message: MessageType,
    behavior: ScrollBehavior = "smooth",
    options?: { updateHash?: boolean },
  ) => {
    cancel()
    const owner = message.role === "user" ? message : message.parentID ? userMessageById().get(message.parentID) : undefined
    const hashTargetId = messageHashTargetId(message)
    const shouldUpdateHash = options?.updateHash !== false
    if (owner && input.currentMessageId() !== owner.id) input.setActiveMessage(owner)

    const turnAnchorId = message.role === "user" ? message.id : message.parentID
    const index = turnAnchorId ? (messageIndex().get(turnAnchorId) ?? -1) : -1
    if (index !== -1 && index < input.turnStart()) {
      input.setTurnStart(index)

      queue(() => {
        seek(message.id, behavior)
      })

      if (shouldUpdateHash) updateHash(hashTargetId)
      return
    }

    if (seek(message.id, behavior)) {
      if (shouldUpdateHash) updateHash(hashTargetId)
      return
    }

    if (shouldUpdateHash) updateHash(hashTargetId)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const hash = location.hash.slice(1)
    if (!hash) return

    const messageId = messageIdFromHash(hash)
    if (messageId) {
      input.autoScroll.pause()
      const msg = messageById().get(messageId)
      if (msg) {
        scrollToMessage(msg, behavior)
        return
      }
      return
    }

    const root = input.scroller()
    const target = [...(root?.querySelectorAll<HTMLElement>("[id]") ?? [])].find((element) => element.id === hash)
    if (target) {
      input.autoScroll.pause()
      scrollToElement(target, behavior)
      return
    }

    input.autoScroll.forceScrollToBottom()
  }

  createEffect(
    on(
      () => [location.hash, input.sessionID(), input.messagesReady()] as const,
      ([hash, sessionID, ready]) => {
        if (!sessionID || !ready) return
        if (input.streaming?.() && hash) return
        const nextKey = `${sessionID}:${hash}`
        if (lastAppliedHashKey === nextKey) return
        lastAppliedHashKey = nextKey
        cancel()
        applyHash("auto")
      },
      { defer: true },
    ),
  )

  onMount(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual"
    }
  })

  onCleanup(cancel)

  return {
    clearMessageHash,
    scrollToMessage,
    applyHash,
  }
}
