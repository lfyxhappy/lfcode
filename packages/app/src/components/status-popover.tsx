import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Popover } from "@lfcode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover(props: { directory?: string; sessionID?: string }) {
  const language = useLanguage()
  const server = useServer()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const tone = createMemo(() => {
    if (server.healthy() === undefined) return "idle"
    if (server.healthy() === false) return "critical"
    if (!sync.data.mcp_ready) return "idle"
    const mcp = Object.values(sync.data.mcp ?? {})
    const connected = mcp.filter((item) => item.status === "connected").length
    const failed = mcp.filter((item) => item.status === "failed" || item.status === "needs_client_registration").length
    if (failed > 0 && connected === 0) {
      return "critical"
    }
    if (mcp.some((item) => item.status === "pending" || item.status === "needs_auth")) return "warning"
    if (failed > 0) return "warning"
    return "success"
  })

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class: "titlebar-icon w-8 h-6 p-0 box-border",
        "aria-label": language.t("status.popover.trigger"),
        style: { scale: 1 },
      }}
      trigger={
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={shown() ? "status-active" : "status"} size="small" />
          </div>
          <div
            classList={{
              "absolute -top-px -right-px size-1.5 rounded-full": true,
              "bg-icon-success-base": tone() === "success",
              "bg-icon-warning-base": tone() === "warning",
              "bg-icon-critical-base": tone() === "critical",
              "bg-border-weak-base": tone() === "idle",
            }}
          />
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <Show when={shown()}>
        <Suspense
          fallback={
            <div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />
          }
        >
          <Body shown={shown} directory={props.directory} sessionID={props.sessionID} />
        </Suspense>
      </Show>
    </Popover>
  )
}
