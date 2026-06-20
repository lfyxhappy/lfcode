import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@lfcode-ai/ui/file-icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Icon } from "@lfcode-ai/ui/icon"
import { TooltipKeybind } from "@lfcode-ai/ui/tooltip"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { browserTabID, formatBrowserTabLabel } from "@/pages/session/helpers"

export function FileVisual(props: { path: string; active?: boolean }): JSX.Element {
  return (
    <div data-component="file-visual" class="flex items-center gap-x-1.5 min-w-0">
      <Show
        when={!props.active}
        fallback={<FileIcon node={{ path: props.path, type: "file" }} class="size-4 shrink-0" />}
      >
        <span class="relative inline-flex size-4 shrink-0">
          <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
          <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
        </span>
      </Show>
      <span class="text-14-medium truncate">{getFilename(props.path)}</span>
    </div>
  )
}

export function SortableTab(props: {
  tab: string
  onTabClose: (tab: string) => void
  onBrowserTabClose?: (tabID: string) => void
  onDetach?: (tab: string) => void
  detachBounds?: () => DOMRect | undefined
  onDetachPreviewChange?: (
    value?:
      | {
          tab: string
          x: number
          y: number
          width: number
          height: number
          offsetX: number
          offsetY: number
        }
      | undefined,
  ) => void
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const layout = useLayout()
  const { sessionKey, view } = useSessionLayout()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  const browserID = createMemo(() => browserTabID(props.tab))
  const browser = createMemo(() => {
    const id = browserID()
    if (!id) return
    return view().browser.get(id)
  })
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} />
  })
  const browserContent = createMemo(() => {
    const value = browser()
    if (!value) return
    return (
      <div class="flex items-center gap-1.5 min-w-0">
        <div class="flex size-4 shrink-0 items-center justify-center rounded-sm bg-surface-base">
          <Icon name="window-cursor" size="small" class="text-text-weak" />
        </div>
        <span class="text-14-medium truncate">{formatBrowserTabLabel(value.title ?? value.url)}</span>
      </div>
    )
  })
  const trackDetachGesture = (event: PointerEvent) => {
    const detach = props.onDetach
    if (!detach) return
    if (event.button !== 0) return
    if (!props.detachBounds) return

    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    let pendingDetach = false
    const clearPreview = () => props.onDetachPreviewChange?.()
    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", cleanup)
      clearPreview()
    }
    const onPointerMove = (move: PointerEvent) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      if (Math.hypot(dx, dy) < 20) {
        pendingDetach = false
        clearPreview()
        return
      }
      const bounds = props.detachBounds?.()
      if (!bounds) {
        pendingDetach = false
        clearPreview()
        return
      }
      pendingDetach =
        move.clientX < bounds.left - 24 ||
        move.clientX > bounds.right + 24 ||
        move.clientY < bounds.top - 24 ||
        move.clientY > bounds.bottom + 24
      if (!pendingDetach) {
        clearPreview()
        return
      }
      props.onDetachPreviewChange?.({
        tab: props.tab,
        x: move.clientX,
        y: move.clientY,
        width: rect.width,
        height: rect.height,
        offsetX,
        offsetY,
      })
    }
    const onPointerUp = () => {
      cleanup()
      if (!pendingDetach) return
      detach(props.tab)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", cleanup)
  }

  return (
    <div use:sortable class="h-full flex items-center" classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative">
        <Tabs.Trigger
          value={props.tab}
          closeButton={
            <TooltipKeybind
              title={language.t("common.closeTab")}
              keybind={command.keybind("tab.close")}
              placement="bottom"
              gutter={10}
            >
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => {
                  const browser = browserID()
                  if (browser) {
                    props.onBrowserTabClose?.(browser)
                    return
                  }
                  props.onTabClose(props.tab)
                }}
                aria-label={language.t("common.closeTab")}
              />
            </TooltipKeybind>
          }
          hideCloseButton
          onMiddleClick={() => {
            const browser = browserID()
            if (browser) {
              props.onBrowserTabClose?.(browser)
              return
            }
            props.onTabClose(props.tab)
          }}
          onPointerDown={trackDetachGesture}
        >
          <Show when={browserContent()} fallback={<Show when={content()}>{(value) => value()}</Show>}>
            {(value) => value()}
          </Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
