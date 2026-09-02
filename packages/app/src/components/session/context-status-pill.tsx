import type { SessionContextStatus } from "@lfcode-ai/sdk/v2/client"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { MotionPresence } from "@lfcode-ai/ui/motion-presence"
import { Spinner } from "@lfcode-ai/ui/spinner"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import {
  contextStatusTone,
  formatContextStatusTokens,
  isCurrentContextStatusRequest,
  type ContextStatusRequest,
} from "./context-status-state"

type PanelPosition = { top: number; right: number }

type ContextStatusValue = SessionContextStatus & {
  active_context_tokens?: number
  context_window_tokens?: number | null
  context_percentage?: number | null
  remaining_context_tokens?: number | null
  provider_id?: string | null
  model_id?: string | null
  measured_at?: number | null
  measurement_source?: string
  projection: SessionContextStatus["projection"] & {
    media_tokens: number
    reasoning_tokens: number
    tool_result_tokens: number
    message_tokens: number
    other_tokens: number
  }
}

export function ContextStatusPill(props: { sessionID?: string; directory?: string }) {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [position, setPosition] = createSignal<PanelPosition>({ top: 0, right: 0 })
  const [request, setRequest] = createSignal<ContextStatusRequest>()
  let requestKey: string | undefined
  let requestGeneration = 0
  const [displayStatus, setDisplayStatus] = createSignal<ContextStatusValue>()
  const [status] = createResource(request, async (input) => {
    const result = await globalSDK.client.session.contextStatus({ sessionID: input.sessionID, directory: input.directory })
    if (isCurrentContextStatusRequest(input, requestGeneration)) setDisplayStatus(result.data)
    return result.data
  })

  let trigger: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined
  const [pendingStepRefresh, setPendingStepRefresh] = createSignal(false)
  let lastStepFinishID: string | undefined

  const pressure = (value: SessionContextStatus["pressure"]) => {
    if (value === "rebuild") return language.t("session.context.status.pressure.rebuild")
    if (value === "checkpoint") return language.t("session.context.status.pressure.checkpoint")
    if (value === "monitoring") return language.t("session.context.status.pressure.monitoring")
    return language.t("session.context.status.pressure.idle")
  }

  const load = (force = false) => {
    if (!props.sessionID) return
    const key = `${props.sessionID}\u0000${props.directory ?? ""}`
    if (!force && requestKey === key && (status.loading || displayStatus())) return
    requestKey = key
    setRequest({ sessionID: props.sessionID, directory: props.directory, generation: ++requestGeneration })
  }

  createEffect(() => {
    if (status.loading || !pendingStepRefresh()) return
    setPendingStepRefresh(false)
    load(true)
  })

  const compact = () => (
    <div class="min-w-[176px] px-1 py-0.5 text-11-regular">
      <div class="flex items-center justify-between gap-3 text-text-invert-strong">
        <span>{language.t("session.context.status.title")}</span>
        <Show when={displayStatus()} fallback={<Spinner class="size-3 text-text-invert-base" />}>
          {(value) => <span>{formatContextStatusTokens(activeTokens(value()), language.intl())}</span>}
        </Show>
      </div>
      <Show when={displayStatus()}>
        {(value) => (
          <div class="mt-1 flex items-center gap-1.5 text-text-invert-base">
            <span class={`size-1.5 rounded-full ${contextStatusTone(value().pressure)}`} />
            <span>{pressure(value().pressure)}</span>
            <Show when={fullWindow(value()) !== null}>
              <span>
                · {formatContextStatusTokens(fullWindow(value())!, language.intl())} {language.t("context.usage.tokens")}
              </span>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )

  const toggle = () => {
    if (open()) {
      setOpen(false)
      return
    }
    if (!trigger) return
    const bounds = trigger.getBoundingClientRect()
    setPosition({ top: Math.round(bounds.bottom + 6), right: Math.round(window.innerWidth - bounds.right) })
    setOpen(true)
    load()
  }

  createEffect(() => {
    const sessionID = props.sessionID
    setOpen(false)
    setDisplayStatus(undefined)
    if (!sessionID) {
      requestKey = undefined
      setRequest(undefined)
      return
    }
    requestKey = `${sessionID}\u0000${props.directory ?? ""}`
    setRequest({ sessionID, directory: props.directory, generation: ++requestGeneration })
  })

  createEffect(() => {
    const unsubscribe = sdk.event.on("message.part.updated", (event) => {
      const part = event.properties.part
      if (part.sessionID !== props.sessionID || part.type !== "step-finish") return
      if (lastStepFinishID === part.id) return
      lastStepFinishID = part.id
      if (status.loading) {
        setPendingStepRefresh(true)
        return
      }
      load(true)
    })
    onCleanup(unsubscribe)
  })

  // Step-finish events are intentionally not part of the global sync reducer,
  // and detached/background sessions can miss an event while reconnecting.
  // Keep a low-frequency active-session refresh as a correctness backstop.
  createEffect(() => {
    if (!props.sessionID) return
    const timer = window.setInterval(() => {
      if (!status.loading) load(true)
    }, 5000)
    onCleanup(() => window.clearInterval(timer))
  })

  onMount(() => {
    const close = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (trigger?.contains(target) || panel?.contains(target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", close, true)
    window.addEventListener("keydown", escape)
    onCleanup(() => {
      window.removeEventListener("pointerdown", close, true)
      window.removeEventListener("keydown", escape)
    })
  })

  return (
    <Show when={props.sessionID}>
      <Tooltip placement="bottom" value={compact()}>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          class="hidden lg:flex h-6 items-center gap-1.5 rounded-md border border-border-weak-base bg-surface-panel px-2 text-12-medium text-text-weak shadow-none"
          aria-label={language.t("session.context.status.trigger")}
          aria-expanded={open()}
          onPointerDown={(event: PointerEvent) => event.stopPropagation()}
          onClick={toggle}
        >
          <span class={`size-1.5 rounded-full ${displayStatus() ? contextStatusTone(displayStatus()!.pressure) : "bg-text-weaker"}`} />
          <Icon name="brain" size="small" class="text-icon-weak" />
          <span>{language.t("session.context.status.compact")}</span>
          <span class="min-w-[2.5rem] text-right tabular-nums text-text-base">
            <Show when={displayStatus()} fallback={<Show when={status.loading} fallback="-"><Spinner class="size-3 text-text-weaker" /></Show>}>
              {(value) => formatPercentage(value())}
            </Show>
          </span>
        </Button>
      </Tooltip>
      <Portal mount={document.body}>
        <MotionPresence
          present={open()}
          channel="surface"
          ref={(element) => (panel = element)}
          class="fixed z-[10000] w-[320px] max-w-[calc(100vw-16px)] rounded-lg border border-border-base bg-surface-raised-stronger-non-alpha p-1.5 shadow-[var(--shadow-xs-border)]"
          style={{ top: `${position().top}px`, right: `${position().right}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div class="flex items-start justify-between gap-3 px-2 py-1.5">
            <div>
              <div class="text-12-medium text-text-strong">{language.t("session.context.status.title")}</div>
              <Show
                when={displayStatus()}
                fallback={<div class="mt-0.5 text-11-regular text-text-weak">{language.t("session.context.status.description")}</div>}
              >
                {(value) => (
                  <div class="mt-0.5 text-11-regular text-text-weak">
                    {formatContextStatusTokens(activeTokens(value()), language.intl())}
                    <Show when={fullWindow(value()) !== null}>
                      <span> / {formatContextStatusTokens(fullWindow(value())!, language.intl())}</span>
                    </Show>
                    <span> {language.t("context.usage.tokens")}</span>
                    <Show when={percentage(value()) !== null}>
                      <span> · {percentage(value())}%</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="h-6 px-1.5 text-11-medium"
              disabled={status.loading}
              onClick={() => load(true)}
            >
              <Show when={status.loading} fallback={language.t("session.context.status.refresh")}>
                <Spinner class="size-3" />
              </Show>
            </Button>
          </div>
          <div class="mx-1 border-t border-border-weak-base" />
          <Show when={status.loading}>
            <div class="flex items-center gap-2 px-2 py-5 text-11-regular text-text-weak">
              <Spinner class="size-3" />
              {language.t("session.context.status.loading")}
            </div>
          </Show>
          <Show when={!status.loading && status.error && !displayStatus()}>
            <div class="px-2 py-4 text-11-regular text-status-error">{language.t("session.context.status.unavailable")}</div>
          </Show>
          <Show when={displayStatus()}>
            {(value) => {
              const rows = () => [
                { label: "工具结果", tokens: value().projection.tool_result_tokens ?? 0, tone: "bg-[#4d8ed8]" },
                { label: "推理", tokens: value().projection.reasoning_tokens ?? 0, tone: "bg-[#3f7fc7]" },
                { label: "附件", tokens: value().projection.media_tokens ?? 0, tone: "bg-[#356eae]" },
                { label: "消息", tokens: value().projection.message_tokens ?? 0, tone: "bg-[#2c5c91]" },
                { label: "其他", tokens: value().projection.other_tokens ?? 0, tone: "bg-[#244a74]" },
              ]
              return (
                <div class="px-2 py-2 text-11-regular">
                  <div class="mb-3 flex items-baseline justify-between gap-3">
                    <span class="text-16-medium text-text-strong">上下文容量</span>
                    <span class="text-13-medium tabular-nums text-text-strong">
                      {formatContextStatusTokens(activeTokens(value()), language.intl())}
                      <Show when={fullWindow(value()) !== null}>
                        <span>/{formatContextStatusTokens(fullWindow(value())!, language.intl())}</span>
                      </Show>
                      <Show when={percentage(value()) !== null}>
                        <span> ({percentage(value())}%)</span>
                      </Show>
                    </span>
                  </div>
                  <div class="mb-4 h-2 overflow-hidden rounded-full bg-surface-raised-base">
                    <div
                      class={`h-full rounded-full transition-[width] duration-300 ${contextStatusTone(value().pressure)}`}
                      style={{ width: `${Math.min(100, Math.max(0, percentage(value()) ?? 0))}%` }}
                    />
                  </div>
                  <div class="flex flex-col gap-2.5">
                    <For each={rows()}>
                      {(row) => {
                        const ratio = () => {
                          const total = rows().reduce((sum, item) => sum + item.tokens, 0)
                          return total > 0 ? Math.round((row.tokens / total) * 100) : 0
                        }
                        return (
                          <div class="flex items-center gap-2">
                            <span class={`size-2.5 shrink-0 rounded-full ${row.tone}`} />
                            <span class="min-w-0 flex-1 text-13-regular text-text-weak">{row.label}</span>
                            <span class="text-13-medium tabular-nums text-text-strong">{ratio()}%</span>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                  <div class="my-4 h-px bg-border-weak-base" />
                  <div class="flex items-center justify-between gap-3 text-13-regular">
                    <span class="text-text-weak">平均缓存命中率</span>
                    <span class="text-text-strong">
                      {value().cache_hit_rate === null || value().cache_hit_rate === undefined ? "-" : `${value().cache_hit_rate}%`}
                    </span>
                  </div>
                  <div class="mt-2 flex items-center justify-between gap-3 text-11-regular">
                    <span class="text-text-weaker">剩余容量</span>
                    <span class="tabular-nums text-text-weak">
                      {remaining(value()) === null
                        ? "-"
                        : `${formatContextStatusTokens(remaining(value())!, language.intl())} ${language.t("context.usage.tokens")}`}
                    </span>
                  </div>
                </div>
              )
            }}
          </Show>
        </MotionPresence>
      </Portal>
    </Show>
  )
}

function activeTokens(value: ContextStatusValue) {
  return value.active_context_tokens ?? value.used_tokens
}

function fullWindow(value: ContextStatusValue) {
  return value.context_window_tokens ?? value.usable_tokens
}

function percentage(value: ContextStatusValue) {
  if (value.context_percentage !== undefined && value.context_percentage !== null) return value.context_percentage
  const full = fullWindow(value)
  if (!full) return null
  return Math.round((activeTokens(value) / full) * 1000) / 10
}

function formatPercentage(value: ContextStatusValue) {
  const next = percentage(value)
  return next === null ? "-" : `${next}%`
}

function remaining(value: ContextStatusValue) {
  if (value.remaining_context_tokens !== undefined && value.remaining_context_tokens !== null) return value.remaining_context_tokens
  const full = fullWindow(value)
  return full === null ? null : Math.max(0, full - activeTokens(value))
}
