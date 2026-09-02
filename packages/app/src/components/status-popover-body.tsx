import { Button } from "@lfcode-ai/ui/button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Icon } from "@lfcode-ai/ui/icon"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@lfcode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"
import { formatServerError } from "@/utils/server-errors"
import { startVisiblePolling } from "@/utils/visible-poll"

const pollMs = 10_000

type BackgroundJobItem = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["list"]>>["data"]
>[number]
type BackgroundJobDetail = Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["get"]>>["data"]
type BackgroundJobLogItem = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["backgroundJob"]["logs"]>>["data"]
>[number]
type SessionTaskItem = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["session"]["task"]>>["data"]
>[number]

const tOr = (language: ReturnType<typeof useLanguage>, key: string, fallback: string) => {
  const value = language.t(key)
  if (value === key) return fallback
  return value
}

const backgroundJobTone = (status: BackgroundJobItem["status"]) => {
  if (status === "running") return "bg-icon-warning-base"
  if (status === "completed") return "bg-icon-success-base"
  return "bg-icon-critical-base"
}

const backgroundJobStatusLabel = (language: ReturnType<typeof useLanguage>, status: BackgroundJobItem["status"]) => {
  if (status === "running") return tOr(language, "status.popover.jobs.status.running", "Running")
  if (status === "completed") return tOr(language, "status.popover.jobs.status.completed", "Completed")
  if (status === "failed") return tOr(language, "status.popover.jobs.status.failed", "Failed")
  return tOr(language, "status.popover.jobs.status.cancelled", "Cancelled")
}

const formatJobTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))

const tabTrigger = (label: string, count: number) => (
  <>
    <span>{label}</span>
    <Show when={count > 0}>
      <span class="inline-flex min-w-4 h-4 items-center justify-center rounded-full bg-surface-raised-base px-1 text-[10px] leading-none text-text-weak">
        {count}
      </span>
    </Show>
  </>
)

const listServersByHealth = (
  list: ServerConnection.Any[],
  active: ServerConnection.Key | undefined,
  status: Record<ServerConnection.Key, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((url, index) => [url, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    if (ServerConnection.key(a) === active) return -1
    if (ServerConnection.key(b) === active) return 1
    const diff = rank(status[ServerConnection.key(a)]) - rank(status[ServerConnection.key(b)])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, enabled: Accessor<boolean>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<ServerConnection.Key, ServerHealth | undefined>)

  createEffect(() => {
    if (!enabled()) {
      setStatus(reconcile({}))
      return
    }
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    void refresh()
    const stopPolling = startVisiblePolling(refresh, pollMs, { immediate: false })
    onCleanup(() => {
      dead = true
      stopPolling()
    })
  })

  return status
}

const useDefaultServerKey = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [state, setState] = createStore({
    url: undefined as string | undefined,
    tick: 0,
  })

  createEffect(() => {
    state.tick
    let dead = false
    const result = get?.()
    if (!result) {
      setState("url", undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        setState("url", next ? normalizeServerUrl(next) : undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setState("url", normalizeServerUrl(result))
    onCleanup(() => {
      dead = true
    })
  })

  return {
    key: () => {
      const u = state.url
      if (!u) return
      return ServerConnection.key({ type: "http", http: { url: u } })
    },
    refresh: () => setState("tick", (value) => value + 1),
  }
}

const useMcpToggleMutation = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = sync.data.mcp[name]
      await (status?.status === "connected" ? sdk.client.mcp.disconnect({ name }) : sdk.client.mcp.connect({ name }))
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    },
  }))
}

export function StatusPopoverBody(props: { shown: Accessor<boolean>; directory?: string; sessionID?: string }) {
  const sync = useSync()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()

  const [load, setLoad] = createStore({
    mcpDone: false,
    mcpLoading: false,
    jobsLoading: false,
    jobsDone: false,
    planLoading: false,
    planDone: false,
  })
  const [jobs, setJobs] = createSignal<BackgroundJobItem[]>([])
  const [sessionTasks, setSessionTasks] = createSignal<SessionTaskItem[]>([])
  const [expandedJobID, setExpandedJobID] = createSignal<string>()
  const [openJobMenuID, setOpenJobMenuID] = createSignal<string>()
  const [planCollapsed, setPlanCollapsed] = createSignal(false)
  const [processesCollapsed, setProcessesCollapsed] = createSignal(false)
  const [jobDetails, setJobDetails] = createStore({} as Record<string, BackgroundJobDetail | undefined>)
  const [jobLogs, setJobLogs] = createStore({} as Record<string, BackgroundJobLogItem[] | undefined>)
  const [jobLoading, setJobLoading] = createStore({} as Record<string, boolean | undefined>)

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t, language.t("common.requestFailed")),
    })
  }

  createEffect(() => {
    if (!props.shown()) return

    if (!sync.data.mcp_ready && !load.mcpDone && !load.mcpLoading) {
      setLoad("mcpLoading", true)
      void sdk.client.mcp
        .status()
        .then((result) => {
          sync.set("mcp", result.data ?? {})
          sync.set("mcp_ready", true)
        })
        .catch((err) => {
          setLoad("mcpDone", true)
          fail(err)
        })
        .finally(() => {
          setLoad("mcpLoading", false)
        })
    }

  })

  createEffect(() => {
    if (!props.shown()) return
    if (!props.sessionID) {
      setSessionTasks([])
      return
    }
    let dead = false
    const refresh = async () => {
      setLoad("planLoading", true)
      try {
        const result = await sdk.client.session.task({ sessionID: props.sessionID! })
        if (dead) return
        setSessionTasks(result.data ?? [])
      } catch (err) {
        if (dead) return
        setLoad("planDone", true)
        fail(err)
      } finally {
        if (!dead) setLoad("planLoading", false)
      }
    }

    void refresh()
    const stopPolling = startVisiblePolling(refresh, pollMs, { immediate: false })
    onCleanup(() => {
      dead = true
      stopPolling()
    })
  })

  createEffect(() => {
    if (!props.shown()) return
    if (!props.sessionID) {
      setJobs([])
      return
    }
    let dead = false
    const refresh = async () => {
      setLoad("jobsLoading", true)
      try {
        const result = await sdk.client.backgroundJob.list({ sessionID: props.sessionID })
        if (dead) return
        setJobs((result.data ?? []).toSorted((a, b) => b.createdAt - a.createdAt))
      } catch (err) {
        if (dead) return
        setLoad("jobsDone", true)
        fail(err)
      } finally {
        if (!dead) setLoad("jobsLoading", false)
      }
    }

    void refresh()
    const stopPolling = startVisiblePolling(refresh, pollMs, { immediate: false })
    onCleanup(() => {
      dead = true
      stopPolling()
    })
  })

  const refreshJobDetail = async (jobID: string, incremental: boolean) => {
    setJobLoading(jobID, true)
    try {
      const detail = await sdk.client.backgroundJob.get({ jobID })
      const existingLogs = jobLogs[jobID] ?? []
      const afterSeq = incremental ? existingLogs[existingLogs.length - 1]?.seq : undefined
      const logs = await sdk.client.backgroundJob.logs({
        jobID,
        ...(afterSeq !== undefined ? { afterSeq } : {}),
      })
      setJobDetails(jobID, detail.data)
      if (!logs.data?.length && incremental) return
      if (afterSeq !== undefined && incremental) {
        setJobLogs(jobID, [...(jobLogs[jobID] ?? []), ...(logs.data ?? [])])
        return
      }
      setJobLogs(jobID, logs.data ?? [])
    } catch (err) {
      fail(err)
    } finally {
      setJobLoading(jobID, false)
    }
  }

  createEffect(() => {
    if (!props.shown()) return
    const jobID = expandedJobID()
    if (!jobID) return
    let dead = false
    const refresh = async () => {
      if (dead) return
      await refreshJobDetail(jobID, true)
    }
    void refreshJobDetail(jobID, false)
    const stopPolling = startVisiblePolling(refresh, pollMs, { immediate: false })
    onCleanup(() => {
      dead = true
      stopPolling()
    })
  })

  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })
  const servers = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (list.every((item) => ServerConnection.key(item) !== ServerConnection.key(current))) return [current, ...list]
    return [current, ...list.filter((item) => ServerConnection.key(item) !== ServerConnection.key(current))]
  })
  const health = useServerHealth(servers, props.shown)
  const sortedServers = createMemo(() => listServersByHealth(servers(), server.key, health))
  const toggleMcp = useMcpToggleMutation()
  const defaultServer = useDefaultServerKey(platform.getDefaultServer)
  const mcpNames = createMemo(() => Object.keys(sync.data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync.data.mcp?.[name]?.status
  const mcpCount = createMemo(() => mcpNames().length)
  const jobItems = createMemo(() =>
    jobs().toSorted((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1
      if (a.status !== "running" && b.status === "running") return 1
      return b.createdAt - a.createdAt
    }),
  )
  const jobCount = createMemo(() => jobItems().length)
  const planItems = createMemo(() =>
    sessionTasks().filter((item) => item.status !== "done" && item.status !== "abandoned"),
  )
  const activeGoal = createMemo(() => (props.sessionID ? sync.data.session_goal[props.sessionID]?.state : undefined))
  const reconcileJobLabel = () => {
    return tOr(language, "status.popover.jobs.reconcile", "Reconcile")
  }
  const jobDetailLabel = () => tOr(language, "status.popover.jobs.details", "Details")
  const jobHideLabel = () => tOr(language, "status.popover.jobs.hide", "Hide")
  const refreshSessionJobs = async () => {
    if (!props.sessionID) return
    const result = await sdk.client.backgroundJob.list({ sessionID: props.sessionID })
    setJobs((result.data ?? []).toSorted((a, b) => b.createdAt - a.createdAt))
  }
  const cancelJob = useMutation(() => ({
    mutationFn: async (jobID: string) => sdk.client.backgroundJob.cancel({ jobID }),
    onSuccess: async () => {
      await refreshSessionJobs()
    },
    onError: (err) => fail(err),
  }))
  const reconcileJob = useMutation(() => ({
    mutationFn: async (jobID: string) => sdk.client.backgroundJob.reconcile({ jobID }),
    onSuccess: async () => {
      await refreshSessionJobs()
      if (!expandedJobID()) return
      await refreshJobDetail(expandedJobID()!, false)
    },
    onError: (err) => fail(err),
  }))

  return (
    <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-component="tabs"
        data-active="servers"
        defaultValue="servers"
        variant="alt"
      >
        <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
          <Tabs.Trigger value="servers" data-slot="tab" class="inline-flex items-center gap-1.5 text-12-regular">
            {tabTrigger(language.t("status.popover.tab.servers"), sortedServers().length)}
          </Tabs.Trigger>
          <Show when={mcpCount() > 0}>
            <Tabs.Trigger value="mcp" data-slot="tab" class="inline-flex items-center gap-1.5 text-12-regular">
              {tabTrigger(language.t("status.popover.tab.mcp"), mcpCount())}
            </Tabs.Trigger>
          </Show>
          <Show when={props.sessionID}>
            <Tabs.Trigger value="jobs" data-slot="tab" class="inline-flex items-center gap-1.5 text-12-regular">
              {tabTrigger(language.t("status.popover.tab.jobs"), jobCount())}
            </Tabs.Trigger>
          </Show>
        </Tabs.List>

        <Tabs.Content value="servers">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <For each={sortedServers()}>
                {(s) => {
                  const key = ServerConnection.key(s)
                  const blocked = () => health[key]?.healthy === false
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                      classList={{
                        "hover:bg-surface-raised-base-hover": !blocked(),
                        "cursor-not-allowed": blocked(),
                      }}
                      aria-disabled={blocked()}
                      onClick={() => {
                        if (blocked()) return
                        navigate("/")
                        queueMicrotask(() => server.setActive(key))
                      }}
                    >
                      <ServerHealthIndicator health={health[key]} />
                      <ServerRow
                        conn={s}
                        dimmed={blocked()}
                        status={health[key]}
                        class="flex items-center gap-2 w-full min-w-0"
                        nameClass="text-14-regular text-text-base truncate"
                        versionClass="text-12-regular text-text-weak truncate"
                        badge={
                          <Show when={key === defaultServer.key()}>
                            <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                              {language.t("common.default")}
                            </span>
                          </Show>
                        }
                      >
                        <div class="flex-1" />
                        <Show when={server.current && key === ServerConnection.key(server.current)}>
                          <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                        </Show>
                      </ServerRow>
                    </button>
                  )
                }}
              </For>

              <Button
                variant="secondary"
                class="mt-3 self-start h-8 px-3 py-1.5"
                onClick={() => {
                  const run = ++dialogRun
                  void import("./dialog-select-server").then((x) => {
                    if (dialogDead || dialogRun !== run) return
                    dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
                  })
                }}
              >
                {language.t("status.popover.action.manageServers")}
              </Button>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="mcp">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <Show
                when={mcpNames().length > 0}
                fallback={
                  <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.mcp.empty")}</div>
                }
              >
                <For each={mcpNames()}>
                  {(name) => {
                    const status = () => mcpStatus(name)
                    const enabled = () => status() === "connected"
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                        onClick={() => {
                          if (toggleMcp.isPending) return
                          toggleMcp.mutate(name)
                        }}
                        disabled={toggleMcp.isPending && toggleMcp.variables === name}
                      >
                        <div
                          classList={{
                            "size-1.5 rounded-full shrink-0": true,
                            "bg-icon-success-base": status() === "connected",
                            "bg-icon-critical-base": status() === "failed" || status() === "needs_client_registration",
                            "bg-border-weak-base": status() === "disabled",
                            "bg-icon-warning-base": status() === "pending" || status() === "needs_auth",
                          }}
                        />
                        <span class="text-14-regular text-text-base truncate flex-1">{name}</span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Switch
                            checked={enabled()}
                            disabled={toggleMcp.isPending && toggleMcp.variables === name}
                            onChange={() => {
                              if (toggleMcp.isPending) return
                              toggleMcp.mutate(name)
                            }}
                          />
                        </div>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Show when={props.sessionID}>
          <Tabs.Content value="jobs">
            <div class="flex flex-col px-2 pb-2" onClick={() => setOpenJobMenuID(undefined)}>
              <section class="rounded-sm bg-background-base px-3 py-2" aria-labelledby="status-popover-plan-title">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
                  aria-expanded={!planCollapsed()}
                  aria-controls="status-popover-plan-content"
                  onClick={(event) => {
                    event.stopPropagation()
                    setPlanCollapsed((value) => !value)
                  }}
                >
                  <span id="status-popover-plan-title">Plan</span>
                  <Icon name="chevron-down" size="small" class={planCollapsed() ? "-rotate-90" : ""} />
                </button>
                <Show when={!planCollapsed()}>
                  <div id="status-popover-plan-content" class="mt-1">
                    <Show
                      when={!load.planLoading}
                      fallback={
                        <div class="px-1 py-2 text-12-regular text-text-weak">{language.t("common.loading")}...</div>
                      }
                    >
                      <Show
                        when={planItems().length > 0}
                        fallback={
                          <Show
                            when={activeGoal()?.objective}
                            fallback={<div class="px-1 py-2 text-12-regular text-text-weak">No active plan</div>}
                          >
                            {(objective) => (
                              <div class="truncate px-1 py-2 text-13-regular text-text-base">{objective()}</div>
                            )}
                          </Show>
                        }
                      >
                        <For each={planItems()}>
                          {(task) => (
                            <div class="flex min-w-0 items-center gap-2 rounded-md px-1 py-2">
                              <Icon name="checklist" size="small" class="shrink-0 text-icon-weak-base" />
                              <span class="min-w-0 truncate text-13-regular text-text-base">{task.summary}</span>
                            </div>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </section>

              <div class="my-2 h-px bg-border-weak-base" aria-hidden="true" />

              <section
                class="rounded-sm bg-background-base px-3 py-2"
                aria-labelledby="status-popover-background-title"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
                  aria-expanded={!processesCollapsed()}
                  aria-controls="status-popover-background-content"
                  onClick={(event) => {
                    event.stopPropagation()
                    setProcessesCollapsed((value) => !value)
                  }}
                >
                  <span id="status-popover-background-title">Shell processes</span>
                  <span class="ml-auto text-12-regular text-text-weak">{jobCount()}</span>
                  <Icon name="chevron-down" size="small" class={processesCollapsed() ? "-rotate-90" : ""} />
                </button>

                <Show when={!processesCollapsed()}>
                  <div id="status-popover-background-content" class="mt-1">
                    <div class="flex flex-col gap-1">
                      <div class="flex flex-col gap-2 p-3 bg-background-base rounded-sm min-h-14">
                        <Show
                          when={!load.jobsLoading}
                          fallback={
                            <div class="text-14-regular text-text-base text-center my-auto">
                              {language.t("common.loading")}...
                            </div>
                          }
                        >
                          <Show
                            when={jobItems().length > 0}
                            fallback={
                              <div class="text-14-regular text-text-base text-center my-auto">
                                {language.t("status.popover.jobs.empty")}
                              </div>
                            }
                          >
                            <For each={jobItems()}>
                              {(job) => (
                                <div class="group relative flex min-w-0 items-start gap-2 rounded-md px-1 py-2 hover:bg-surface-raised-base-hover">
                                  <Icon name="terminal" size="small" class="mt-0.5 shrink-0 text-icon-weak-base" />
                                  <div class="min-w-0 flex flex-1 items-start gap-2">
                                    <div
                                      class={`mt-1 size-1.5 shrink-0 rounded-full ${backgroundJobTone(job.status)}`}
                                    />
                                    <div class="min-w-0 flex-1">
                                      <div class="truncate text-13-medium text-text-base">{job.title}</div>
                                      <div class="mt-1 flex items-center gap-2 text-11-regular text-text-weak">
                                        <span>{backgroundJobStatusLabel(language, job.status)}</span>
                                        <span>•</span>
                                        <span>{formatJobTime(job.createdAt)}</span>
                                        <Show when={job.pid !== undefined}>
                                          <span>• pid {job.pid}</span>
                                        </Show>
                                      </div>
                                      <Show when={job.error}>
                                        {(error) => (
                                          <div class="mt-1 line-clamp-2 text-11-regular text-text-danger">
                                            {error()}
                                          </div>
                                        )}
                                      </Show>
                                      <Show when={job.cwd}>
                                        <div class="mt-1 truncate text-11-regular text-text-weak">{job.cwd}</div>
                                      </Show>
                                      <Show when={expandedJobID() === job.id}>
                                        <div class="mt-2 rounded-sm border border-border-weak-base bg-background-base px-2 py-2">
                                          <Show
                                            when={!jobLoading[job.id]}
                                            fallback={
                                              <div class="text-11-regular text-text-weak">
                                                {language.t("common.loading")}...
                                              </div>
                                            }
                                          >
                                            <Show when={jobDetails[job.id]}>
                                              {(detail) => (
                                                <div class="space-y-2">
                                                  <div class="flex flex-wrap items-center gap-2 text-11-regular text-text-weak">
                                                    <span>{detail().kind}</span>
                                                    <span>•</span>
                                                    <span>{detail().source}</span>
                                                    <Show when={detail().completedAt}>
                                                      <span>• {formatJobTime(detail().completedAt!)}</span>
                                                    </Show>
                                                    <Show when={detail().exitCode !== undefined}>
                                                      <span>• exit {detail().exitCode}</span>
                                                    </Show>
                                                  </div>
                                                  <Show when={Object.keys(detail().payload ?? {}).length > 0}>
                                                    <pre class="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-surface-base px-2 py-1.5 text-[11px] leading-4 text-text-weak">
                                                      {JSON.stringify(detail().payload, null, 2)}
                                                    </pre>
                                                  </Show>
                                                </div>
                                              )}
                                            </Show>
                                            <Show when={(jobLogs[job.id] ?? []).length > 0}>
                                              <div class="mt-2 rounded-sm bg-surface-base px-2 py-1.5">
                                                <div class="mb-1 text-11-regular text-text-weak">logs</div>
                                                <div class="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-text-base">
                                                  <For each={jobLogs[job.id] ?? []}>
                                                    {(entry) => (
                                                      <div>
                                                        <span class="text-text-weak">[{entry.stream}] </span>
                                                        <span>{entry.text}</span>
                                                      </div>
                                                    )}
                                                  </For>
                                                </div>
                                              </div>
                                            </Show>
                                          </Show>
                                        </div>
                                      </Show>
                                    </div>
                                    <div class="shrink-0 flex items-center gap-1.5">
                                      <div class="relative" data-job-menu>
                                        <button
                                          type="button"
                                          class="flex size-7 items-center justify-center rounded-md text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base"
                                          aria-label={`More actions for ${job.title}`}
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
                                            class="absolute right-0 top-[calc(100%-2px)] z-30 w-56 max-w-[calc(100vw-4.5rem)] rounded-xl border border-border-weak-base bg-background-base p-1 shadow-[var(--shadow-lg-border-base)]"
                                            role="menu"
                                            aria-label="Background terminal actions"
                                          >
                                            <button
                                              type="button"
                                              role="menuitem"
                                              class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-13-regular text-text-base hover:bg-surface-raised-base-hover"
                                              onClick={(event) => {
                                                event.stopPropagation()
                                                setOpenJobMenuID(undefined)
                                                setExpandedJobID(job.id)
                                                void refreshJobDetail(job.id, false)
                                              }}
                                            >
                                              <Icon name="open-file" size="small" class="shrink-0" />
                                              <span>Open output</span>
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-13-regular text-text-base hover:bg-surface-raised-base-hover disabled:cursor-not-allowed disabled:text-text-weak"
                                              disabled={job.status !== "running" || cancelJob.isPending}
                                              onClick={(event) => {
                                                event.stopPropagation()
                                                setOpenJobMenuID(undefined)
                                                cancelJob.mutate(job.id)
                                              }}
                                            >
                                              <Icon name="stop" size="small" class="shrink-0" />
                                              <span>Stop</span>
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-13-regular text-text-base hover:bg-surface-raised-base-hover"
                                              onClick={(event) => {
                                                event.stopPropagation()
                                                setOpenJobMenuID(undefined)
                                                showToast({
                                                  variant: "error",
                                                  title: "Restart is not available yet",
                                                  description:
                                                    "This design action will connect to the background job restart API in a later step.",
                                                })
                                              }}
                                            >
                                              <Icon name="reset" size="small" class="shrink-0" />
                                              <span>Restart</span>
                                            </button>
                                          </div>
                                        </Show>
                                      </div>
                                      <Button
                                        size="small"
                                        variant="ghost"
                                        class="h-7 shrink-0 px-2"
                                        onClick={() => {
                                          if (expandedJobID() === job.id) {
                                            setExpandedJobID(undefined)
                                            return
                                          }
                                          setExpandedJobID(job.id)
                                        }}
                                      >
                                        {expandedJobID() === job.id ? jobHideLabel() : jobDetailLabel()}
                                      </Button>
                                      <Show when={job.status === "running"}>
                                        <Button
                                          size="small"
                                          variant="ghost"
                                          class="h-7 shrink-0 px-2"
                                          disabled={reconcileJob.isPending && reconcileJob.variables === job.id}
                                          onClick={() => reconcileJob.mutate(job.id)}
                                        >
                                          {reconcileJobLabel()}
                                        </Button>
                                        <Button
                                          size="small"
                                          variant="secondary"
                                          class="h-7 shrink-0 px-2"
                                          disabled={cancelJob.isPending && cancelJob.variables === job.id}
                                          onClick={() => cancelJob.mutate(job.id)}
                                        >
                                          {language.t("common.cancel")}
                                        </Button>
                                      </Show>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </For>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </div>
                </Show>
              </section>
            </div>
          </Tabs.Content>
        </Show>
      </Tabs>
    </div>
  )
}
