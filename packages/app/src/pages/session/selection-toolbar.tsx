import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/context/language"

type SelectionInfo = {
  text: string
  messageID?: string
  sessionID?: string
  box: {
    top: number
    bottom: number
    left: number
    right: number
  }
}

const BLOCKED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "webview",
  "[contenteditable]",
  "[role='button']",
  "[role='menuitem']",
  "[role='dialog']",
  "[data-action]",
  "[data-component='prompt-input']",
  "[data-component='popover-content']",
  "[data-component='selection-toolbar']",
  "[data-component='terminal']",
  "[data-prevent-autofocus]",
  "#terminal-panel",
].join(",")

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function elementFromNode(node: Node | null) {
  if (!node) return
  if (node instanceof Element) return node
  return node.parentElement ?? undefined
}

function blocked(node: Node | null) {
  const element = elementFromNode(node)
  return !!element?.closest(BLOCKED_SELECTOR)
}

function insideToolbar(node: Node | null) {
  const element = elementFromNode(node)
  return !!element?.closest('[data-component="selection-toolbar"]')
}

function selectionInfo(roots: (HTMLElement | undefined)[]) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  if (blocked(selection.anchorNode) || blocked(selection.focusNode)) return

  const range = selection.getRangeAt(0)
  const root = roots.find((item) => item?.contains(range.commonAncestorContainer))
  if (!root || blocked(range.commonAncestorContainer)) return

  const text = selection.toString().trim()
  if (!text) return

  const rect = range.getBoundingClientRect()
  const fallback = range.getClientRects().item(0)
  const box = rect.width || rect.height ? rect : fallback
  if (!box) return

  const source = elementFromNode(range.commonAncestorContainer)
  return {
    text,
    messageID: source?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? undefined,
    sessionID: root.dataset.sessionId || undefined,
    box: {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
    },
  } satisfies SelectionInfo
}

export function SelectionToolbar(props: {
  roots: Accessor<(HTMLElement | undefined)[]>
  onAddToChat: (input: { text: string; messageID?: string; sessionID?: string }) => void
  onAskSideChat: (input: { text: string; messageID?: string; sessionID?: string }) => void
}) {
  const language = useLanguage()
  const [selection, setSelection] = createSignal<SelectionInfo>()
  const [toolbarSize, setToolbarSize] = createSignal({ width: 0, height: 46 })
  let refreshFrame: number | undefined
  let selecting = false
  let toolbarInteraction = false
  let lastActionAt = 0
  let cleanupToolbarBinding = () => {}
  let cleanupToolbarResize = () => {}

  const clear = () => {
    window.getSelection()?.removeAllRanges()
    toolbarInteraction = false
    setSelection(undefined)
  }

  const refresh = () => {
    if (toolbarInteraction) return
    setSelection(selectionInfo(props.roots()))
  }

  const scheduleRefresh = () => {
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = undefined
      refresh()
    })
  }

  const runAction = (action: (current: SelectionInfo) => void) => {
    const current = selection() ?? selectionInfo(props.roots())
    if (!current) return
    action(current)
    clear()
  }

  const runMouseAction =
    (action: (current: SelectionInfo) => void) =>
    (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      toolbarInteraction = true
      const now = Date.now()
      if (now - lastActionAt < 200) return
      lastActionAt = now
      runAction(action)
    }

  const runClickAction =
    (action: (current: SelectionInfo) => void) =>
    (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      toolbarInteraction = true
      const now = Date.now()
      if (now - lastActionAt < 200) return
      lastActionAt = now
      runAction(action)
    }

  const runKeyboardAction =
    (action: (current: SelectionInfo) => void) =>
    (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      event.stopPropagation()
      toolbarInteraction = true
      runAction(action)
    }

  makeEventListener(document, "mousedown", (event) => {
    if (insideToolbar(event.target as Node | null)) return
    toolbarInteraction = false
    selecting = true
    setSelection(undefined)
  })
  makeEventListener(document, "mouseup", () => {
    selecting = false
    scheduleRefresh()
  })
  makeEventListener(document, "selectionchange", () => {
    if (toolbarInteraction || selecting) return
    scheduleRefresh()
  })
  makeEventListener(document, "keyup", (event) => {
    if (event.key === "Escape") {
      clear()
      return
    }
    selecting = false
    scheduleRefresh()
  })
  makeEventListener(document, "visibilitychange", () => {
    if (document.visibilityState !== "visible") clear()
  })
  makeEventListener(window, "blur", clear)
  makeEventListener(window, "resize", scheduleRefresh)
  makeEventListener(window, "scroll", scheduleRefresh, { capture: true })

  createEffect(() => {
    props.roots()
    toolbarInteraction = false
    scheduleRefresh()
  })

  const position = createMemo(() => {
    const current = selection()
    if (!current) return
    const size = toolbarSize()
    const width = size.width || 320
    const height = size.height || 32
    const gap = 10
    const center = (current.box.left + current.box.right) / 2
    const aboveTop = current.box.top - height - gap
    const belowTop = current.box.bottom + gap
    return {
      top: clamp(aboveTop >= 8 ? aboveTop : belowTop, 8, window.innerHeight - height - 8),
      left: clamp(center, width / 2 + 8, window.innerWidth - width / 2 - 8),
    }
  })

  const bindToolbar = (toolbar: HTMLDivElement | undefined) => {
    cleanupToolbarBinding()
    cleanupToolbarResize()
    if (!toolbar) return
    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        setToolbarSize({
          width: toolbar.offsetWidth,
          height: toolbar.offsetHeight,
        })
      })
      resizeObserver.observe(toolbar)
      setToolbarSize({
        width: toolbar.offsetWidth,
        height: toolbar.offsetHeight,
      })
      cleanupToolbarResize = () => resizeObserver.disconnect()
    } else {
      setToolbarSize({
        width: toolbar.offsetWidth,
        height: toolbar.offsetHeight,
      })
      cleanupToolbarResize = () => {}
    }

    const resolveAction = (target: EventTarget | null) => {
      const button = target instanceof Element ? target.closest<HTMLButtonElement>("[data-selection-action]") : undefined
      if (!button) return
      const action = button.dataset.selectionAction
      if (action === "add") {
        return (current: SelectionInfo) =>
          props.onAddToChat({ text: current.text, messageID: current.messageID, sessionID: current.sessionID })
      }
      if (action === "ask") {
        return (current: SelectionInfo) =>
          props.onAskSideChat({ text: current.text, messageID: current.messageID, sessionID: current.sessionID })
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      const action = resolveAction(event.target)
      if (!action) return
      runMouseAction(action)(event as unknown as MouseEvent)
    }

    const onClick = (event: MouseEvent) => {
      const action = resolveAction(event.target)
      if (!action) return
      runClickAction(action)(event)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveAction(event.target)
      if (!action) return
      runKeyboardAction(action)(event)
    }

    toolbar.addEventListener("pointerdown", onPointerDown)
    toolbar.addEventListener("click", onClick)
    toolbar.addEventListener("keydown", onKeyDown)

    cleanupToolbarBinding = () => {
      toolbar.removeEventListener("pointerdown", onPointerDown)
      toolbar.removeEventListener("click", onClick)
      toolbar.removeEventListener("keydown", onKeyDown)
    }
  }

  onCleanup(() => {
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    cleanupToolbarBinding()
    cleanupToolbarResize()
    clear()
  })

  return (
    <Portal>
      <div
        ref={bindToolbar}
        data-component="selection-toolbar"
        class="fixed z-50 inline-flex h-8 select-none items-center rounded-full border border-border-base bg-surface-float-base/90 px-2.5 shadow-[0_10px_24px_rgba(0,0,0,0.18)] backdrop-blur-[14px] saturate-150"
        style={{
          display: selection() ? "inline-flex" : "none",
          top: `${position()?.top ?? 0}px`,
          left: `${position()?.left ?? 0}px`,
          transform: "translateX(-50%)",
        }}
        onMouseDown={(event) => {
          toolbarInteraction = true
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <button
          type="button"
          data-selection-action="add"
          class="inline-flex h-full items-center gap-1.5 whitespace-nowrap pr-2 text-13-medium tracking-[-0.01em] text-text-base transition-colors hover:text-text-strong"
        >
          <svg class="size-3.5 shrink-0 text-text-weak" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <path
              d="M11 18.6C14.9765 18.6 18.2 15.8688 18.2 12.5C18.2 9.13122 14.9765 6.4 11 6.4C7.02355 6.4 3.8 9.13122 3.8 12.5C3.8 15.8688 7.02355 18.6 11 18.6Z"
              stroke="currentColor"
              stroke-width="1.8"
            />
            <path
              d="M6.9 17.1L5.7 20L8.9 18.7"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {language.t("session.selection.addToChat")}
        </button>
        <div class="mx-2 h-4 w-px bg-border-weaker-base" aria-hidden="true" />
        <button
          type="button"
          data-selection-action="ask"
          class="inline-flex h-full items-center gap-1.5 whitespace-nowrap text-13-medium tracking-[-0.01em] text-text-base transition-colors hover:text-text-strong"
        >
          <svg class="size-3.5 shrink-0 text-text-weak" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8.2" stroke="currentColor" stroke-width="1.8" />
            <path d="M11 7V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <path d="M7 11H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          {language.t("session.selection.askSideChat")}
        </button>
      </div>
    </Portal>
  )
}
