import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@lfcode-ai/ui/button"
import { DockTray } from "@lfcode-ai/ui/dock-surface"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { useMotionEnabled } from "@lfcode-ai/ui/motion-presence"
import { useLanguage } from "@/context/language"

export function SessionRevertDock(props: {
  items: { id: string; text: string }[]
  restoring?: string
  disabled?: boolean
  onRestore: (id: string) => void
}) {
  const language = useLanguage()
  const motion = useMotionEnabled()
  const [store, setStore] = createStore({
    collapsed: true,
  })

  createEffect(() => {
    props.items.length
    props.items[0]?.id
    setStore("collapsed", true)
  })

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() =>
    language.t(total() === 1 ? "session.revertDock.summary.one" : "session.revertDock.summary.other", {
      count: total(),
    }),
  )
  const preview = createMemo(() => props.items[0]?.text ?? "")

  return (
    <DockTray data-component="session-revert-dock">
      <div
        class="pl-3 pr-2 py-2 flex items-center gap-2"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="shrink-0 text-14-regular text-text-strong cursor-default">{label()}</span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate text-14-regular text-text-base cursor-default">{preview()}</span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButton
            data-collapsed={store.collapsed ? "true" : "false"}
            icon="chevron-down"
            size="normal"
            variant="ghost"
            style={{
              transform: `rotate(${store.collapsed ? 180 : 0}deg)`,
              transition: motion() ? "transform var(--motion-micro-ms) var(--motion-ease-out)" : undefined,
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            aria-label={
              store.collapsed ? language.t("session.revertDock.expand") : language.t("session.revertDock.collapse")
            }
          />
        </div>
      </div>

      <Show when={store.collapsed}>
        <div class="h-5" aria-hidden="true" />
      </Show>

      <div
        data-slot="session-revert-content"
        aria-hidden={store.collapsed}
        inert={store.collapsed}
        classList={{
          "grid overflow-hidden": true,
          "pointer-events-none": store.collapsed,
        }}
        style={{
          "grid-template-rows": store.collapsed ? "0fr" : "1fr",
          opacity: store.collapsed ? 0 : 1,
          transition: motion()
            ? "grid-template-rows var(--motion-content-ms) var(--motion-ease-out), opacity var(--motion-micro-ms) var(--motion-ease-out)"
            : undefined,
        }}
      >
        <div class="min-h-0 overflow-hidden">
          <div class="px-3 pb-7 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar">
            <For each={props.items}>
              {(item) => (
                <div class="flex items-center gap-2 min-w-0 py-1">
                  <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">{item.text}</span>
                  <Button
                    size="small"
                    variant="secondary"
                    class="shrink-0"
                    disabled={props.disabled || !!props.restoring}
                    onClick={() => props.onRestore(item.id)}
                  >
                    {language.t("session.revertDock.restore")}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </DockTray>
  )
}
