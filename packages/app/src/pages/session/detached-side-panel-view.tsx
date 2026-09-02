import { IconButton } from "@lfcode-ai/ui/icon-button"
import { MarkedProvider } from "@lfcode-ai/ui/context/marked"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import type { JSX } from "solid-js"
import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { BrowserPanel } from "@/pages/session/browser-panel"
import { FileTabContent } from "@/pages/session/file-tabs"
import type { DetachedSidePanelContext } from "./detached-side-panel"

export function DetachedSidePanelView(props: {
  context: DetachedSidePanelContext
  reviewPanel: () => JSX.Element
}) {
  return (
    <MarkedProvider>
      <DetachedSidePanelViewContent {...props} />
    </MarkedProvider>
  )
}

function DetachedSidePanelViewContent(props: {
  context: DetachedSidePanelContext
  reviewPanel: () => JSX.Element
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const file = useFile()
  const layout = useLayout()
  const [closing, setClosing] = createSignal(false)
  const record = createMemo(() => layout.detachedPanels.get(props.context.detachedWindowID))
  const readyFile = createMemo(() => {
    if (props.context.kind !== "file") return true
    const path = file.pathFromTab(props.context.tab)
    return !!path
  })

  const redock = () => {
    if (closing()) return
    setClosing(true)
    window.setTimeout(() => {
      void platform.redockDetachedSidePanelWindow?.(props.context.detachedWindowID)
    }, 220)
  }

  createEffect(() => {
    if (!platform.onDetachedSidePanelEvent) return
    return platform.onDetachedSidePanelEvent((event) => {
      if (event.type !== "prepare-redock") return
      if (event.detachedWindowID !== props.context.detachedWindowID) return
      redock()
    })
  })

  return (
    <div
      data-component="detached-side-panel-window"
      data-state={closing() ? "closing" : "open"}
      class="size-full flex flex-col bg-background-base"
    >
      <div
        data-slot="detached-side-panel-header"
        class="h-10 shrink-0 border-b border-border-weaker-base px-3 flex items-center justify-between gap-2"
      >
        <div class="min-w-0 truncate text-13-medium text-text-strong">{record()?.title ?? props.context.tab}</div>
        <div class="flex items-center gap-1">
          <Tooltip value={language.t("session.detached.redock")} placement="bottom">
            <IconButton
              icon="arrow-left"
              variant="ghost"
              class="size-7 rounded-md"
              onClick={redock}
              aria-label={language.t("session.detached.redock")}
            />
          </Tooltip>
        </div>
      </div>
      <div data-slot="detached-side-panel-body" class="flex-1 min-h-0">
        <Show when={props.context.kind === "browser"}>
          <BrowserPanel sessionKey={props.context.sessionKey} tab={props.context.tab} visible />
        </Show>
        <Show when={props.context.kind === "review"}>
          <Show when={record()} fallback={<div class="size-full flex items-center justify-center text-12-regular text-text-weak">{language.t("session.detached.missing")}</div>}>
            {props.reviewPanel()}
          </Show>
        </Show>
        <Show when={props.context.kind === "file"}>
          <Show when={record()} fallback={<div class="size-full flex items-center justify-center text-12-regular text-text-weak">{language.t("session.detached.missing")}</div>}>
            <Show when={readyFile()} fallback={<div class="size-full flex items-center justify-center text-12-regular text-text-weak">{language.t("common.loading")}</div>}>
              <Tabs value={props.context.tab} onChange={() => undefined}>
                <FileTabContent tab={props.context.tab} />
              </Tabs>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
