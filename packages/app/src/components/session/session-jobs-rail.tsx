import { Icon } from "@lfcode-ai/ui/icon"
import { showToast } from "@lfcode-ai/ui/toast"
import type { Message, Part } from "@lfcode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { formatServerError } from "@/utils/server-errors"
import { startVisiblePolling } from "@/utils/visible-poll"
import { DeepResearchRail } from "./deep-research-rail"
import { SessionPerformanceCard } from "./session-performance-card"
import { SubagentDispatchRail } from "./subagent-dispatch-rail"
import { actorDispatchesFromActivities, type ActorDispatch } from "../subagent-api"
import type { HookRunActivity } from "@/context/global-sync/types"

const pollMs = 10_000

type BackgroundJob = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["list"]>>["data"]
>[number]
type BackgroundJobDetail = Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["get"]>>["data"]
type BackgroundJobLog = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["logs"]>>["data"]
>[number]
export type SessionSource = {
  path: string
  title: string
}

type SessionActor = {
  actorID: string
  description: string
  status: string
  agent?: string
  mode: string
  visible?: boolean
}

const jobTone = (status: BackgroundJob["status"]) => {
  if (status === "running") return "bg-icon-warning-base"
  if (status === "completed") return "bg-icon-interactive-base"
  return "bg-icon-critical-base"
}

const formatJobTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))

export function createNonBlockingRefreshGate() {
  let refreshing = false
  let initial = true

  return {
    begin() {
      if (refreshing) return
      refreshing = true
      return { initial }
    },
    finish() {
      refreshing = false
      initial = false
    },
  }
}

function sameBackgroundJob(left: BackgroundJob, right: BackgroundJob) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.status === right.status &&
    left.createdAt === right.createdAt &&
    left.pid === right.pid &&
    left.error === right.error
  )
}

function reconcileBackgroundJobs(current: BackgroundJob[], next: BackgroundJob[]) {
  const previous = new Map(current.map((job) => [job.id, job]))
  const reconciled = next.map((job) => {
    const existing = previous.get(job.id)
    return existing && sameBackgroundJob(existing, job) ? existing : job
  })
  return reconciled.length === current.length && reconciled.every((job, index) => job === current[index])
    ? current
    : reconciled
}

export function SessionJobsRail(props: {
  sessionID: string
  directory: string
  messages: () => Message[]
  parts: () => Record<string, Part[]>
  actors: () => SessionActor[]
  changes: () => number
  sources: () => SessionSource[]
  onOpenChanges: () => void
  onOpenFiles: () => void
  onAttachSources: (paths: string[]) => void
  onOpenSubagent: (actorID: string) => void
}) {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const [jobs, setJobs] = createSignal<BackgroundJob[]>([])
  const [loading, setLoading] = createSignal(true)
  const [processesCollapsed, setProcessesCollapsed] = createSignal(false)
  const [expandedJobID, setExpandedJobID] = createSignal<string>()
  const [openJobMenuID, setOpenJobMenuID] = createSignal<string>()
  const [sourceMenuOpen, setSourceMenuOpen] = createSignal(false)
  const [actionJobID, setActionJobID] = createSignal<string>()
  const [details, setDetails] = createStore({} as Record<string, BackgroundJobDetail | undefined>)
  const [logs, setLogs] = createStore({} as Record<string, BackgroundJobLog[] | undefined>)
  const [detailsLoading, setDetailsLoading] = createStore({} as Record<string, boolean | undefined>)

  const fail = (error: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(error, language.t, language.t("common.requestFailed")),
    })
  }

  const dispatches = createMemo<ActorDispatch[]>(() =>
    actorDispatchesFromActivities(sync.data.activity?.[props.sessionID] ?? []),
  )
  const refreshDispatches = async () => undefined

  const refresh = async () => {
    const jobResult = await sdk.client.backgroundJob.list({ sessionID: props.sessionID })
    const nextJobs = (jobResult.data ?? []).toSorted((a, b) => b.createdAt - a.createdAt)
    setJobs((current) => reconcileBackgroundJobs(current, nextJobs))
  }

  createEffect(() => {
    props.sessionID
    let dead = false
    const refreshGate = createNonBlockingRefreshGate()
    const load = async () => {
      const attempt = refreshGate.begin()
      if (!attempt) return
      if (attempt.initial) setLoading(true)
      try {
        await refresh()
      } catch (error) {
        if (!dead) fail(error)
      } finally {
        refreshGate.finish()
        if (!dead && attempt.initial) setLoading(false)
      }
    }

    const stopPolling = startVisiblePolling(load, pollMs)
    onCleanup(() => {
      dead = true
      stopPolling()
    })
  })

  createEffect(() => {
    if (!openJobMenuID() && !sourceMenuOpen()) return
    const close = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest("[data-session-job-menu], [data-session-source-menu]")) return
      setOpenJobMenuID()
      setSourceMenuOpen(false)
    }
    window.addEventListener("pointerdown", close)
    onCleanup(() => window.removeEventListener("pointerdown", close))
  })

  const refreshDetails = async (jobID: string, incremental: boolean) => {
    setDetailsLoading(jobID, true)
    try {
      const detail = await sdk.client.backgroundJob.get({ jobID })
      const current = logs[jobID] ?? []
      const afterSeq = incremental ? current[current.length - 1]?.seq : undefined
      const result = await sdk.client.backgroundJob.logs({
        jobID,
        ...(afterSeq === undefined ? {} : { afterSeq }),
      })
      setDetails(jobID, detail.data)
      if (incremental && afterSeq !== undefined) {
        setLogs(jobID, [...current, ...(result.data ?? [])])
        return
      }
      setLogs(jobID, result.data ?? [])
    } catch (error) {
      fail(error)
    } finally {
      setDetailsLoading(jobID, false)
    }
  }

  createEffect(() => {
    const jobID = expandedJobID()
    if (!jobID) return
    let dead = false
    let initial = true
    const load = async () => {
      if (dead) return
      if (initial) {
        initial = false
        await refreshDetails(jobID, false)
        return
      }
      await refreshDetails(jobID, true)
    }
    const stopPolling = startVisiblePolling(load, pollMs)
    onCleanup(() => {
      dead = true
      stopPolling()
    })
  })

  const cancel = async (jobID: string) => {
    setActionJobID(jobID)
    try {
      await sdk.client.backgroundJob.cancel({ jobID })
      await refresh()
      if (expandedJobID() === jobID) await refreshDetails(jobID, false)
    } catch (error) {
      fail(error)
    } finally {
      setActionJobID()
    }
  }

  const reconcile = async (jobID: string) => {
    setActionJobID(jobID)
    try {
      await sdk.client.backgroundJob.reconcile({ jobID })
      await refresh()
      if (expandedJobID() === jobID) await refreshDetails(jobID, false)
    } catch (error) {
      fail(error)
    } finally {
      setActionJobID()
    }
  }

  const jobItems = createMemo(() =>
    jobs().toSorted((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1
      if (a.status !== "running" && b.status === "running") return 1
      return b.createdAt - a.createdAt
    }),
  )
  const jobCount = createMemo(() => jobItems().length)
  const hookRuns = createMemo<HookRunActivity[]>(() => {
    const activities = sync.data.activity?.[props.sessionID] ?? []
    const hooks = activities
      .filter((item) => item.kind === "hook" && item.hookID && item.hookName && item.event)
      .map((item) => ({
        hookID: item.hookID!,
        hookName: item.hookName!,
        event: item.event!,
        status: (item.status ?? "started") as HookRunActivity["status"],
        durationMs: item.durationMs ?? 0,
        summary: item.summary ?? item.title ?? "",
        timeCreated: item.createdAt,
      }))
    return hooks.length > 0 ? hooks : (sync.data.hook_run?.[props.sessionID] ?? [])
  })
  const openDirectory = () => {
    if (!platform.openPath) return
    void platform.openPath(props.directory)
  }
  const chooseSources = async () => {
    setSourceMenuOpen(false)
    try {
      const selected = platform.openAttachmentPickerDialog
        ? await platform.openAttachmentPickerDialog({ multiple: true, title: "Attach files or folders" })
        : await platform.openFilePickerDialog?.({ multiple: true, title: "Attach files or folders" })
      const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []
      if (paths.length > 0) props.onAttachSources(paths)
    } catch (error) {
      fail(error)
    }
  }
  const openConnectAppsPlaceholder = () => {
    setSourceMenuOpen(false)
    showToast({
      title: "Connect your favorite apps",
      description: "App connectors are not available yet.",
    })
  }
  const openSource = (source: SessionSource) => {
    if (!platform.openPath) return
    void platform.openPath(source.path)
  }

  return (
    <div class="absolute bottom-5 right-5 top-4 z-40 flex min-h-0 flex-col gap-3 [width:clamp(288px,20vw,360px)]">
      <aside
        id="session-jobs-rail"
        data-component="session-jobs-rail"
        aria-label="环境和 Shell processes"
        class="min-h-0 flex-1 overflow-y-auto no-scrollbar rounded-[24px] bg-surface-raised-base p-4"
        style={{ "background-color": "var(--surface-raised-base)" }}
      >
        <header class="flex items-center justify-between px-1 pb-2 text-14-regular text-text-weak">
          <span>Environment</span>
          <div class="relative" data-session-source-menu>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg text-icon-weak-base transition-colors hover:bg-surface-raised-base-hover hover:text-icon-base"
              aria-label="Add sources"
              aria-haspopup="menu"
              aria-expanded={sourceMenuOpen()}
              onClick={() => setSourceMenuOpen((value) => !value)}
            >
              <Icon name="plus" size="small" />
            </button>
            <Show when={sourceMenuOpen()}>
              <div
                class="absolute right-0 top-8 z-50 w-64 rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--shadow-lg-border-base)]"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
                  onClick={openConnectAppsPlaceholder}
                >
                  <Icon name="link" size="small" class="shrink-0 text-icon-weak-base" />
                  <span class="min-w-0 flex-1">Connect your favorite apps</span>
                  <Icon name="chevron-right" size="small" class="shrink-0 text-icon-weak-base" />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
                  onClick={() => void chooseSources()}
                >
                  <Icon name="folder" size="small" class="shrink-0 text-icon-weak-base" />
                  <span class="min-w-0 flex-1">Attach files or folders</span>
                </button>
              </div>
            </Show>
          </div>
        </header>

        <section class="space-y-1 rounded-xl bg-surface-raised-base p-2">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
            onClick={props.onOpenChanges}
          >
            <Icon name="checklist" size="small" class="shrink-0 text-icon-weak-base" />
            <span>Changes</span>
            <span class="ml-auto text-12-regular text-text-weak">{props.changes()}</span>
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
            onClick={openDirectory}
          >
            <Icon name="folder" size="small" class="shrink-0 text-icon-weak-base" />
            <span>Local</span>
            <Icon name="chevron-right" size="small" class="ml-auto text-icon-weak-base" />
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
            onClick={props.onOpenFiles}
          >
            <Icon name="folder" size="small" class="shrink-0 text-icon-weak-base" />
            <span>Files</span>
            <Icon name="chevron-right" size="small" class="ml-auto text-icon-weak-base" />
          </button>
        </section>

        <DeepResearchRail
          sessionID={props.sessionID}
          directory={props.directory}
          dispatches={dispatches}
          onRefresh={refreshDispatches}
          onOpenSubagent={props.onOpenSubagent}
        />

        <SubagentDispatchRail
          sessionID={props.sessionID}
          directory={props.directory}
          dispatches={dispatches}
          onRefresh={refreshDispatches}
          actors={props.actors}
          onOpenSubagent={props.onOpenSubagent}
        />

        <Show when={hookRuns().length > 0}>
          <section class="mt-3 rounded-xl bg-surface-raised-base p-2">
            <div class="flex items-center gap-2 px-1 py-1.5 text-13-regular text-text-weak">
              <Icon name="status" size="small" class="text-icon-weak-base" />
              <span>Hook 活动</span>
              <span class="ml-auto text-12-regular">{hookRuns().length}</span>
            </div>
            <div class="mt-1 space-y-1">
              <For each={hookRuns()}>
                {(run) => (
                  <div class="rounded-lg bg-surface-base px-2 py-1.5">
                    <div class="flex min-w-0 items-center gap-2 text-12-medium text-text-base">
                      <span
                        class={`size-1.5 shrink-0 rounded-full ${run.status === "blocked" ? "bg-icon-critical-base" : run.status === "completed" ? "bg-icon-interactive-base" : "bg-icon-warning-base"}`}
                      />
                      <span class="truncate">
                        {run.event} · {run.hookName}
                      </span>
                      <span class="ml-auto shrink-0 text-11-regular text-text-weak">{run.durationMs}ms</span>
                    </div>
                    <div class="mt-0.5 truncate text-11-regular text-text-weak">{run.summary}</div>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={jobItems().length > 0}>
          <section class="mt-3 rounded-xl bg-surface-raised-base p-2">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
              aria-expanded={!processesCollapsed()}
              aria-controls="session-background-processes"
              onClick={() => setProcessesCollapsed((value) => !value)}
            >
              <Icon name="terminal" size="small" class="text-icon-weak-base" />
              <span>Shell processes</span>
              <span class="ml-auto text-12-regular text-text-weak">{jobCount()}</span>
              <Icon name="chevron-down" size="small" class={processesCollapsed() ? "-rotate-90" : ""} />
            </button>
            <Show when={!processesCollapsed()}>
              <div id="session-background-processes" class="mt-1 px-1 pb-1">
                <Show
                  when={!loading()}
                  fallback={<div class="px-2 py-3 text-12-regular text-text-weak">Loading...</div>}
                >
                  <Show
                    when={jobItems().length > 0}
                    fallback={
                      <div class="px-2 py-3 text-12-regular text-text-weak">
                        {language.t("status.popover.jobs.empty")}
                      </div>
                    }
                  >
                    <div class="max-h-64 space-y-1 overflow-y-auto no-scrollbar">
                      <For each={jobItems()}>
                        {(job) => (
                          <div class="relative rounded-lg px-2 py-2 hover:bg-surface-raised-base-hover">
                            <div class="flex min-w-0 items-start gap-2">
                              <span class={`mt-1.5 size-1.5 shrink-0 rounded-full ${jobTone(job.status)}`} />
                              <button
                                type="button"
                                class="min-w-0 flex-1 text-left"
                                onClick={() => setExpandedJobID(expandedJobID() === job.id ? undefined : job.id)}
                              >
                                <div class="truncate text-12-medium text-text-base">{job.title}</div>
                                <div class="mt-1 flex flex-wrap gap-x-1.5 text-11-regular text-text-weak">
                                  <span>{job.status}</span>
                                  <span>{formatJobTime(job.createdAt)}</span>
                                  <Show when={job.pid !== undefined}>{(pid) => <span>pid {pid()}</span>}</Show>
                                </div>
                              </button>
                              <div class="relative shrink-0" data-session-job-menu>
                                <button
                                  type="button"
                                  class="flex size-6 items-center justify-center rounded-md text-text-weak hover:bg-surface-base hover:text-text-base"
                                  aria-label={`Actions for ${job.title}`}
                                  aria-expanded={openJobMenuID() === job.id}
                                  aria-haspopup="menu"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setOpenJobMenuID(openJobMenuID() === job.id ? undefined : job.id)
                                  }}
                                >
                                  <span class="flex gap-0.5" aria-hidden="true">
                                    <span class="size-1 rounded-full bg-current" />
                                    <span class="size-1 rounded-full bg-current" />
                                    <span class="size-1 rounded-full bg-current" />
                                  </span>
                                </button>
                                <Show when={openJobMenuID() === job.id}>
                                  <div
                                    class="absolute right-0 top-7 z-50 w-40 rounded-lg border border-border-weak-base bg-background-base p-1 shadow-[var(--shadow-lg-border-base)]"
                                    role="menu"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      class="w-full rounded-lg px-2 py-1.5 text-left text-12-regular text-text-base hover:bg-surface-raised-base-hover"
                                      onClick={() => {
                                        setOpenJobMenuID()
                                        setExpandedJobID(job.id)
                                        void refreshDetails(job.id, false)
                                      }}
                                    >
                                      Open output
                                    </button>
                                    <Show when={job.status === "running"}>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={actionJobID() === job.id}
                                        class="w-full rounded-lg px-2 py-1.5 text-left text-12-regular text-text-base hover:bg-surface-raised-base-hover disabled:text-text-weak"
                                        onClick={() => {
                                          setOpenJobMenuID()
                                          void cancel(job.id)
                                        }}
                                      >
                                        {language.t("common.cancel")}
                                      </button>
                                    </Show>
                                    <Show when={job.status !== "running"}>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={actionJobID() === job.id}
                                        class="w-full rounded-lg px-2 py-1.5 text-left text-12-regular text-text-base hover:bg-surface-raised-base-hover disabled:text-text-weak"
                                        onClick={() => {
                                          setOpenJobMenuID()
                                          void reconcile(job.id)
                                        }}
                                      >
                                        {language.t("status.popover.jobs.reconcile")}
                                      </button>
                                    </Show>
                                  </div>
                                </Show>
                              </div>
                            </div>
                            <Show when={job.error}>
                              {(error) => (
                                <div class="mt-1 line-clamp-2 text-11-regular text-text-danger">{error()}</div>
                              )}
                            </Show>
                            <Show when={expandedJobID() === job.id}>
                              <div class="mt-2 rounded-lg border border-border-weak-base bg-background-base px-2 py-2">
                                <Show
                                  when={!detailsLoading[job.id]}
                                  fallback={<div class="text-11-regular text-text-weak">Loading...</div>}
                                >
                                  <Show when={details[job.id]}>
                                    {(detail) => (
                                      <div class="text-11-regular text-text-weak">
                                        {detail()?.kind} - {detail()?.source}
                                        <Show when={detail()?.exitCode !== undefined}>
                                          {" "}
                                          - exit {detail()?.exitCode}
                                        </Show>
                                      </div>
                                    )}
                                  </Show>
                                  <Show when={(logs[job.id] ?? []).length > 0}>
                                    <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-text-base">
                                      <For each={logs[job.id] ?? []}>{(entry) => <div>{entry.text}</div>}</For>
                                    </pre>
                                  </Show>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={props.sources().length > 0}>
          <section class="mt-3 rounded-xl bg-surface-raised-base p-2">
            <div class="flex items-center justify-between px-1 py-1.5 text-13-regular text-text-weak">
              <button
                type="button"
                class="rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-surface-raised-base-hover hover:text-text-base"
                aria-label="Add sources"
                onClick={() => setSourceMenuOpen((value) => !value)}
              >
                Sources
              </button>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-md text-icon-weak-base transition-colors hover:bg-surface-raised-base-hover hover:text-icon-base"
                aria-label="Add sources"
                onClick={() => setSourceMenuOpen((value) => !value)}
              >
                <Icon name="plus" size="small" />
              </button>
            </div>
            <div class="max-h-40 space-y-1 overflow-y-auto no-scrollbar px-1 py-1">
              <For each={props.sources()}>
                {(source) => (
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-12-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
                    title={source.path}
                    onClick={() => openSource(source)}
                  >
                    <Icon name="folder" size="small" class="shrink-0 text-icon-weak-base" />
                    <span class="min-w-0 flex-1 truncate">{source.title}</span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>
      </aside>
      <SessionPerformanceCard sessionID={props.sessionID} messages={props.messages} parts={props.parts} />
    </div>
  )
}
