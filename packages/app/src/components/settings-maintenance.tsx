import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { showToast } from "@lfcode-ai/ui/toast"
import { For, Show, createResource, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { formatServerError } from "@/utils/server-errors"
import { useLanguage } from "@/context/language"

type Candidate = {
  id: string
  candidateKind: "skill_update" | "skill_create" | "command_update" | "command_create" | "agent_update" | "agent_create" | "skip"
  targetKind: "skill" | "command" | "agent" | "none"
  targetPath?: string
  evidence: string[]
  confidence: number
  proposedSummary: string
  status: "new" | "approved" | "rejected" | "applied" | "stale"
  appliedAt?: number
  updatedAt: number
}

type CandidateEvent = {
  id: string
  action: "approved" | "rejected" | "stale" | "applied" | "apply_failed"
  detail?: Record<string, unknown>
  createdAt: number
}

type MaintenanceRun = {
  id: string
  status: "running" | "completed" | "failed"
  jobKind: "full" | "dream" | "distill"
  dreamStatus: string
  distillStatus: string
  summary?: string
  errorExcerpt?: string
  candidateCount: number
  dreamRecordCount: number
  startedAt: number
}

type SchedulerState = {
  supported: boolean
  registered: boolean
  taskName: string
  lastRunTime?: string
  lastResult?: string
  error?: string
}

export function SettingsMaintenance() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [busyCandidateID, setBusyCandidateID] = createSignal<string>()
  const [selectedCandidateID, setSelectedCandidateID] = createSignal<string>()
  const [diagnostics, { refetch }] = createResource(async () => {
    const [state, runs, candidates, scheduler] = await Promise.all([
      globalSDK.client.global.maintenance.get(),
      globalSDK.client.global.maintenance.runs({ limit: 20 }),
      globalSDK.client.global.maintenance.candidates({ limit: 50 }),
      globalSDK.client.global.maintenance.scheduler.get(),
    ])
    return {
      state: state.data as { pendingCandidates: number },
      runs: runs.data as MaintenanceRun[],
      candidates: candidates.data as Candidate[],
      scheduler: scheduler.data as SchedulerState,
    }
  })
  const [history] = createResource(selectedCandidateID, async (candidateID) => {
    const result = await globalSDK.client.global.maintenance.candidate.history({ candidateID })
    return result.data as CandidateEvent[]
  })

  const refresh = () => void refetch()
  const review = async (candidateID: string, status: "approved" | "rejected") => {
    if (busyCandidateID()) return
    setBusyCandidateID(candidateID)
    try {
      await globalSDK.client.global.maintenance.candidate.update({ candidateID, status })
      await refetch()
    } catch (error) {
      showToast({ variant: "error", title: "无法更新候选", description: formatServerError(error, language.t, language.t("common.requestFailed")) })
    } finally {
      setBusyCandidateID(undefined)
    }
  }
  const apply = async (candidateID: string) => {
    if (busyCandidateID()) return
    setBusyCandidateID(candidateID)
    try {
      await globalSDK.client.global.maintenance.candidate.apply({ candidateID })
      showToast({ variant: "success", title: "Skill 已应用", description: "原文件已保存到维护候选的本地备份中。" })
      await refetch()
    } catch (error) {
      showToast({ variant: "error", title: "无法应用候选", description: formatServerError(error, language.t, language.t("common.requestFailed")) })
    } finally {
      setBusyCandidateID(undefined)
    }
  }
  const openHistory = (candidateID: string) => setSelectedCandidateID((current) => (current === candidateID ? undefined : candidateID))

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[980px] items-start justify-between gap-4 pb-6 pt-6">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">Memory maintenance</h2>
            <p class="text-14-regular text-text-weak">Dream 的 typed memory 写入、Distill 候选审核和应用历史。</p>
          </div>
          <Button size="large" variant="secondary" onClick={refresh} disabled={diagnostics.loading}>
            {diagnostics.loading ? "刷新中" : "刷新"}
          </Button>
        </div>
      </div>

      <Show when={diagnostics.error}>
        <div class="mb-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-3 text-13-regular text-status-warning">
          {formatServerError(diagnostics.error, language.t, language.t("common.requestFailed"))}
        </div>
      </Show>
      <Show when={diagnostics.latest}>
        {(data) => (
          <div class="mx-auto flex w-full max-w-[980px] flex-col gap-8">
            <section class="rounded-[22px] bg-surface-base p-4 shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div class="text-14-medium text-text-strong">维护状态</div>
                  <div class="mt-1 text-12-regular text-text-weak">
                    {data().state.pendingCandidates} 个候选等待审核 · {data().scheduler.registered ? "Windows 每日调度已注册" : "Windows 每日调度未注册"}
                  </div>
                </div>
                <div class="flex items-center gap-2 text-12-regular text-text-weak">
                  <Icon name="status" size="small" />
                  {data().scheduler.lastRunTime ?? data().scheduler.lastResult ?? "尚无调度记录"}
                </div>
              </div>
            </section>

            <section>
              <div class="mb-2 flex items-center justify-between">
                <h3 class="text-14-medium text-text-strong">最近运行</h3>
                <span class="text-12-regular text-text-weak">Dream / Distill</span>
              </div>
              <div class="overflow-hidden rounded-[18px] bg-surface-base">
                <For each={data().runs} fallback={<div class="px-4 py-5 text-13-regular text-text-weak">尚无维护运行记录。</div>}>
                  {(run) => (
                    <div class="border-b border-border-weak-base px-4 py-3 last:border-none">
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-13-medium text-text-strong">{run.jobKind} · {run.status}</div>
                        <span class="text-11-regular text-text-weak">{formatTime(run.startedAt)}</span>
                      </div>
                      <div class="mt-1 text-12-regular text-text-weak">Dream: {run.dreamStatus} · {run.dreamRecordCount} records · Distill: {run.distillStatus} · {run.candidateCount} candidates</div>
                      <Show when={run.summary ?? run.errorExcerpt}>{(text) => <div class="mt-1 text-12-regular text-text-weak line-clamp-2">{text()}</div>}</Show>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section>
              <div class="mb-2 flex items-center justify-between">
                <h3 class="text-14-medium text-text-strong">审核队列与历史</h3>
                <span class="text-12-regular text-text-weak">仅 Skill 候选可受控应用</span>
              </div>
              <div class="overflow-hidden rounded-[18px] bg-surface-base">
                <For each={data().candidates} fallback={<div class="px-4 py-5 text-13-regular text-text-weak">暂无候选。</div>}>
                  {(candidate) => (
                    <div class="border-b border-border-weak-base px-4 py-3 last:border-none">
                      <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                          <div class="text-13-medium text-text-strong">{candidate.proposedSummary}</div>
                          <div class="mt-1 flex flex-wrap gap-x-2 text-11-regular text-text-weak">
                            <span>{candidate.status}</span>
                            <span>{candidate.confidence}%</span>
                            <span>{candidate.candidateKind}</span>
                          </div>
                          <Show when={candidate.targetPath}>{(path) => <div class="mt-1 truncate font-mono text-11-regular text-text-weaker">{path()}</div>}</Show>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <Show when={candidate.status === "new"}>
                            <Button size="small" variant="ghost" disabled={busyCandidateID() === candidate.id} onClick={() => void review(candidate.id, "approved")}>批准</Button>
                            <Button size="small" variant="ghost" disabled={busyCandidateID() === candidate.id} onClick={() => void review(candidate.id, "rejected")}>忽略</Button>
                          </Show>
                          <Show when={candidate.status === "approved" && candidate.targetKind === "skill"}>
                            <Button size="small" variant="secondary" disabled={busyCandidateID() === candidate.id} onClick={() => void apply(candidate.id)}>应用</Button>
                          </Show>
                          <Button size="small" variant="ghost" onClick={() => openHistory(candidate.id)}>历史</Button>
                        </div>
                      </div>
                      <Show when={selectedCandidateID() === candidate.id}>
                        <div class="mt-3 rounded-xl bg-surface-raised-base px-3 py-2 text-11-regular text-text-weak">
                          <Show when={history.loading}><div>正在加载历史...</div></Show>
                          <For each={history.latest ?? []} fallback={<div>该候选尚无审核或应用历史。</div>}>
                            {(event) => <div class="py-0.5">{formatTime(event.createdAt)} · {event.action}{event.detail?.targetPath ? ` · ${String(event.detail.targetPath)}` : ""}</div>}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>
        )}
      </Show>
    </div>
  )
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(value)
}
