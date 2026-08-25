import type { SessionContextStatus } from "@lfcode-ai/sdk/v2/client"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { MotionPresence } from "@lfcode-ai/ui/motion-presence"
import { Spinner } from "@lfcode-ai/ui/spinner"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { createEffect, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { contextStatusTone, formatContextStatusTokens } from "./context-status-state"

type PanelPosition = { top: number; right: number }

export function ContextStatusPill(props: { sessionID?: string; directory?: string }) {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [position, setPosition] = createSignal<PanelPosition>({ top: 0, right: 0 })
  const [request, setRequest] = createSignal<{ sessionID: string; directory?: string }>()
  const [status, statusActions] = createResource(request, async (input) => {
    const result = await globalSDK.client.session.contextStatus(input)
    return result.data
  })

  let trigger: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined

  const pressure = (value: SessionContextStatus["pressure"]) => {
    if (value === "rebuild") return language.t("session.context.status.pressure.rebuild")
    if (value === "checkpoint") return language.t("session.context.status.pressure.checkpoint")
    if (value === "monitoring") return language.t("session.context.status.pressure.monitoring")
    return language.t("session.context.status.pressure.idle")
  }

  const source = (value: SessionContextStatus["source"]) => language.t(`session.context.status.source.${value}`)

  const load = () => {
    if (!props.sessionID) return
    setRequest({ sessionID: props.sessionID, directory: props.directory })
  }

  const compact = () => (
    <div class="min-w-[176px] px-1 py-0.5 text-11-regular">
      <div class="flex items-center justify-between gap-3 text-text-invert-strong">
        <span>{language.t("session.context.status.title")}</span>
        <Show when={status()} fallback={<Spinner class="size-3 text-text-invert-base" />}>
          {(value) => <span>{formatContextStatusTokens(value().used_tokens, language.intl())}</span>}
        </Show>
      </div>
      <Show when={status()}>
        {(value) => (
          <div class="mt-1 flex items-center gap-1.5 text-text-invert-base">
            <span class={`size-1.5 rounded-full ${contextStatusTone(value().pressure)}`} />
            <span>{pressure(value().pressure)}</span>
            <Show when={value().usable_tokens !== null}>
              <span>
                · {formatContextStatusTokens(value().usable_tokens!, language.intl())} {language.t("context.usage.tokens")}
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
    props.sessionID
    setOpen(false)
    setRequest(undefined)
    statusActions.mutate(undefined)
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
          onPointerEnter={load}
          onFocus={load}
          onPointerDown={(event: PointerEvent) => event.stopPropagation()}
          onClick={toggle}
        >
          <span class={`size-1.5 rounded-full ${status() ? contextStatusTone(status()!.pressure) : "bg-text-weaker"}`} />
          <Icon name="brain" size="small" class="text-icon-weak" />
          <span>{language.t("session.context.status.compact")}</span>
        </Button>
      </Tooltip>
      <Portal mount={document.body}>
        <MotionPresence
          present={open()}
          channel="surface"
          ref={(element) => (panel = element)}
          class="fixed z-[10000] w-[280px] rounded-lg border border-border-base bg-surface-raised-stronger-non-alpha p-1.5 shadow-[var(--shadow-xs-border)]"
          style={{ top: `${position().top}px`, right: `${position().right}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div class="flex items-start justify-between gap-3 px-2 py-1.5">
            <div>
              <div class="text-12-medium text-text-strong">{language.t("session.context.status.title")}</div>
              <Show
                when={status()}
                fallback={<div class="mt-0.5 text-11-regular text-text-weak">{language.t("session.context.status.description")}</div>}
              >
                {(value) => (
                  <div class="mt-0.5 text-11-regular text-text-weak">
                    {formatContextStatusTokens(value().used_tokens, language.intl())}
                    <Show when={value().usable_tokens !== null}>
                      <span> / {formatContextStatusTokens(value().usable_tokens!, language.intl())}</span>
                    </Show>
                    <span> {language.t("context.usage.tokens")}</span>
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
              onClick={load}
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
          <Show when={!status.loading && status.error}>
            <div class="px-2 py-4 text-11-regular text-status-error">{language.t("session.context.status.unavailable")}</div>
          </Show>
          <Show when={!status.loading && status()}>
            {(value) => (
              <div class="px-2 py-2 text-11-regular">
                <div class="flex items-center justify-between gap-3 py-1">
                  <span class="text-text-weak">{language.t("session.context.status.pressure")}</span>
                  <span class="flex items-center gap-1.5 text-text-strong">
                    <span class={`size-1.5 rounded-full ${contextStatusTone(value().pressure)}`} />
                    {pressure(value().pressure)}
                  </span>
                </div>
                <StatusRow label={language.t("session.context.status.source")} value={source(value().source)} />
                <StatusRow
                  label={language.t("session.context.status.checkpoint")}
                  value={
                    value().checkpoint.writer_running
                      ? language.t("session.context.status.checkpoint.writing")
                      : value().checkpoint.exists
                        ? language.t("session.context.status.checkpoint.ready")
                        : language.t("session.context.status.checkpoint.none")
                  }
                />
                <Show when={value().fallback_reason}>
                  <StatusRow
                    label={language.t("session.context.status.fallback")}
                    value={value().fallback_reason!.replace(/^.+?:\s*/, "").slice(0, 42)}
                  />
                </Show>
              </div>
            )}
          </Show>
        </MotionPresence>
      </Portal>
    </Show>
  )
}

function StatusRow(props: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between gap-3 py-1">
      <span class="text-text-weak">{props.label}</span>
      <span class="min-w-0 truncate text-right text-text-strong">{props.value}</span>
    </div>
  )
}
