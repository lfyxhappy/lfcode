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
import { batch, createContext, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { bootstrapDirectory, bootstrapGlobal, clearProviderRev } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
import { mergeSessionGoal } from "./global-sync/session-goal"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { createSessionStatusReconciler } from "./global-sync/session-status-reconciler"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
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
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()

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
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    active = false
  })
  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
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
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      queue.clear(directory)
      sessionMeta.delete(directory)
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

  async function bootstrapInstance(directory: string) {
    directory = normalizeWorkspacePath(directory)
    if (!directory) return
    const pending = booting.get(directory)
    if (pending) return pending

    children.pin(directory)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(directory)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        onSessionStatusSnapshot: sessionStatus.refresh,
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
      })
    })

    booting.set(directory, promise)
    void promise.finally(() => {
      booting.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name === "global" ? "global" : normalizeWorkspacePath(e.name)
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (directory === "global") {
      if (event.type === "server.connected") {
        for (const childDirectory of Object.keys(children.children)) {
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
    children.mark(directory)
    const [store, setStore] = existing
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
      sessionStatus.refresh(directory, props.sessionID)
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

  async function refreshActiveProviders() {
    await Promise.all(
      Object.entries(children.children).map(([directory, [, setStore]]) => {
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
