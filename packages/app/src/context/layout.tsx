import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@lfcode-ai/ui/context"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { usePlatform } from "./platform"
import { Project } from "@lfcode-ai/sdk/v2"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { decode64 } from "@/utils/base64"
import { same } from "@/utils/same"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import { createPathHelpers } from "./file/path"
import { browserTab, DEFAULT_BROWSER_URL, isBrowserTab, normalizeBrowserURL } from "@/pages/session/helpers"
import { workspaceKey } from "@/pages/layout/helpers"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
const DEFAULT_SIDEBAR_WIDTH = 344
const DEFAULT_FILE_TREE_WIDTH = 200
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

type SessionTabs = {
  active?: string
  all: string[]
}

type DetachedPanelKind = "file" | "browser" | "review" | "context"

type DetachedPanelPlacement = {
  afterTab?: string
  beforeTab?: string
}

type DetachedPanelRecord = {
  detachedWindowID: string
  sessionKey: string
  tab: string
  kind: DetachedPanelKind
  sourceWindowID: number
  title?: string
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
  browser?: Record<
    string,
    {
      url: string
      input: string
      title?: string
      history: string[]
      index: number
      loading?: boolean
      canGoBack?: boolean
      canGoForward?: boolean
      error?: string
    }
  >
}

type BrowserViewState = NonNullable<SessionView["browser"]>[string]

type TabHandoff = {
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}

function nextSessionTabsForOpen(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

export function createBrowserState(url: string, title?: string, current?: BrowserViewState): BrowserViewState {
  const next = normalizeBrowserURL(url)
  if (!next) {
    return current ?? {
      url: DEFAULT_BROWSER_URL,
      input: DEFAULT_BROWSER_URL,
      title,
      history: [DEFAULT_BROWSER_URL],
      index: 0,
      loading: false,
      canGoBack: false,
      canGoForward: false,
    }
  }

  const previousHistory = current?.history.filter((item) => normalizeBrowserURL(item)) ?? []
  const previousIndex = current ? Math.min(Math.max(current.index, 0), previousHistory.length - 1) : -1
  const previousUrl = previousIndex >= 0 ? previousHistory[previousIndex] : undefined

  const history =
    current && previousUrl === next
      ? previousHistory.length > 0
        ? previousHistory
        : [next]
      : current
        ? [...previousHistory.slice(0, previousIndex + 1), next]
        : [next]

  const index = history.lastIndexOf(next)

  return {
    url: next,
    input: next,
    title: title ?? current?.title,
    history,
    index,
    loading: true,
    canGoBack: index > 0,
    canGoForward: index < history.length - 1,
    error: undefined,
  }
}

export function normalizeBrowserViewState(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined

  const input = value as Record<string, unknown>
  const fallback = normalizeBrowserURL(typeof input.url === "string" ? input.url : "")
  if (!fallback) return undefined

  const history = Array.isArray(input.history)
    ? input.history.flatMap((item) => {
        if (typeof item !== "string") return []
        const next = normalizeBrowserURL(item)
        return next ? [next] : []
      })
    : []

  const url = normalizeBrowserURL(typeof input.url === "string" ? input.url : fallback) ?? fallback
  const normalizedHistory = history.length > 0 ? history : [url]
  const historyWithCurrent = normalizedHistory.includes(url) ? normalizedHistory : [...normalizedHistory, url]
  const requestedIndex = typeof input.index === "number" ? Math.trunc(input.index) : historyWithCurrent.lastIndexOf(url)
  const index = Math.min(Math.max(requestedIndex, 0), historyWithCurrent.length - 1)
  const currentUrl = historyWithCurrent[index] ?? url

  return {
    url: currentUrl,
    input: normalizeBrowserURL(typeof input.input === "string" ? input.input : currentUrl) ?? currentUrl,
    title: typeof input.title === "string" ? input.title : undefined,
    history: historyWithCurrent,
    index,
    loading: typeof input.loading === "boolean" ? input.loading : true,
    canGoBack: index > 0,
    canGoForward: index < historyWithCurrent.length - 1,
    error: typeof input.error === "string" ? input.error : undefined,
  } satisfies BrowserViewState
}

export function syncBrowserViewState(
  current: BrowserViewState,
  next: {
    url?: string
    input?: string
    title?: string
    loading?: boolean
    error?: string
  },
) {
  const normalized = normalizeBrowserURL(next.url ?? current.url) ?? current.url
  const history = current.history.filter((item) => normalizeBrowserURL(item))
  const currentIndex = Math.min(Math.max(current.index, 0), history.length - 1)
  const currentUrl = history[currentIndex] ?? current.url

  const index = (() => {
    if (normalized === currentUrl) return history.length > 0 ? currentIndex : 0
    const existing = history.lastIndexOf(normalized)
    if (existing >= 0 && Math.abs(existing - currentIndex) === 1) return existing
    return history.length
  })()

  const nextHistory = index < history.length ? history : [...history.slice(0, currentIndex + 1), normalized]

  return {
    ...current,
    url: normalized,
    input: next.input ?? normalized,
    title: next.title ?? current.title,
    history: nextHistory,
    index,
    loading: next.loading ?? current.loading,
    canGoBack: index > 0,
    canGoForward: index < nextHistory.length - 1,
    error: next.error,
  } satisfies BrowserViewState
}

const sessionPath = (key: string) => {
  const dir = key.split("/")[0]
  if (!dir) return
  const root = decode64(dir)
  if (!root) return
  return createPathHelpers(() => root)
}

const normalizeSessionTab = (path: ReturnType<typeof createPathHelpers> | undefined, tab: string) => {
  if (!tab.startsWith("file://")) return tab
  if (!path) return tab
  return path.tab(tab)
}

const normalizeSessionTabList = (path: ReturnType<typeof createPathHelpers> | undefined, all: string[]) => {
  const seen = new Set<string>()
  return all.flatMap((tab) => {
    const value = normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPath(key)
  return {
    all: normalizeSessionTabList(path, tabs.all),
    active: tabs.active ? normalizeSessionTab(path, tabs.active) : tabs.active,
  }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const server = useServer()
    const platform = usePlatform()

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)

    const migrate = (value: unknown) => {
      if (!isRecord(value)) return value

      const sidebar = value.sidebar
      const migratedSidebar = (() => {
        if (!isRecord(sidebar)) return sidebar
        if (typeof sidebar.workspaces !== "boolean") return sidebar
        return {
          ...sidebar,
          workspaces: {},
          workspacesDefault: sidebar.workspaces,
        }
      })()

      const review = value.review
      const fileTree = value.fileTree
      const migratedFileTree = (() => {
        if (!isRecord(fileTree)) return fileTree
        if (fileTree.tab === "changes" || fileTree.tab === "all") return fileTree

        const width = typeof fileTree.width === "number" ? fileTree.width : DEFAULT_FILE_TREE_WIDTH
        return {
          ...fileTree,
          opened: true,
          width: width === 260 ? DEFAULT_FILE_TREE_WIDTH : width,
          tab: "changes",
        }
      })()

      const migratedReview = (() => {
        if (!isRecord(review)) return review
        if (typeof review.panelOpened === "boolean") return review

        const opened = isRecord(fileTree) && typeof fileTree.opened === "boolean" ? fileTree.opened : true
        return {
          ...review,
          panelOpened: opened,
        }
      })()

      const sessionTabs = value.sessionTabs
      const migratedSessionTabs = (() => {
        if (!isRecord(sessionTabs)) return sessionTabs

        let changed = false
        const next = Object.fromEntries(
          Object.entries(sessionTabs).map(([key, tabs]) => {
            if (!isRecord(tabs) || !Array.isArray(tabs.all)) return [key, tabs]

            const current = {
              all: tabs.all.filter((tab): tab is string => typeof tab === "string"),
              active: typeof tabs.active === "string" ? tabs.active : undefined,
            }
            const normalized = normalizeStoredSessionTabs(key, current)
            if (current.all.length !== tabs.all.length) changed = true
            if (!same(current.all, normalized.all) || current.active !== normalized.active) changed = true
            if (tabs.active !== undefined && typeof tabs.active !== "string") changed = true
            return [key, normalized]
          }),
        )

        if (!changed) return sessionTabs
        return next
      })()

      const sessionView = value.sessionView
      const migratedSessionView = (() => {
        if (!isRecord(sessionView)) return sessionView

        let changed = false
        const next = Object.fromEntries(
          Object.entries(sessionView).map(([key, view]) => {
            if (!isRecord(view)) return [key, view]
            if (!isRecord(view.browser)) return [key, view]

            const browser = Object.fromEntries(
              Object.entries(view.browser).flatMap(([tabID, tab]) => {
                const normalized = normalizeBrowserViewState(tab)
                if (!normalized) {
                  changed = true
                  return []
                }
                if (normalized !== tab) changed = true
                return [[tabID, normalized]]
              }),
            )

            return [key, { ...view, browser }]
          }),
        )

        if (!changed) return sessionView
        return next
      })()

      if (
        migratedSidebar === sidebar &&
        migratedReview === review &&
        migratedFileTree === fileTree &&
        migratedSessionTabs === sessionTabs &&
        migratedSessionView === sessionView
      ) {
        return value
      }

      return {
        ...value,
        sidebar: migratedSidebar,
        review: migratedReview,
        fileTree: migratedFileTree,
        sessionTabs: migratedSessionTabs,
        sessionView: migratedSessionView,
      }
    }

    const browserState = (sessionKey: string) => {
      const current = store.sessionView[sessionKey]
      if (current?.browser) return current.browser
      if (current) {
        setStore("sessionView", sessionKey, "browser", {})
        return store.sessionView[sessionKey]?.browser ?? {}
      }
      setStore("sessionView", sessionKey, {
        scroll: {},
        browser: {},
      })
      return store.sessionView[sessionKey]?.browser ?? {}
    }

    const target = Persist.global("layout", ["layout.v6"])
    const [store, setStore, _, ready] = persisted(
      { ...target, migrate },
      createStore({
        sidebar: {
          opened: false,
          width: DEFAULT_SIDEBAR_WIDTH,
          workspaces: {} as Record<string, boolean>,
          workspacesDefault: false,
        },
        terminal: {
          height: DEFAULT_TERMINAL_HEIGHT,
          opened: false,
        },
        review: {
          diffStyle: "split" as ReviewDiffStyle,
          panelOpened: true,
        },
        fileTree: {
          opened: false,
          width: DEFAULT_FILE_TREE_WIDTH,
          tab: "changes" as "changes" | "all",
        },
        session: {
          width: DEFAULT_SESSION_WIDTH,
        },
        mobileSidebar: {
          opened: false,
        },
        sessionTabs: {} as Record<string, SessionTabs>,
        sessionView: {} as Record<string, SessionView>,
        detachedPanels: [] as DetachedPanelRecord[],
        handoff: {
          tabs: undefined as TabHandoff | undefined,
        },
      }),
    )

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const usage = {
      active: undefined as string | undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const SESSION_STATE_KEYS = [
      { key: "prompt", legacy: "prompt", version: "v2" },
      { key: "terminal", legacy: "terminal", version: "v1" },
      { key: "file-view", legacy: "file", version: "v1" },
    ] as const

    const dropSessionState = (keys: string[]) => {
      for (const key of keys) {
        const parts = key.split("/")
        const dir = parts[0]
        const session = parts[1]
        if (!dir) continue

        for (const entry of SESSION_STATE_KEYS) {
          const target = session ? Persist.session(dir, session, entry.key) : Persist.workspace(dir, entry.key)
          void removePersisted(target, platform)

          const legacyKey = `${dir}/${entry.legacy}${session ? "/" + session : ""}.${entry.version}`
          void removePersisted({ key: legacyKey }, platform)
        }
      }
    }

    function prune(keep?: string) {
      const drop = pruneSessionKeys({
        keep,
        max: MAX_SESSION_KEYS,
        used: usage.used,
        view: Object.keys(store.sessionView),
        tabs: Object.keys(store.sessionTabs),
      })
      if (drop.length === 0) return

      setStore(
        produce((draft) => {
          for (const key of drop) {
            delete draft.sessionView[key]
            delete draft.sessionTabs[key]
          }
        }),
      )

      scroll.drop(drop)
      dropSessionState(drop)

      for (const key of drop) {
        usage.used.delete(key)
      }
    }

    function touch(sessionKey: string) {
      usage.active = sessionKey
      usage.used.set(sessionKey, Date.now())

      if (!ready()) return
      if (usage.pruned) return

      usage.pruned = true
      prune(sessionKey)
    }

    const scroll = createScrollPersistence({
      debounceMs: 250,
      getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
      onFlush: (sessionKey, next) => {
        const current = store.sessionView[sessionKey]
        const keep = usage.active ?? sessionKey
        if (!current) {
          setStore("sessionView", sessionKey, { scroll: next })
          prune(keep)
          return
        }

        setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...prev, ...next }))
        prune(keep)
      },
    })

    const ensureKey = (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey))

    createEffect(() => {
      if (!ready()) return
      if (usage.pruned) return
      const active = usage.active
      if (!active) return
      usage.pruned = true
      prune(active)
    })

    onMount(() => {
      const flush = () => batch(() => scroll.flushAll())
      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        flush()
      }

      makeEventListener(window, "pagehide", flush)
      makeEventListener(document, "visibilitychange", handleVisibility)

      onCleanup(() => {
        scroll.dispose()
      })
    })

    const [colors, setColors] = createStore<Record<string, AvatarColorKey>>({})
    const colorRequested = new Map<string, AvatarColorKey>()

    function pickAvailableColor(used: Set<string>): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const [childStore] = globalSync.child(project.worktree, { bootstrap: false })
      const projectID = childStore.project
      const metadata = projectID
        ? globalSync.data.project.find((x) => x.id === projectID)
        : globalSync.data.project.find((x) => workspaceKey(x.worktree) === workspaceKey(project.worktree))

      const local = childStore.projectMeta
      const localOverride =
        local?.name !== undefined ||
        local?.commands?.start !== undefined ||
        local?.icon?.override !== undefined ||
        local?.icon?.color !== undefined

      const base = {
        ...metadata,
        ...project,
        icon: {
          url: metadata?.icon?.url,
          override: metadata?.icon?.override ?? childStore.icon,
          color: metadata?.icon?.color,
        },
      }

      const isGlobal = projectID === "global" || (metadata?.id === undefined && localOverride)
      if (!isGlobal) return base

      return {
        ...base,
        id: base.id ?? "global",
        name: local?.name,
        commands: local?.commands,
        icon: {
          url: base.icon?.url,
          override: local?.icon?.override,
          color: local?.icon?.color,
        },
      }
    }

    const roots = createMemo(() => {
      const map = new Map<string, string>()
      for (const project of globalSync.data.project) {
        const sandboxes = project.sandboxes ?? []
        for (const sandbox of sandboxes) {
          map.set(sandbox, project.worktree)
        }
      }
      return map
    })

    const rootFor = (directory: string) => {
      const map = roots()
      if (map.size === 0) return directory

      const visited = new Set<string>()
      const chain = [directory]

      while (chain.length) {
        const current = chain[chain.length - 1]
        if (!current) return directory

        const next = map.get(current)
        if (!next) return current

        if (visited.has(next)) return directory
        visited.add(next)
        chain.push(next)
      }

      return directory
    }

    createEffect(() => {
      const projects = server.projects.list()
      const seen = new Set(projects.map((project) => workspaceKey(project.worktree)))

      batch(() => {
        for (const project of projects) {
          const root = rootFor(project.worktree)
          const rootKey = workspaceKey(root)
          if (rootKey === workspaceKey(project.worktree)) continue

          server.projects.close(project.worktree)

          if (!seen.has(rootKey)) {
            server.projects.open(root)
            seen.add(rootKey)
          }

          if (project.expanded) server.projects.expand(root)
        }
      })
    })

    const enriched = createMemo(() => server.projects.list().map(enrich))
    const list = createMemo(() => {
      const projects = enriched()
      return projects.map((project) => {
        const color = project.icon?.color ?? colors[project.worktree]
        if (!color) return project
        const icon = project.icon ? { ...project.icon, color } : { color }
        return { ...project, icon }
      })
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      if (!globalSync.ready) return

      for (const project of projects) {
        if (!project.id) continue
        if (project.id === "global") continue
        globalSync.project.icon(project.worktree, project.icon?.override)
      }
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return

      for (const project of projects) {
        if (project.icon?.color) colorRequested.delete(project.worktree)
      }

      const used = new Set<string>()
      for (const project of projects) {
        const color = project.icon?.color ?? colors[project.worktree]
        if (color) used.add(color)
      }

      for (const project of projects) {
        if (project.icon?.color) continue
        const worktree = project.worktree
        const existing = colors[worktree]
        const color = existing ?? pickAvailableColor(used)
        if (!existing) {
          used.add(color)
          setColors(worktree, color)
        }
        if (!project.id) continue

        const requested = colorRequested.get(worktree)
        if (requested === color) continue
        colorRequested.set(worktree, color)

        if (project.id === "global") {
          globalSync.project.meta(worktree, { icon: { color } })
          continue
        }

        void globalSdk.client.project
          .update({ projectID: project.id, directory: worktree, icon: { color } })
          .catch(() => {
            if (colorRequested.get(worktree) === color) colorRequested.delete(worktree)
          })
      }
    })

    let sessionFrame: number | undefined
    let sessionTimer: number | undefined

    onMount(() => {
      sessionFrame = requestAnimationFrame(() => {
        sessionFrame = undefined
        sessionTimer = window.setTimeout(() => {
          sessionTimer = undefined
          void Promise.all(
            Array.from(new Set(server.projects.list().map((project) => workspaceKey(project.worktree)))).map((root) =>
              globalSync.project.loadSessions(root),
            ),
          )
        }, 0)
      })
    })

    onCleanup(() => {
      if (sessionFrame !== undefined) cancelAnimationFrame(sessionFrame)
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer)
    })

    return {
      ready,
      handoff: {
        tabs: createMemo(() => store.handoff?.tabs),
        setTabs(dir: string, id: string) {
          setStore("handoff", "tabs", { dir, id, at: Date.now() })
        },
        clearTabs() {
          if (!store.handoff?.tabs) return
          setStore("handoff", "tabs", undefined)
        },
      },
      projects: {
        list,
        open(directory: string) {
          const root = rootFor(directory)
          if (server.projects.list().find((x) => workspaceKey(x.worktree) === workspaceKey(root))) return
          void globalSync.project.loadSessions(root)
          server.projects.open(root)
        },
        close(directory: string) {
          server.projects.close(directory)
        },
        expand(directory: string) {
          server.projects.expand(directory)
        },
        collapse(directory: string) {
          server.projects.collapse(directory)
        },
        move(directory: string, toIndex: number) {
          server.projects.move(directory, toIndex)
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
        workspaces(directory: string) {
          return () => store.sidebar.workspaces[directory] ?? store.sidebar.workspacesDefault ?? false
        },
        setWorkspaces(directory: string, value: boolean) {
          setStore("sidebar", "workspaces", directory, value)
        },
        toggleWorkspaces(directory: string) {
          const current = store.sidebar.workspaces[directory] ?? store.sidebar.workspacesDefault ?? false
          setStore("sidebar", "workspaces", directory, !current)
        },
      },
      terminal: {
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          if (!store.review) {
            setStore("review", { diffStyle, panelOpened: true })
            return
          }
          setStore("review", "diffStyle", diffStyle)
        },
      },
      fileTree: {
        opened: createMemo(() => store.fileTree?.opened ?? true),
        width: createMemo(() => store.fileTree?.width ?? DEFAULT_FILE_TREE_WIDTH),
        tab: createMemo(() => store.fileTree?.tab ?? "changes"),
        setTab(tab: "changes" | "all") {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab })
            return
          }
          setStore("fileTree", "tab", tab)
        },
        open() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })
            return
          }
          setStore("fileTree", "opened", true)
        },
        close() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })
            return
          }
          setStore("fileTree", "opened", false)
        },
        toggle() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })
            return
          }
          setStore("fileTree", "opened", (x) => !x)
        },
        resize(width: number) {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width, tab: "changes" })
            return
          }
          setStore("fileTree", "width", width)
        },
      },
      session: {
        width: createMemo(() => store.session?.width ?? DEFAULT_SESSION_WIDTH),
        resize(width: number) {
          if (!store.session) {
            setStore("session", { width })
            return
          }
          setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => store.mobileSidebar?.opened ?? false),
        show() {
          setStore("mobileSidebar", "opened", true)
        },
        hide() {
          setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const at = Date.now()
          touch(sessionKey)
          const current = store.sessionView[sessionKey]
          if (!current) {
            setStore("sessionView", sessionKey, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            prune(usage.active ?? sessionKey)
            return
          }

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const current = store.sessionView[sessionKey]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt
          if (!message || !at) return

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              delete draft.pendingMessage
              delete draft.pendingMessageAt
            }),
          )

          if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return
          return message
        },
      },
      browser: {
        open(sessionKey: string, tabID: string, url: string, title?: string) {
          const current = browserState(sessionKey)[tabID]
          const next = normalizeBrowserURL(url)
          if (!next) return
          const tab = browserTab(tabID)
          const currentTabs = store.sessionTabs[sessionKey]
          const nextTabs = currentTabs?.all.includes(tab) ? currentTabs : nextSessionTabsForOpen(currentTabs, tab)
          setStore("sessionTabs", sessionKey, nextTabs)
          setStore("sessionView", sessionKey, "browser", tabID, createBrowserState(next, title, current))
        },
        update(sessionKey: string, tabID: string, next: Partial<NonNullable<SessionView["browser"]>[string]>) {
          const current = browserState(sessionKey)[tabID]
          if (!current) return
          setStore("sessionView", sessionKey, "browser", tabID, { ...current, ...next })
        },
        close(sessionKey: string, tabID: string) {
          const current = store.sessionView[sessionKey]?.browser
          if (!current || !current[tabID]) return
          const tab = browserTab(tabID)
          const tabs = store.sessionTabs[sessionKey]
          if (tabs?.all.includes(tab)) {
            const all = tabs.all.filter((item) => item !== tab)
            const index = tabs.all.findIndex((item) => item === tab)
            const active =
              tabs.active === tab ? tabs.all[index - 1] ?? tabs.all[index + 1] ?? all[0] : tabs.active
            setStore("sessionTabs", sessionKey, { all, active })
          }
          setStore(
            "sessionView",
            sessionKey,
            "browser",
            produce((draft) => {
              if (!draft) return
              delete draft[tabID]
            }),
          )
        },
      },
      view(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const s = createMemo(() => store.sessionView[key()] ?? { scroll: {} })
        const terminalOpened = createMemo(() => store.terminal?.opened ?? false)
        const reviewPanelOpened = createMemo(() => store.review?.panelOpened ?? true)

        function setTerminalOpened(next: boolean) {
          const current = store.terminal
          if (!current) {
            setStore("terminal", { height: DEFAULT_TERMINAL_HEIGHT, opened: next })
            return
          }

          const value = current.opened ?? false
          if (value === next) return
          setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean) {
          const current = store.review
          if (!current) {
            setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next })
            return
          }

          const value = current.panelOpened ?? true
          if (value === next) return
          setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          terminal: {
            opened: terminalOpened,
            open() {
              setTerminalOpened(true)
            },
            close() {
              setTerminalOpened(false)
            },
            toggle() {
              setTerminalOpened(!terminalOpened())
            },
          },
          reviewPanel: {
            opened: reviewPanelOpened,
            open() {
              setReviewPanelOpened(true)
            },
            close() {
              setReviewPanelOpened(false)
            },
            toggle() {
              setReviewPanelOpened(!reviewPanelOpened())
            },
          },
          browser: {
            tabs: createMemo(() => store.sessionView[key()]?.browser ?? {}),
            get(tabID: string) {
              return store.sessionView[key()]?.browser?.[tabID]
            },
            open(tabID: string, url: string, title?: string) {
              const session = key()
              browserState(session)
              const current = store.sessionView[session]?.browser?.[tabID]
              const next = normalizeBrowserURL(url)
              if (!next) return
              const tab = browserTab(tabID)
              const currentTabs = store.sessionTabs[session]
              const nextTabs = currentTabs?.all.includes(tab) ? currentTabs : nextSessionTabsForOpen(currentTabs, tab)
              setStore("sessionTabs", session, nextTabs)
              setStore("sessionView", session, "browser", tabID, createBrowserState(next, title, current))
            },
            update(tabID: string, next: Partial<NonNullable<SessionView["browser"]>[string]>) {
              const session = key()
              const current = store.sessionView[session]?.browser?.[tabID]
              if (!current) return
              setStore("sessionView", session, "browser", tabID, { ...current, ...next })
            },
            sync(
              tabID: string,
              next: {
                url?: string
                input?: string
                title?: string
                loading?: boolean
                error?: string
              },
            ) {
              const session = key()
              const current = store.sessionView[session]?.browser?.[tabID]
              if (!current) return
              setStore("sessionView", session, "browser", tabID, syncBrowserViewState(current, next))
            },
            close(tabID: string) {
              const session = key()
              const current = store.sessionView[session]?.browser
              if (!current || !current[tabID]) return
              const tab = browserTab(tabID)
              const tabs = store.sessionTabs[session]
              if (tabs?.all.includes(tab)) {
                const all = tabs.all.filter((item) => item !== tab)
                const index = tabs.all.findIndex((item) => item === tab)
                const active =
                  tabs.active === tab ? tabs.all[index - 1] ?? tabs.all[index + 1] ?? all[0] : tabs.active
                setStore("sessionTabs", session, { all, active })
              }
              setStore(
                "sessionView",
                session,
                "browser",
                produce((draft) => {
                  if (!draft) return
                  delete draft[tabID]
                }),
              )
            },
            goBack(tabID: string) {
              const session = key()
              const current = store.sessionView[session]?.browser?.[tabID]
              if (!current || current.index <= 0) return
              const index = current.index - 1
              const url = current.history[index] ?? current.url
              setStore("sessionView", session, "browser", tabID, {
                ...current,
                index,
                url,
                input: url,
                loading: true,
                error: undefined,
                canGoBack: index > 0,
                canGoForward: index < current.history.length - 1,
              })
            },
            goForward(tabID: string) {
              const session = key()
              const current = store.sessionView[session]?.browser?.[tabID]
              if (!current || current.index >= current.history.length - 1) return
              const index = current.index + 1
              const url = current.history[index] ?? current.url
              setStore("sessionView", session, "browser", tabID, {
                ...current,
                index,
                url,
                input: url,
                loading: true,
                error: undefined,
                canGoBack: index > 0,
                canGoForward: index < current.history.length - 1,
              })
            },
            refresh(tabID: string) {
              const session = key()
              const current = store.sessionView[session]?.browser?.[tabID]
              if (!current) return
              setStore("sessionView", session, "browser", tabID, {
                ...current,
                loading: true,
                error: undefined,
              })
            },
          },
          review: {
            open: createMemo(() => s().reviewOpen ?? []),
            setOpen(open: string[]) {
              const session = key()
              const next = Array.from(new Set(open))
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: next,
                })
                return
              }

              if (same(current.reviewOpen, next)) return
              setStore("sessionView", session, "reviewOpen", next)
            },
            openPath(path: string) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: [path],
                })
                return
              }

              if (!current.reviewOpen) {
                setStore("sessionView", session, "reviewOpen", [path])
                return
              }

              if (current.reviewOpen.includes(path)) return
              setStore("sessionView", session, "reviewOpen", current.reviewOpen.length, path)
            },
            closePath(path: string) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current) return

              const index = current.indexOf(path)
              if (index === -1) return
              setStore(
                "sessionView",
                session,
                "reviewOpen",
                produce((draft) => {
                  if (!draft) return
                  draft.splice(index, 1)
                }),
              )
            },
            togglePath(path: string) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current || !current.includes(path)) {
                this.openPath(path)
                return
              }

              this.closePath(path)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const path = createMemo(() => sessionPath(key()))
        const tabs = createMemo(() => store.sessionTabs[key()] ?? { all: [] })
        const normalize = (tab: string) => normalizeSessionTab(path(), tab)
        const normalizeAll = (all: string[]) => normalizeSessionTabList(path(), all)
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          setActive(tab: string | undefined) {
            const session = key()
            const next = tab ? normalize(tab) : tab
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: [], active: next })
            } else {
              setStore("sessionTabs", session, "active", next)
            }
          },
          setAll(all: string[]) {
            const session = key()
            const next = normalizeAll(all).filter((tab) => tab !== "review")
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: next, active: undefined })
            } else {
              setStore("sessionTabs", session, "all", next)
            }
          },
          async open(tab: string) {
            const session = key()
            const next = nextSessionTabsForOpen(store.sessionTabs[session], normalize(tab))
            setStore("sessionTabs", session, next)
          },
          close(tab: string) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return

            if (tab === "review") {
              if (current.active !== tab) return
              setStore("sessionTabs", session, "active", current.all[0])
              return
            }

            const all = current.all.filter((x) => x !== tab)
            if (current.active !== tab) {
              setStore("sessionTabs", session, "all", all)
              return
            }

            const index = current.all.findIndex((f) => f === tab)
            const next = current.all[index - 1] ?? current.all[index + 1] ?? all[0]
            batch(() => {
              setStore("sessionTabs", session, "all", all)
              setStore("sessionTabs", session, "active", next)
            })
          },
          move(tab: string, to: number) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "sessionTabs",
              session,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
      detachedPanels: {
        list: createMemo(() => store.detachedPanels),
        listFor(sessionKey: string | Accessor<string>) {
          const key = createSessionKeyReader(sessionKey, ensureKey)
          return createMemo(() => store.detachedPanels.filter((item) => item.sessionKey === key()))
        },
        get(detachedWindowID: string) {
          return store.detachedPanels.find((item) => item.detachedWindowID === detachedWindowID)
        },
        isDetached(sessionKey: string | Accessor<string>, tab: string) {
          const key = createSessionKeyReader(sessionKey, ensureKey)
          return createMemo(() => store.detachedPanels.some((item) => item.sessionKey === key() && item.tab === tab))
        },
        sync(records: DetachedPanelRecord[]) {
          setStore("detachedPanels", records)
        },
        detach(input: DetachedPanelRecord) {
          const exists = store.detachedPanels.some((item) => item.detachedWindowID === input.detachedWindowID)
          if (exists) return
          setStore("detachedPanels", store.detachedPanels.length, input)
        },
        redock(detachedWindowID: string, placement?: DetachedPanelPlacement) {
          const current = store.detachedPanels.find((item) => item.detachedWindowID === detachedWindowID)
          if (!current) return

          const session = current.sessionKey
          const tabs = store.sessionTabs[session] ?? { all: [], active: undefined }
          const base = tabs.all.filter((item) => item !== current.tab)
          const beforeIndex =
            placement?.beforeTab !== undefined ? base.findIndex((item) => item === placement.beforeTab) : -1
          const afterIndex =
            placement?.afterTab !== undefined ? base.findIndex((item) => item === placement.afterTab) : -1
          const insertIndex =
            beforeIndex >= 0
              ? beforeIndex
              : afterIndex >= 0
                ? afterIndex + 1
                : tabs.active
                  ? Math.max(0, base.findIndex((item) => item === tabs.active) + 1)
                  : base.length
          const all = base.slice()
          all.splice(Math.max(0, Math.min(insertIndex, all.length)), 0, current.tab)

          batch(() => {
            setStore("sessionTabs", session, { all, active: current.tab })
            setStore(
              "detachedPanels",
              produce((draft) => {
                const index = draft.findIndex((item) => item.detachedWindowID === detachedWindowID)
                if (index === -1) return
                draft.splice(index, 1)
              }),
            )
          })
        },
      },
    }
  },
})
