import { createEffect, onCleanup, onMount } from "solid-js"

export const BROWSER_KEEPALIVE_SLOT_EVENT = "lfcode:browser-keepalive-slot-change"

export type BrowserKeepaliveSlotState = {
  element?: HTMLElement
  visible: boolean
  rect?: {
    left: number
    top: number
    width: number
    height: number
  }
}

export const browserKeepaliveSlots = new Map<string, BrowserKeepaliveSlotState>()
export const browserKeepaliveTabs = new Map<string, { key: string; sessionKey: string; tab: string }>()

export const browserKeepaliveSlotKey = (sessionKey: string, tab: string) => `${sessionKey}\n${tab}`

export const getBrowserKeepaliveSlot = (sessionKey: string, tab: string) => browserKeepaliveSlots.get(browserKeepaliveSlotKey(sessionKey, tab))

export const hasBrowserKeepaliveSlots = () => browserKeepaliveTabs.size > 0

export const emitBrowserKeepaliveSlotChange = () => {
  if (typeof window !== "object") return
  window.dispatchEvent(new CustomEvent(BROWSER_KEEPALIVE_SLOT_EVENT))
}

function rememberBrowserKeepaliveTab(sessionKey: string, tab: string) {
  const key = browserKeepaliveSlotKey(sessionKey, tab)
  if (browserKeepaliveTabs.has(key)) return
  browserKeepaliveTabs.set(key, { key, sessionKey, tab })
  emitBrowserKeepaliveSlotChange()
}

function setBrowserKeepaliveSlot(sessionKey: string, tab: string, next: BrowserKeepaliveSlotState) {
  browserKeepaliveSlots.set(browserKeepaliveSlotKey(sessionKey, tab), next)
  emitBrowserKeepaliveSlotChange()
}

function clearBrowserKeepaliveSlot(sessionKey: string, tab: string, element: HTMLElement) {
  const key = browserKeepaliveSlotKey(sessionKey, tab)
  const current = browserKeepaliveSlots.get(key)
  if (current?.element !== element) return
  browserKeepaliveSlots.set(key, {
    ...current,
    element: undefined,
    visible: false,
  })
  emitBrowserKeepaliveSlotChange()
}

export function BrowserKeepaliveSlot(props: {
  sessionKey: string
  tab: string
  visible: boolean
}) {
  let ref: HTMLDivElement | undefined

  onMount(() => {
    const element = ref
    if (!element) return
    rememberBrowserKeepaliveTab(props.sessionKey, props.tab)
    const updateRect = () => {
      const rect = element.getBoundingClientRect()
      setBrowserKeepaliveSlot(props.sessionKey, props.tab, {
        element,
        visible: props.visible,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      })
    }
    const resize = new ResizeObserver(() => updateRect())
    resize.observe(element)
    const sync = () => updateRect()
    window.addEventListener("resize", sync)
    window.addEventListener("scroll", sync, true)
    setBrowserKeepaliveSlot(props.sessionKey, props.tab, {
      element,
      visible: props.visible,
    })
    queueMicrotask(updateRect)
    onCleanup(() => {
      resize.disconnect()
      window.removeEventListener("resize", sync)
      window.removeEventListener("scroll", sync, true)
      clearBrowserKeepaliveSlot(props.sessionKey, props.tab, element)
    })
  })

  createEffect(() => {
    const element = ref
    if (!element) return
    rememberBrowserKeepaliveTab(props.sessionKey, props.tab)
    const rect = element.getBoundingClientRect()
    setBrowserKeepaliveSlot(props.sessionKey, props.tab, {
      element,
      visible: props.visible,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    })
  })

  return <div ref={ref} class="size-full min-h-0 min-w-0" />
}
