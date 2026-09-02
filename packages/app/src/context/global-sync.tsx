import type {
  Config,
  LfcodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  SessionStatus,
  Todo,
} from "@lfcode-ai/sdk/v2/client"
import { showToast } from "@lfcode-ai/ui/toast"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { retry } from "@lfcode-ai/shared/util/retry"
import { batch, createContext, createEffect, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { bootstrapDirectory, bootstrapGlobal, clearProviderRev } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyActivitySnapshot, applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches, normalizeActivity } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
import { mergeSessionGoal } from "./global-sync/session-goal"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { createSessionStatusReconciler } from "./global-sync/session-status-reconciler"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import { createSingleFlight } from "./global-sync/single-flight"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { normalizeProviderList, sanitizeProject } from "./global-sync/utils"
import { formatServerError } from "@/utils/server-errors"
import { queryOptions, skipToken, useQueryClient } from "@tanstack/solid-query"
import { normalizeWorkspacePath } from "@/utils/persist"
import { isSessionStreaming } from "@/utils/session-status"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export const loadSessionsQuery = (directory: string) =>
  queryOptions<null>({ queryKey: [directory, "loadSessions"], queryFn: skipToken })

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, LfcodeClient>()
  const booting = createSingleFlight<string, void>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()
  const commandLoads = new Map<string, Promise<void>>()

  const [projectCache, setProjectCache, projectInit] = persisted(
    Persist.global("globalSync.project", ["globalSync.project.v1"]),
    createStore({ value: [] as Project[] }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: projectCache.value,
    session_todo: {},
    provider: { all: [], connected: [], default: {} },
    provider_auth: {},
    config: {},
    reload: undefined,
  })
  const queryClient = useQueryClient()

  let active = true
  let projectWritten = false
  let bootedAt = 0
  let bootingRoot = false
  let streamConnected = false
  let reconnecting: Promise<void> | undefined
  const activatedDirectories = new Set<string>()
  const pendingRequestVersion = new Map<string, number>()
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined
  const activityCalibrationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const activityCalibrationRequests = new Map<string, Promise<void>>()

  onCleanup(() => {
    active = false
  })
  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
    for (const timer of activityCalibrationTimers.values()) clearTimeout(timer)
    activityCalibrationTimers.clear()
  })

  const activitySessionIDs = (directory: string) => {
    const child = children.children[directory]
    if (!child) return []
    const store = child[0]
    const ids = new Set<string>()
    for (const [sessionID, status] of Object.entries(store.session_status)) {
      if (status && isSessionStreaming(status)) ids.add(sessionID)
    }
    for (const [sessionID, activities] of Object.entries(store.activity ?? {})) {
      if (activities?.some((activity) => !["completed", "failed", "cancelled"].includes(activity.status ?? ""))) ids.add(sessionID)
    }
    return [...ids]
  }

  const calibrateActivities = (directory: string, force = false) => {
    if (!force && globalSDK.event.connection() === "connected") return Promise.resolve()
    const pending = activityCalibrationRequests.get(directory)
    if (pending) return pending
    const child = children.children[directory]
    if (!child) return Promise.resolve()
    const promise = Promise.all(
      activitySessionIDs(directory).map((sessionID) => {
        const revisionsBeforeRequest = new Map(
          (child[0].activity?.[sessionID] ?? []).map((activity) => [activity.id, activity.revision]),
        )
        return retry(() => sdkFor(directory).activity.list({ sessionID })).then((response) => {
            if (!children.children[directory]) return
            applyActivitySnapshot({
              sessionID,
              activities: response.data?.items ?? [],
              store: children.children[directory][0],
              setStore: children.children[directory][1],
              revisionsBeforeRequest,
            })
          })
      }),
    ).then(() => {})
    activityCalibrationRequests.set(directory, promise)
    void promise
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        activityCalibrationRequests.delete(directory)
        if (active && globalSDK.event.connection() !== "connected") scheduleActivityCalibration(directory)
      })
    return promise
  }

  const scheduleActivityCalibration = (directory: string, immediate = false, force = false) => {
    if (!force && globalSDK.event.connection() === "connected") return
    if (!children.children[directory] || activitySessionIDs(directory).length === 0) return
    const existing = activityCalibrationTimers.get(directory)
    if (existing) {
      if (!immediate) return
      clearTimeout(existing)
    }
    const timer = setTimeout(() => {
      activityCalibrationTimers.delete(directory)
      void calibrateActivities(directory, force)
    }, immediate ? 0 : 30_000)
    activityCalibrationTimers.set(directory, timer)
  }

  createEffect(() => {
    const connected = globalSDK.event.connection() === "connected"
    if (connected) {
      for (const timer of activityCalibrationTimers.values()) clearTimeout(timer)
      activityCalibrationTimers.clear()
      return
    }
    for (const directory of activatedDirectories) scheduleActivityCalibration(directory)
  })

  const cacheProjects = () => {
    setProjectCache(
      "value",
      untrack(() => globalStore.project.map(sanitizeProject)),
    )
  }

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    projectWritten = true
    setGlobalStore("project", next)
    cacheProjects()
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  if (projectInit instanceof Promise) {
    void projectInit.then(() => {
      if (!active) return
      if (projectWritten) return
      const cached = projectCache.value
      if (cached.length === 0) return
      setGlobalStore("project", cached)
    })
  }

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    bootstrap,
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(normalizeWorkspacePath(directory)),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: bootstrapInstance,
    onDispose: (directory) => {
      activatedDirectories.delete(directory)
      queue.clear(directory)
      sessionMeta.delete(directory)
      commandLoads.delete(directory)
      sdkCache.delete(directory)
      clearProviderRev(directory)
      clearSessionPrefetchDirectory(directory)
    },
    translate: language.t,
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  const sessionStatus = createSessionStatusReconciler({
    getClient: sdkFor,
    getStore: (directory) => children.peek(directory, { bootstrap: false }),
  })

  async function loadSessions(directory: string) {
    directory = normalizeWorkspacePath(directory)
    const pending = sessionLoads.get(directory)
    if (pending) return pending

    children.pin(directory)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(directory)
    if (meta && meta.limit >= store.limit) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
        cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo)
      }
      children.unpin(directory)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = queryClient
      .fetchQuery({
        ...loadSessionsQuery(directory),
        queryFn: () =>
          loadRootSessionsWithFallback({
            directory,
            limit,
            list: (query) => globalSDK.client.session.list(query),
          })
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const limit = store.limit
              const childSessions = store.session.filter((s) => !!s.parentID)
              const sessions = trimSessions([...nonArchived, ...childSessions], {
                limit,
                permission: store.permission,
              })
              batch(() => {
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(sessions, { key: "id" }))
                for (const session of sessions) {
                  setStore("session_goal", session.id, (prev) => mergeSessionGoal(prev, { goal: (session as any).goal }))
                }
                cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo)
              })
              sessionMeta.set(directory, { limit })
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(directory, promise)
    void promise.finally(() => {
      sessionLoads.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  async function loadCommands(directory: string) {
    directory = normalizeWorkspacePath(directory)
    if (!directory) return
    const pending = commandLoads.get(directory)
    if (pending) return pending
    const [store, setStore] = children.child(directory, { bootstrap: false })
    if (store.command_ready) return

    children.pin(directory)
    const promise = retry(() => sdkFor(directory).command.list())
      .then((x) => {
        setStore("command", x.data ?? [])
        setStore("command_ready", true)
      })
      .finally(() => {
        commandLoads.delete(directory)
        children.unpin(directory)
      })
    commandLoads.set(directory, promise)
    return promise
  }

  async function bootstrapInstance(directory: string, options?: { reconcilePendingRequests?: boolean }) {
    directory = normalizeWorkspacePath(directory)
    if (!directory) return
    activatedDirectories.add(directory)
    return booting.run(directory, async () => {
      children.pin(directory)
      try {
        const child = children.ensureChild(directory)
        scheduleActivityCalibration(directory)
        const cache = children.vcsCache.get(directory)
        if (!cache) return

        await bootstrapDirectory({
          directory,
          global: {
            config: globalStore.config,
            path: globalStore.path,
            project: globalStore.project,
            provider: globalStore.provider,
          },
          sdk: sdkFor(directory),
          store: child[0],
          setStore: child[1],
          onSessionStatusSnapshot: sessionStatus.refresh,
          reconcilePendingRequests: options?.reconcilePendingRequests,
          pendingRequestVersion: () => pendingRequestVersion.get(directory) ?? 0,
          vcsCache: cache,
          loadSessions,
          loadCommands,
          isCurrent: () => children.children[directory] === child,
          translate: language.t,
          queryClient,
        })
      } finally {
        children.unpin(directory)
      }
    })
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name === "global" ? "global" : normalizeWorkspacePath(e.name)
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (directory === "global") {
      if (event.type === "server.connected") {
        if (!streamConnected) {
          streamConnected = true
        } else {
          reconnecting ??= refreshAfterReconnect().finally(() => {
            reconnecting = undefined
          })
        }
        for (const childDirectory of activatedDirectories) {
          sessionStatus.refresh(childDirectory)
        }
      }
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          queue.refresh()
        },
        setGlobalProject: setProjects,
      })
      return
    }

    const existing = children.children[directory]
    if (!existing) return
    if (event.type.startsWith("permission.") || event.type.startsWith("question.")) {
      pendingRequestVersion.set(directory, (pendingRequestVersion.get(directory) ?? 0) + 1)
    }
    children.mark(directory)
    const [store, setStore] = existing
    if (event.type.startsWith("activity.")) {
      const activity = normalizeActivity(event.properties)
      if (activity?.revision !== undefined) {
        const current = store.activity?.[activity.sessionID]?.find((item) => item.id === activity.id)
        if (current?.revision !== undefined && activity.revision > current.revision + 1) {
          scheduleActivityCalibration(directory, true, true)
        }
      }
    }
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(directory),
      loadLsp: () => {
        void sdkFor(directory)
          .lsp.status()
          .then((x) => {
            setStore("lsp", x.data ?? [])
            setStore("lsp_ready", true)
          })
      },
    })
    if (event.type === "session.status") {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      if (isSessionStreaming(props.status)) sessionStatus.markBusy(directory, props.sessionID)
      if (!isSessionStreaming(props.status)) sessionStatus.stop(directory, props.sessionID)
    }
    if (event.type === "message.part.updated" || event.type === "message.part.delta") {
      const props = event.properties as { sessionID: string }
      sessionStatus.noteActivity(directory, props.sessionID)
    }
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    sessionStatus.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directory)
    }
  })

  async function bootstrap() {
    bootingRoot = true
    try {
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
    } finally {
      bootingRoot = false
    }
  }

  async function refreshAfterReconnect() {
    await bootstrap()
    await Promise.all(
      Array.from(activatedDirectories)
        .filter((directory) => !!children.children[directory])
        .map((directory) => bootstrapInstance(directory, { reconcilePendingRequests: true })),
    )
  }

  async function refreshActiveProviders() {
    await Promise.all(
      Array.from(activatedDirectories)
        .filter((directory) => !!children.children[directory])
        .map((directory) => {
          const [, setStore] = children.children[directory]
        clearProviderRev(directory)
        setStore("provider_ready", false)
        return retry(() =>
          sdkFor(directory)
            .provider.list()
            .then((x) => {
              setStore("provider", normalizeProviderList(x.data!))
              setStore("provider_ready", true)
            }),
        ).catch((err) => {
          const project = getFilename(directory)
          showToast({
            variant: "error",
            title: language.t("toast.project.reloadFailed.title", { project }),
            description: formatServerError(err, language.t),
          })
        })
        }),
    )
  }

  async function reloadProviders() {
    await bootstrap()
    await refreshActiveProviders()
  }

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void globalSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void globalSDK.event.start()
      }, 0)
    }
    void bootstrap()
  })

  const projectApi = {
    loadSessions,
    loadCommands,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfig = async (config: Record<string, unknown>) => {
    setGlobalStore("reload", "pending")
    return globalSDK.client.global.config
      .update({ configPatch: config as any })
      .then(reloadProviders)
      .then(() => {
        queue.refresh()
        setGlobalStore("reload", undefined)
        queue.refresh()
      })
      .catch((error) => {
        setGlobalStore("reload", undefined)
        throw error
      })
  }

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    existing: children.existing,
    peek: children.peek,
    bootstrap,
    reloadProviders,
    updateConfig,
    project: projectApi,
    sessionStatus,
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}
