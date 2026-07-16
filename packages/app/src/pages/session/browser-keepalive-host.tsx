import { makeEventListener } from "@solid-primitives/event-listener"
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { useLayout } from "@/context/layout"
import { browserTab, browserTabID } from "@/pages/session/helpers"
import { BrowserPanel } from "@/pages/session/browser-panel"

const SLOT_EVENT = "lfcode:browser-keepalive-slot-change"

type BrowserKeepaliveSlotState = {
  element?: HTMLElement
  visible: boolean
  rect?: {
    left: number
    top: number
    width: number
    height: number
  }
}

const slotState = new Map<string, BrowserKeepaliveSlotState>()
const registeredTabs = new Map<string, { key: string; sessionKey: string; tab: string }>()
const DEFAULT_PARKED_RECT = {
  left: 24,
  top: 56,
  width: 1280,
  height: 900,
}

const slotKey = (sessionKey: string, tab: string) => `${sessionKey}\n${tab}`

const getSlotState = (sessionKey: string, tab: string) => slotState.get(slotKey(sessionKey, tab))

const emitSlotChange = () => {
  if (typeof window !== "object") return
  window.dispatchEvent(new CustomEvent(SLOT_EVENT))
}

function rememberTab(sessionKey: string, tab: string) {
  const key = slotKey(sessionKey, tab)
  if (registeredTabs.has(key)) return
  registeredTabs.set(key, { key, sessionKey, tab })
  emitSlotChange()
}

function setSlotState(
  sessionKey: string,
  tab: string,
  next: BrowserKeepaliveSlotState,
) {
  slotState.set(slotKey(sessionKey, tab), next)
  emitSlotChange()
}

function clearSlotState(sessionKey: string, tab: string, element: HTMLElement) {
  const key = slotKey(sessionKey, tab)
  const current = slotState.get(key)
  if (current?.element !== element) return
  slotState.set(key, {
    ...current,
    element: undefined,
    visible: false,
  })
  emitSlotChange()
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
    rememberTab(props.sessionKey, props.tab)
    const updateRect = () => {
      const rect = element.getBoundingClientRect()
      setSlotState(props.sessionKey, props.tab, {
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
    setSlotState(props.sessionKey, props.tab, {
      element,
      visible: props.visible,
    })
    queueMicrotask(updateRect)
    onCleanup(() => {
      resize.disconnect()
      window.removeEventListener("resize", sync)
      window.removeEventListener("scroll", sync, true)
      clearSlotState(props.sessionKey, props.tab, element)
    })
  })

  createEffect(() => {
    const element = ref
    if (!element) return
    rememberTab(props.sessionKey, props.tab)
    const rect = element.getBoundingClientRect()
    setSlotState(props.sessionKey, props.tab, {
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

function BrowserKeepaliveSurface(props: {
  slotVersion: Accessor<number>
  activeSessionKey: Accessor<string | undefined>
  sessionKey: string
  tab: string
  mount: Accessor<HTMLElement | undefined>
}) {
  const slot = createMemo(() => {
    props.slotVersion()
    return getSlotState(props.sessionKey, props.tab)
  })
  const mountRect = createMemo(() => {
    props.slotVersion()
    const mount = props.mount()
    if (!mount) return
    return mount.getBoundingClientRect()
  })
  const rect = createMemo(() => slot()?.rect)
  const visible = createMemo(() => {
    const current = slot()
    if (!current?.visible || !current.rect) return false
    return props.activeSessionKey() === props.sessionKey
  })
  const parkedRect = createMemo(() => {
    const current = rect()
    if (!current) return DEFAULT_PARKED_RECT
    return {
      left: current.left,
      top: current.top,
      width: current.width > 1 ? current.width : DEFAULT_PARKED_RECT.width,
      height: current.height > 1 ? current.height : DEFAULT_PARKED_RECT.height,
    }
  })
  const surfaceRect = createMemo(() => (visible() ? rect() ?? parkedRect() : parkedRect()))
  const localRect = createMemo(() => {
    const current = surfaceRect()
    const mount = mountRect()
    if (!current || !mount) return current
    return {
      left: current.left - mount.left,
      top: current.top - mount.top,
      width: current.width,
      height: current.height,
    }
  })
  const mount = createMemo(() => props.mount() ?? document.body)

  return (
    <Portal mount={mount()}>
      <div
        class="absolute min-h-0 min-w-0 overflow-hidden"
        style={{
          left: `${localRect()?.left ?? DEFAULT_PARKED_RECT.left}px`,
          top: `${localRect()?.top ?? DEFAULT_PARKED_RECT.top}px`,
          width: `${localRect()?.width ?? DEFAULT_PARKED_RECT.width}px`,
          height: `${localRect()?.height ?? DEFAULT_PARKED_RECT.height}px`,
          visibility: visible() ? "visible" : "hidden",
          "pointer-events": visible() ? "auto" : "none",
          "z-index": visible() ? "20" : "-1",
        }}
      >
        <BrowserPanel sessionKey={props.sessionKey} tab={props.tab} visible={visible()} />
      </div>
    </Portal>
  )
}

export function BrowserKeepaliveHost(props: {
  activeSessionKey: Accessor<string | undefined>
  mount: Accessor<HTMLElement | undefined>
}) {
  const layout = useLayout()
  const [slotVersion, setSlotVersion] = createSignal(0)

  onMount(() => {
    makeEventListener(window, SLOT_EVENT, () => setSlotVersion((value) => value + 1))
    setSlotVersion((value) => value + 1)
  })

  const detachedBrowserTabs = createMemo(() => {
    return new Set(
      layout
        .detachedPanels
        .list()
        .filter((item) => item.kind === "browser")
        .map((item) => slotKey(item.sessionKey, item.tab)),
    )
  })

  const browserTabs = createMemo(() => {
    slotVersion()
    const detached = detachedBrowserTabs()
    const all = new Map<string, { key: string; sessionKey: string; tab: string }>()
    for (const item of registeredTabs.values()) all.set(item.key, item)
    return Array.from(all.values()).flatMap((item) => {
      if (detached.has(item.key)) return []
      if (!layout.view(item.sessionKey).browser.get(browserTabID(item.tab) ?? "")) return []
      return [item]
    })
  })

  createEffect(() => {
    layout.sessions.view()
    layout.sessions.tabs()
    let changed = false
    batch(() => {
      for (const [key, item] of Array.from(registeredTabs.entries())) {
        const id = browserTabID(item.tab)
        const currentSlot = slotState.get(key)
        if (!id) {
          registeredTabs.delete(key)
          slotState.delete(key)
          changed = true
          continue
        }
        if (layout.view(item.sessionKey).browser.get(id)) continue
        if (currentSlot?.element) continue
        registeredTabs.delete(key)
        slotState.delete(key)
        changed = true
      }
    })
    if (changed) emitSlotChange()
  })

  return (
    <>
      <For each={browserTabs()}>
        {(item) => {
          return (
            <BrowserKeepaliveSurface
              slotVersion={slotVersion}
              activeSessionKey={props.activeSessionKey}
              sessionKey={item.sessionKey}
              tab={item.tab}
              mount={props.mount}
            />
          )
        }}
      </For>
    </>
  )
}
