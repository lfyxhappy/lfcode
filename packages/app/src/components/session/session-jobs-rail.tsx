import { Icon } from "@lfcode-ai/ui/icon"
import { showToast } from "@lfcode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { formatServerError } from "@/utils/server-errors"

const pollMs = 10_000

type BackgroundJob = NonNullable<Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["list"]>>["data"]>[number]
type BackgroundJobDetail = Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["get"]>>["data"]
type BackgroundJobLog = NonNullable<Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["logs"]>>["data"]>[number]
type SessionTask = NonNullable<Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["session"]["task"]>>["data"]>[number]
export type SessionSource = {
  path: string
  title: string
}

const jobTone = (status: BackgroundJob["status"]) => {
  if (status === "running") return "bg-icon-warning-base"
  if (status === "completed") return "bg-icon-success-base"
  return "bg-icon-critical-base"
}

const formatJobTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))

export function SessionJobsRail(props: {
  sessionID: string
  directory: string
  changes: () => number
  sources: () => SessionSource[]
  onOpenChanges: () => void
  onOpenFiles: () => void
  onAttachSources: (paths: string[]) => void
}) {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const [jobs, setJobs] = createSignal<BackgroundJob[]>([])
  const [tasks, setTasks] = createSignal<SessionTask[]>([])
  const [loading, setLoading] = createSignal(true)
  const [planCollapsed, setPlanCollapsed] = createSignal(false)
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

  const refresh = async () => {
    const [jobResult, taskResult] = await Promise.all([
      sdk.client.backgroundJob.list({ sessionID: props.sessionID }),
      sdk.client.session.task({ sessionID: props.sessionID }),
    ])
    setJobs((jobResult.data ?? []).toSorted((a, b) => b.createdAt - a.createdAt))
    setTasks(taskResult.data ?? [])
  }

  createEffect(() => {
    props.sessionID
    let dead = false
    const load = async () => {
      setLoading(true)
      try {
        await refresh()
      } catch (error) {
        if (!dead) fail(error)
      } finally {
        if (!dead) setLoading(false)
      }
    }

    void load()
    const id = window.setInterval(() => void load(), pollMs)
    onCleanup(() => {
      dead = true
      window.clearInterval(id)
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
    const load = async () => {
      if (dead) return
      await refreshDetails(jobID, true)
    }
    void refreshDetails(jobID, false)
    const id = window.setInterval(() => void load(), pollMs)
    onCleanup(() => {
      dead = true
      window.clearInterval(id)
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

  const planItems = createMemo(() => tasks().filter((task) => task.status !== "done" && task.status !== "abandoned"))
  const activeGoal = createMemo(() => sync.data.session_goal[props.sessionID]?.state)
  const hasPlan = createMemo(() => planItems().length > 0 || !!activeGoal()?.objective || !!activeGoal()?.condition)
  const jobItems = createMemo(() =>
    jobs().toSorted((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1
      if (a.status !== "running" && b.status === "running") return 1
      return b.createdAt - a.createdAt
    }),
  )
  const jobCount = createMemo(() => jobItems().length)
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
    <aside
      id="session-jobs-rail"
      data-component="session-jobs-rail"
      aria-label="Plan and background processes"
      class="absolute right-6 top-5 z-40 min-h-0 overflow-y-auto rounded-[28px] bg-surface-base-active p-5 shadow-[0_18px_42px_rgba(0,0,0,0.24)] [width:clamp(304px,20vw,400px)]"
      style={{ "max-height": "calc(100% - 2.5rem)" }}
    >
      <header class="flex items-center justify-between px-1 pb-3 text-14-regular text-text-weak">
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
              class="absolute right-0 top-8 z-50 w-64 rounded-2xl bg-surface-raised-base p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.28)]"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
                onClick={openConnectAppsPlaceholder}
              >
                <Icon name="link" size="small" class="shrink-0 text-icon-weak-base" />
                <span class="min-w-0 flex-1">Connect your favorite apps</span>
                <Icon name="chevron-right" size="small" class="shrink-0 text-icon-weak-base" />
              </button>
              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-13-regular text-text-base transition-colors hover:bg-surface-raised-base-hover"
                onClick={() => void chooseSources()}
              >
                <Icon name="folder" size="small" class="shrink-0 text-icon-weak-base" />
                <span class="min-w-0 flex-1">Attach files or folders</span>
              </button>
            </div>
          </Show>
        </div>
      </header>

      <section class="space-y-1 px-1 pb-1">
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

      <Show when={hasPlan()}>
        <section class="mt-4 border-t border-border-weaker-base pt-4">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
          aria-expanded={!planCollapsed()}
          aria-controls="session-jobs-plan"
          onClick={() => setPlanCollapsed((value) => !value)}
        >
          <span>Plan</span>
          <span class="ml-auto text-12-regular text-text-weak">{planItems().length}</span>
          <Icon name="chevron-down" size="small" class={planCollapsed() ? "-rotate-90" : ""} />
        </button>
        <Show when={!planCollapsed()}>
          <div id="session-jobs-plan" class="mt-1 space-y-1 pb-2">
            <Show
              when={planItems().length > 0 || activeGoal()?.objective || activeGoal()?.condition}
              fallback={<div class="px-2 py-2 text-12-regular text-text-weak">No active plan</div>}
            >
              <Show when={activeGoal()?.objective ?? activeGoal()?.condition}>
                {(goal) => <div class="px-2 pb-1 text-12-medium text-text-base line-clamp-2">{goal()}</div>}
              </Show>
              <For each={planItems()}>
                {(task) => (
                  <div class="flex items-start gap-2 rounded-lg px-1 py-1.5 text-12-regular text-text-weak">
                    <Icon name="checklist" size="small" class="mt-0.5 shrink-0 text-icon-weak-base" />
                    <span class="min-w-0 flex-1 line-clamp-2">{task.summary}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
        </section>
      </Show>

      <Show when={jobItems().length > 0}>
        <section class="mt-4 border-t border-border-weaker-base pt-4">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
          aria-expanded={!processesCollapsed()}
          aria-controls="session-background-processes"
          onClick={() => setProcessesCollapsed((value) => !value)}
        >
          <Icon name="terminal" size="small" class="text-icon-weak-base" />
          <span>Background processes</span>
          <span class="ml-auto text-12-regular text-text-weak">{jobCount()}</span>
          <Icon name="chevron-down" size="small" class={processesCollapsed() ? "-rotate-90" : ""} />
        </button>
        <Show when={!processesCollapsed()}>
          <div id="session-background-processes" class="mt-1 px-1 pb-1">
            <Show when={!loading()} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">Loading...</div>}>
              <Show
                when={jobItems().length > 0}
                fallback={<div class="px-2 py-3 text-12-regular text-text-weak">{language.t("status.popover.jobs.empty")}</div>}
              >
                <div class="max-h-64 space-y-1 overflow-y-auto">
                  <For each={jobItems()}>
                    {(job) => (
                      <div class="relative rounded-xl px-2 py-2 hover:bg-surface-raised-base-hover">
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
                              <div class="absolute right-0 top-7 z-50 w-40 rounded-xl border border-border-weak-base bg-background-base p-1 shadow-[var(--shadow-lg-border-base)]" role="menu">
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
                        <Show when={job.error}>{(error) => <div class="mt-1 line-clamp-2 text-11-regular text-text-danger">{error()}</div>}</Show>
                        <Show when={expandedJobID() === job.id}>
                          <div class="mt-2 rounded-lg border border-border-weak-base bg-background-base px-2 py-2">
                            <Show when={!detailsLoading[job.id]} fallback={<div class="text-11-regular text-text-weak">Loading...</div>}>
                              <Show when={details[job.id]}>
                                {(detail) => (
                                  <div class="text-11-regular text-text-weak">
                                    {detail()?.kind} - {detail()?.source}
                                    <Show when={detail()?.exitCode !== undefined}> - exit {detail()?.exitCode}</Show>
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
        <section class="mt-4 border-t border-border-weaker-base pt-4">
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
        <div class="max-h-40 space-y-1 overflow-y-auto px-1 py-1">
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
  )
}
