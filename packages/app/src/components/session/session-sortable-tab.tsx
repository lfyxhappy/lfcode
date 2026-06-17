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
    <div class="flex items-center gap-x-1.5 min-w-0">
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
          >
          <Show when={browserContent()} fallback={<Show when={content()}>{(value) => value()}</Show>}>
            {(value) => value()}
          </Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
