import { makeEventListener } from "@solid-primitives/event-listener"
import { batch, createEffect, createMemo, createSignal, For, onMount, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { useLayout } from "@/context/layout"
import { browserTab, browserTabID } from "@/pages/session/helpers"
import { BrowserPanel } from "@/pages/session/browser-panel"
import {
  BROWSER_KEEPALIVE_SLOT_EVENT,
  browserKeepaliveSlotKey,
  browserKeepaliveSlots,
  browserKeepaliveTabs,
  emitBrowserKeepaliveSlotChange,
  getBrowserKeepaliveSlot,
} from "@/pages/session/browser-keepalive-slot"

const DEFAULT_PARKED_RECT = {
  left: 24,
  top: 56,
  width: 1280,
  height: 900,
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
    return getBrowserKeepaliveSlot(props.sessionKey, props.tab)
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
    makeEventListener(window, BROWSER_KEEPALIVE_SLOT_EVENT, () => setSlotVersion((value) => value + 1))
    setSlotVersion((value) => value + 1)
  })

  const detachedBrowserTabs = createMemo(() => {
    return new Set(
      layout
        .detachedPanels
        .list()
        .filter((item) => item.kind === "browser")
        .map((item) => browserKeepaliveSlotKey(item.sessionKey, item.tab)),
    )
  })

  const browserTabs = createMemo(() => {
    slotVersion()
    const detached = detachedBrowserTabs()
    const all = new Map<string, { key: string; sessionKey: string; tab: string }>()
    for (const item of browserKeepaliveTabs.values()) all.set(item.key, item)
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
      for (const [key, item] of Array.from(browserKeepaliveTabs.entries())) {
        const id = browserTabID(item.tab)
        const currentSlot = browserKeepaliveSlots.get(key)
        if (!id) {
          browserKeepaliveTabs.delete(key)
          browserKeepaliveSlots.delete(key)
          changed = true
          continue
        }
        if (layout.view(item.sessionKey).browser.get(id)) continue
        if (currentSlot?.element) continue
        browserKeepaliveTabs.delete(key)
        browserKeepaliveSlots.delete(key)
        changed = true
      }
    })
    if (changed) emitBrowserKeepaliveSlotChange()
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
