import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { MotionPresence } from "@lfcode-ai/ui/motion-presence"
import { showToast } from "@lfcode-ai/ui/toast"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useGlobalSDK } from "@/context/global-sdk"
import { startVisiblePolling } from "@/utils/visible-poll"
import { DialogSettings } from "../dialog-settings"

type MaintenanceState = {
  status: "running" | "failed" | "pending-review" | "healthy"
  latest?: {
    id: string
    status: "running" | "completed" | "failed"
    dreamStatus: string
    distillStatus: string
    summary?: string
    errorExcerpt?: string
  }
  pendingCandidates: number
}

type MaintenanceCandidate = {
  id: string
  targetPath?: string
  confidence: number
  proposedSummary: string
}

type PanelPosition = { top: number; right: number }

export function MaintenanceStatusPill(props: { sessionID?: string }) {
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const [open, setOpen] = createSignal(false)
  const [position, setPosition] = createSignal<PanelPosition>({ top: 0, right: 0 })
  const [state, { refetch }] = createResource(async () => {
    try {
      const result = await globalSDK.client.global.maintenance.get()
      return result.data as MaintenanceState
    } catch {
      return undefined
    }
  })
  const [candidates, { refetch: refetchCandidates }] = createResource(open, async () => {
    try {
      const result = await globalSDK.client.global.maintenance.candidates({ status: "new", limit: 6 })
      return result.data as MaintenanceCandidate[]
    } catch {
      return []
    }
  })

  let trigger: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined
  const maintenance = () => state.latest
  const candidateItems = () => candidates.latest ?? []

  const toggle = () => {
    if (open()) {
      setOpen(false)
      return
    }
    if (!trigger) return
    const bounds = trigger.getBoundingClientRect()
    setPosition({ top: Math.round(bounds.bottom + 6), right: Math.round(window.innerWidth - bounds.right) })
    setOpen(true)
  }

  const run = async (jobKind: "full" | "dream" | "distill") => {
    if (!props.sessionID) return
    try {
      await globalSDK.client.global.maintenance.run({ sessionID: props.sessionID, jobKind })
      showToast({ variant: "success", title: "记忆维护已启动", description: "Dream 和 Distill 会在后台顺序执行。" })
      setOpen(false)
      void refetch()
    } catch (error) {
      showToast({ variant: "error", title: "无法启动记忆维护", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const review = async (candidateID: string, status: "approved" | "rejected") => {
    try {
      await globalSDK.client.global.maintenance.candidate.update({ candidateID, status })
      void Promise.all([refetch(), refetchCandidates()])
    } catch (error) {
      showToast({ variant: "error", title: "无法更新候选状态", description: error instanceof Error ? error.message : String(error) })
    }
  }

  onMount(() => {
    const stopPolling = startVisiblePolling(async () => {
      await refetch()
    }, 30_000, { immediate: false })
    const close = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (trigger?.contains(target) || panel?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener("pointerdown", close, true)
    onCleanup(() => {
      stopPolling()
      window.removeEventListener("pointerdown", close, true)
    })
  })

  const indicator = () => {
    if (maintenance()?.latest?.status === "running") return "bg-status-info"
    if (maintenance()?.latest?.status === "failed") return "bg-status-error"
    if ((maintenance()?.pendingCandidates ?? 0) > 0) return "bg-status-warning"
    return "bg-status-success"
  }

  return (
    <Show when={maintenance()}>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        class="hidden lg:flex h-6 items-center gap-1.5 rounded-md border border-border-weak-base bg-surface-panel px-2 text-12-medium text-text-weak shadow-none"
        aria-label="Memory maintenance"
        aria-expanded={open()}
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onClick={toggle}
      >
        <span class={`size-1.5 rounded-full ${indicator()}`} />
        <Icon name="brain" size="small" class="text-icon-weak" />
        <span>Memory</span>
        <Show when={(maintenance()?.pendingCandidates ?? 0) > 0}>
          <span class="text-text-strong">{maintenance()?.pendingCandidates}</span>
        </Show>
      </Button>
      <Portal mount={document.body}>
        <MotionPresence
          present={open()}
          channel="surface"
          ref={(element) => (panel = element)}
          class="fixed z-[10000] w-[280px] rounded-lg border border-border-base bg-surface-raised-stronger-non-alpha p-1.5 shadow-[var(--shadow-xs-border)]"
          style={{ top: `${position().top}px`, right: `${position().right}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
            <div class="px-2 py-1.5">
              <div class="text-12-medium text-text-strong">Memory maintenance</div>
              <div class="mt-0.5 text-11-regular text-text-weak">
                {maintenance()?.latest?.status === "running"
                  ? "Dream / Distill 正在运行"
                  : maintenance()?.latest?.status === "failed"
                    ? maintenance()?.latest?.errorExcerpt ?? "上次维护失败"
                    : maintenance()?.pendingCandidates
                      ? `${maintenance()?.pendingCandidates} 个候选等待审核`
                      : maintenance()?.latest?.summary ?? "今日维护状态正常"}
              </div>
            </div>
            <div class="mx-1 border-t border-border-weak-base" />
            <div class="flex gap-1 p-1">
              <Button size="small" variant="ghost" class="flex-1 text-11-medium" disabled={!props.sessionID} onClick={() => void run("full")}>
                完整维护
              </Button>
              <Button size="small" variant="ghost" class="flex-1 text-11-medium" disabled={!props.sessionID} onClick={() => void run("dream")}>
                Dream
              </Button>
              <Button size="small" variant="ghost" class="flex-1 text-11-medium" disabled={!props.sessionID} onClick={() => void run("distill")}>
                Distill
              </Button>
            </div>
            <div class="px-1 pb-1">
              <Button
                size="small"
                variant="ghost"
                class="w-full text-11-medium"
                onClick={() => {
                  setOpen(false)
                  dialog.show(() => <DialogSettings defaultValue="personalization" />)
                }}
              >
                打开维护诊断
              </Button>
            </div>
            <Show when={candidateItems().length > 0}>
              <div class="mx-1 border-t border-border-weak-base" />
              <div class="px-2 py-1 text-11-medium text-text-weak">待审核候选</div>
              <div class="max-h-48 overflow-y-auto px-1 pb-1">
                <For each={candidateItems()}>
                  {(candidate) => (
                    <div class="rounded-md px-1.5 py-1.5 hover:bg-surface-raised-base-hover">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 text-11-medium text-text-strong line-clamp-2">{candidate.proposedSummary}</div>
                        <span class="shrink-0 text-10-regular text-text-weak">{candidate.confidence}%</span>
                      </div>
                      <Show when={candidate.targetPath}>
                        <div class="mt-0.5 truncate font-mono text-10-regular text-text-weaker">{candidate.targetPath}</div>
                      </Show>
                      <div class="mt-1 flex gap-1">
                        <button
                          type="button"
                          class="rounded px-1.5 py-0.5 text-10-medium text-status-success hover:bg-surface-raised-base-active"
                          onClick={() => void review(candidate.id, "approved")}
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          class="rounded px-1.5 py-0.5 text-10-medium text-text-weak hover:bg-surface-raised-base-active"
                          onClick={() => void review(candidate.id, "rejected")}
                        >
                          忽略
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
        </MotionPresence>
      </Portal>
    </Show>
  )
}
