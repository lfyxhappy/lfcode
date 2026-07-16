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
import { same } from "@/utils/same"
import {
  decodeSessionStorageDirectory,
  normalizeSessionDirSlug,
  normalizeSessionStorageKey,
} from "@/utils/session-key"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import { createPathHelpers } from "./file/path"
import {
  browserTab,
  DEFAULT_BROWSER_URL,
  isBrowserTab,
  isSideChatTab,
  normalizeBrowserURL,
  sideChatTab,
  sideChatTabID,
} from "@/pages/session/helpers"
import { pinnedSessionKey, projectActivityTime, workspaceKey } from "@/pages/layout/helpers"
import type { SessionViewportStateV3 } from "@/pages/session/scroll-snapshot"
import {
  migrateViewportStateV3,
  normalizeSessionViewStateV4,
  type SessionViewStateV4,
} from "@/pages/session/session-view-state"

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
  viewportSnapshot?: SessionViewportStateV3
  sessionState?: SessionViewStateV4
  turnStart?: number
  reviewEnabled?: boolean
  summaryCard?: boolean
  reviewOpen?: string[]
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
type SessionViewMigrationInput = {
  scroll?: unknown
  viewportSnapshot?: unknown
  sessionState?: unknown
  turnStart?: unknown
  reviewEnabled?: unknown
  summaryCard?: unknown
  reviewOpen?: unknown
  sideChat?: unknown
  browser?: unknown
}

type TabHandoff = {
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const sessionTabsScore = (tabs: SessionTabs) => tabs.all.length + (tabs.active ? 1 : 0)

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  const normalized = normalizeSessionStorageKey(key)
  touch(normalized)
  seed(normalized)
  return normalized
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => string) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    return ensure(value)
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

function nextSessionTabsForInsert(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: current?.active }
  if (all.includes(tab)) return { all, active: current?.active }
  return { all: [...all, tab], active: current?.active }
}

function getLegacySideChatSessionID(view: unknown, tab: string) {
  const remap = (tab: string) => {
    const id = sideChatTabID(tab)
    if (!id) return tab
    const sideChat = isRecord(view) && isRecord(view.sideChat) ? view.sideChat : undefined
    const tabs = sideChat && isRecord(sideChat.tabs) ? sideChat.tabs : undefined
    const rawTab = tabs && isRecord(tabs[id]) ? tabs[id] : undefined
    const sessionID = rawTab && typeof rawTab.sessionID === "string" ? rawTab.sessionID : undefined
    if (sessionID) return sideChatTab(sessionID)
    if (id.startsWith("ses_")) return tab
    return undefined
  }
  return remap(tab)
}

function remapStoredSideChatTabs(tabs: SessionTabs, view: unknown) {
  const all = Array.from(
    new Set(
      tabs.all.flatMap((tab) => {
        const next = getLegacySideChatSessionID(view, tab)
        return next ? [next] : []
      }),
    ),
  )
  const active = tabs.active ? getLegacySideChatSessionID(view, tabs.active) : undefined
  return {
    all,
    active: active && all.includes(active) ? active : all[0],
  } satisfies SessionTabs
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
  const root = decodeSessionStorageDirectory(dir)
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
    const value = isBrowserTab(tab) || isSideChatTab(tab) ? tab : normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPath(key)
  const all = normalizeSessionTabList(path, tabs.all)
  const active = tabs.active
    ? isBrowserTab(tabs.active) || isSideChatTab(tabs.active)
      ? tabs.active
      : normalizeSessionTab(path, tabs.active)
    : undefined
  return {
    all,
    active: active && all.includes(active) ? active : all[0],
  }
}

const mergeStoredSessionTabs = (current: SessionTabs | undefined, next: SessionTabs) => {
  if (!current) return next

  const primary = sessionTabsScore(next) > sessionTabsScore(current) ? next : current
  const secondary = primary === next ? current : next
  const all = Array.from(new Set([...primary.all, ...secondary.all]))
  const active =
    (primary.active && all.includes(primary.active) ? primary.active : undefined) ??
    (secondary.active && all.includes(secondary.active) ? secondary.active : undefined) ??
    all[0]

  return { all, active }
}

const mergeStoredSessionView = (current: SessionView | undefined, next: SessionView) => {
  if (!current) return next

  const primary = next
  const secondary = current
  const reviewEnabled = primary.reviewEnabled ?? secondary.reviewEnabled
  const summaryCard = primary.summaryCard ?? secondary.summaryCard
  const reviewOpen = primary.reviewOpen ?? secondary.reviewOpen
  const browser = primary.browser || secondary.browser ? { ...(secondary.browser ?? {}), ...(primary.browser ?? {}) } : undefined

  return {
    scroll: { ...secondary.scroll, ...primary.scroll },
    viewportSnapshot: primary.viewportSnapshot ?? secondary.viewportSnapshot,
    sessionState: primary.sessionState ?? secondary.sessionState,
    turnStart: primary.turnStart ?? secondary.turnStart,
    reviewEnabled,
    summaryCard,
    reviewOpen: reviewOpen ? Array.from(new Set(reviewOpen)) : undefined,
    browser,
  } satisfies SessionView
}

function normalizeViewportSnapshot(value: unknown) {
  if (!isRecord(value)) return undefined
  if (value.version !== 3) return undefined
  if (typeof value.assistantRevision !== "string") return undefined
  if (typeof value.historyTurnStart !== "number" || !Number.isFinite(value.historyTurnStart) || value.historyTurnStart < 0) return undefined
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return undefined
  if (value.mode === "bottom") {
    return {
      version: 3,
      mode: "bottom",
      assistantRevision: value.assistantRevision,
      historyTurnStart: Math.trunc(value.historyTurnStart),
      updatedAt: value.updatedAt,
    } satisfies SessionViewportStateV3
  }
  if (value.mode !== "anchor") return undefined
  if (typeof value.anchorBlockId !== "string" || !value.anchorBlockId) return undefined
  if (typeof value.anchorTurnId !== "string" || !value.anchorTurnId) return undefined
  if (typeof value.anchorOffsetPx !== "number" || !Number.isFinite(value.anchorOffsetPx)) return undefined
  return {
    version: 3,
    mode: "anchor",
    assistantRevision: value.assistantRevision,
    historyTurnStart: Math.trunc(value.historyTurnStart),
    anchorBlockId: value.anchorBlockId,
    anchorTurnId: value.anchorTurnId,
    anchorOffsetPx: value.anchorOffsetPx,
    updatedAt: value.updatedAt,
  } satisfies SessionViewportStateV3
}

function matchesViewportSnapshot(value: unknown, snapshot: SessionViewportStateV3 | undefined) {
  if (!snapshot || !isRecord(value)) return value === snapshot
  if (value.version !== snapshot.version || value.mode !== snapshot.mode) return false
  if (value.assistantRevision !== snapshot.assistantRevision) return false
  if (value.historyTurnStart !== snapshot.historyTurnStart) return false
  if (value.updatedAt !== snapshot.updatedAt) return false
  if (snapshot.mode === "bottom") return true
  return (
    value.anchorBlockId === snapshot.anchorBlockId &&
    value.anchorTurnId === snapshot.anchorTurnId &&
    value.anchorOffsetPx === snapshot.anchorOffsetPx
  )
}

export function normalizeStoredSessionView(value: unknown) {
  if (!isRecord(value)) return

  let changed = false
  const view = value as SessionViewMigrationInput
  const viewportSnapshot = (() => {
    if (view.viewportSnapshot === undefined) return undefined
    const normalized = normalizeViewportSnapshot(view.viewportSnapshot)
    if (!normalized) {
      changed = true
      return undefined
    }
    if (!matchesViewportSnapshot(view.viewportSnapshot, normalized)) changed = true
    return normalized
  })()
  const sessionState = (() => {
    if (view.sessionState !== undefined) {
      const normalized = normalizeSessionViewStateV4(view.sessionState)
      if (!normalized) changed = true
      return normalized
    }
    const migrated = migrateViewportStateV3(viewportSnapshot)
    if (migrated) changed = true
    return migrated
  })()
  const browser = (() => {
    if (view.browser === undefined) return undefined
    if (!isRecord(view.browser)) {
      changed = true
      return undefined
    }

    const normalized = Object.fromEntries(
      Object.entries(view.browser).flatMap(([tabID, state]) => {
        const next = normalizeBrowserViewState(state)
        if (!next) {
          changed = true
          return []
        }
        if (next !== state) changed = true
        return [[tabID, next] satisfies [string, BrowserViewState]]
      }),
    )

    return Object.keys(normalized).length > 0 ? normalized : undefined
  })()

  const scroll = isRecord(view.scroll)
    ? Object.fromEntries(
        Object.entries(view.scroll).flatMap(([tabID, pos]) => {
          // V2 owns the timeline position. Keep scroll state for other tabs only.
          if (tabID === "session") {
            changed = true
            return []
          }
          if (!isRecord(pos)) {
            changed = true
            return []
          }
          if (typeof pos.x !== "number" || typeof pos.y !== "number") {
            changed = true
            return []
          }
          return [[tabID, { x: pos.x, y: pos.y } satisfies SessionScroll]]
        }),
      )
    : {}
  if (!isRecord(view.scroll)) changed = true
  const turnStart =
    typeof view.turnStart === "number" && Number.isFinite(view.turnStart) && view.turnStart >= 0
      ? Math.trunc(view.turnStart)
      : undefined
  if (view.turnStart !== undefined && turnStart === undefined) changed = true

  const reviewOpen = Array.isArray(view.reviewOpen)
    ? Array.from(new Set(view.reviewOpen.filter((item): item is string => typeof item === "string")))
    : undefined
  if (view.reviewOpen !== undefined && !Array.isArray(view.reviewOpen)) changed = true
  const reviewEnabled = typeof view.reviewEnabled === "boolean" ? view.reviewEnabled : undefined
  if (view.reviewEnabled !== undefined && typeof view.reviewEnabled !== "boolean") changed = true
  const summaryCard = typeof view.summaryCard === "boolean" ? view.summaryCard : undefined
  if (view.summaryCard !== undefined && typeof view.summaryCard !== "boolean") changed = true
  if (view.sideChat !== undefined) changed = true

  if ((view as Record<string, unknown>).timelineMessageID !== undefined) changed = true
  if ((view as Record<string, unknown>).pendingMessage !== undefined) changed = true
  if ((view as Record<string, unknown>).pendingMessageAt !== undefined) changed = true

  return {
    changed,
    view: {
      scroll,
      viewportSnapshot,
      sessionState,
      turnStart,
      reviewEnabled,
      summaryCard,
      reviewOpen,
      browser,
    } as SessionView,
  }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const server = useServer()
    const platform = usePlatform()

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
        if (review.defaultClosedApplied === true && typeof review.panelOpened === "boolean") return review
        return {
          ...review,
          panelOpened: false,
          defaultClosedApplied: true,
        }
      })()

      const sessionTabs = value.sessionTabs
      const migratedSessionTabs = (() => {
        if (!isRecord(sessionTabs)) return sessionTabs

        let changed = false
        const next: Record<string, SessionTabs | unknown> = {}

        for (const [key, tabs] of Object.entries(sessionTabs)) {
          const normalizedKey = normalizeSessionStorageKey(key)
          if (normalizedKey !== key) changed = true
          if (!isRecord(tabs) || !Array.isArray(tabs.all)) {
            if (!(normalizedKey in next)) next[normalizedKey] = tabs
            if (normalizedKey in next && normalizedKey !== key) changed = true
            continue
          }

          const current = {
            all: tabs.all.filter((tab): tab is string => typeof tab === "string"),
            active: typeof tabs.active === "string" ? tabs.active : undefined,
          }
          const normalized = normalizeStoredSessionTabs(normalizedKey, current)
          if (current.all.length !== tabs.all.length) changed = true
          if (!same(current.all, normalized.all) || current.active !== normalized.active) changed = true
          if (tabs.active !== undefined && typeof tabs.active !== "string") changed = true

          const existing = next[normalizedKey]
          if (!existing || !isRecord(existing) || !Array.isArray(existing.all)) {
            if (existing) changed = true
            next[normalizedKey] = normalized
            continue
          }

          changed = true
          next[normalizedKey] = mergeStoredSessionTabs(existing as SessionTabs, normalized)
        }

        if (!changed) return sessionTabs
        return next
      })()

      const sessionView = value.sessionView
      const migratedSessionView = (() => {
        if (!isRecord(sessionView)) return sessionView

        let changed = false
        const next: Record<string, SessionView | unknown> = {}

        for (const [key, view] of Object.entries(sessionView)) {
          const normalizedKey = normalizeSessionStorageKey(key)
          if (normalizedKey !== key) changed = true
          const normalizedView = normalizeStoredSessionView(view)
          if (!normalizedView) {
            if (!(normalizedKey in next)) next[normalizedKey] = view
            if (normalizedKey in next && normalizedKey !== key) changed = true
            continue
          }
          if (normalizedView.changed) changed = true
          const existing = next[normalizedKey]
          if (!existing || !isRecord(existing) || !isRecord((existing as SessionView).scroll)) {
            if (existing) changed = true
            next[normalizedKey] = normalizedView.view
            continue
          }

          changed = true
          next[normalizedKey] = mergeStoredSessionView(existing as SessionView, normalizedView.view)
        }

        if (!changed) return sessionView
        return next
      })()

      const reconciledSessionTabs = (() => {
        if (!isRecord(migratedSessionTabs) || !isRecord(migratedSessionView)) return migratedSessionTabs

        let changed = false
        const next: Record<string, SessionTabs | unknown> = {}

        for (const [key, tabs] of Object.entries(migratedSessionTabs)) {
          if (!isRecord(tabs) || !Array.isArray(tabs.all)) {
            next[key] = tabs
            continue
          }

          const current = {
            all: tabs.all.filter((tab): tab is string => typeof tab === "string"),
            active: typeof tabs.active === "string" ? tabs.active : undefined,
          }
          const rawView = isRecord(sessionView)
            ? sessionView[key] ?? sessionView[normalizeSessionStorageKey(key)]
            : undefined
          const normalized = remapStoredSideChatTabs(current, rawView)
          if (!same(current.all, normalized.all) || current.active !== normalized.active) changed = true
          next[key] = normalized
        }

        if (!changed) return migratedSessionTabs
        return next
      })()

      const pinnedProjects = Array.isArray(value.pinnedProjects)
        ? Array.from(
            new Set(
              value.pinnedProjects.flatMap((item) => {
                if (typeof item !== "string") return []
                return [workspaceKey(item)]
              }),
            ),
          )
        : []
      const migratedPinnedProjects =
        Array.isArray(value.pinnedProjects) &&
        value.pinnedProjects.length === pinnedProjects.length &&
        value.pinnedProjects.every((item, index) => typeof item === "string" && workspaceKey(item) === pinnedProjects[index])
          ? value.pinnedProjects
          : pinnedProjects

      const pinnedSessions = (() => {
        if (!isRecord(value.pinnedSessions)) return {}
        return Object.fromEntries(
          Object.entries(value.pinnedSessions).flatMap(([key, pinned]) => {
            if (!pinned) return []
            const [directory, sessionID] = key.split("\n")
            if (!directory || !sessionID) return []
            return [[pinnedSessionKey(directory, sessionID), true]]
          }),
        )
      })()
      const migratedPinnedSessions =
        isRecord(value.pinnedSessions) &&
        same(Object.keys(value.pinnedSessions), Object.keys(pinnedSessions)) &&
        Object.values(value.pinnedSessions).every(Boolean)
          ? value.pinnedSessions
          : pinnedSessions

      if (
        migratedSidebar === sidebar &&
        migratedReview === review &&
        migratedFileTree === fileTree &&
        reconciledSessionTabs === sessionTabs &&
        migratedSessionView === sessionView &&
        migratedPinnedProjects === value.pinnedProjects &&
        migratedPinnedSessions === value.pinnedSessions
      ) {
        return value
      }

      return {
        ...value,
        sidebar: migratedSidebar,
        review: migratedReview,
        fileTree: migratedFileTree,
        sessionTabs: reconciledSessionTabs,
        sessionView: migratedSessionView,
        pinnedProjects: migratedPinnedProjects,
        pinnedSessions: migratedPinnedSessions,
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

    const target = Persist.global("layout.v13", ["layout", "layout.v7", "layout.v8", "layout.v9", "layout.v10", "layout.v11", "layout.v12"])
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
          panelOpened: false,
          defaultClosedApplied: true,
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
        pinnedProjects: [] as string[],
        pinnedSessions: {} as Record<string, true>,
        detachedPanels: [] as DetachedPanelRecord[],
        handoff: {
          tabs: undefined as TabHandoff | undefined,
        },
      }),
    )

    const MAX_SESSION_KEYS = 50
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

    const projectPinKey = (directory: string) => workspaceKey(directory)
    const sessionPin = (directory: string, sessionID: string) => pinnedSessionKey(directory, sessionID)

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
        .map((project, index) => ({ project, index }))
        .sort((a, b) => {
          const diff = projectActivityTime(b.project) - projectActivityTime(a.project)
          if (diff) return diff
          return a.index - b.index
        })
        .map((item) => item.project)
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

    return {
      ready,
      handoff: {
        tabs: createMemo(() => store.handoff?.tabs),
        setTabs(dir: string, id: string) {
          setStore("handoff", "tabs", { dir: normalizeSessionDirSlug(dir), id, at: Date.now() })
        },
        clearTabs() {
          if (!store.handoff?.tabs) return
          setStore("handoff", "tabs", undefined)
        },
      },
      projects: {
        list,
        isPinned(directory: string) {
          return store.pinnedProjects.includes(projectPinKey(directory))
        },
        setPinned(directory: string, value: boolean) {
          const key = projectPinKey(directory)
          const exists = store.pinnedProjects.includes(key)
          if (value) {
            if (exists) return
            setStore("pinnedProjects", (current) => [key, ...current.filter((item) => item !== key)])
            return
          }
          if (!exists) return
          setStore("pinnedProjects", (current) => current.filter((item) => item !== key))
        },
        togglePinned(directory: string) {
          this.setPinned(directory, !this.isPinned(directory))
        },
        open(directory: string) {
          const root = rootFor(directory)
          if (server.projects.list().find((x) => workspaceKey(x.worktree) === workspaceKey(root))) return
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
      sessions: {
        view: createMemo(() => Object.keys(store.sessionView)),
        tabs: createMemo(() => Object.keys(store.sessionTabs)),
        isPinned(directory: string, sessionID: string) {
          return store.pinnedSessions[sessionPin(directory, sessionID)] === true
        },
        setPinned(directory: string, sessionID: string, value: boolean) {
          const key = sessionPin(directory, sessionID)
          if (value) {
            if (store.pinnedSessions[key]) return
            setStore("pinnedSessions", key, true)
            return
          }
          if (!store.pinnedSessions[key]) return
          setStore(
            "pinnedSessions",
            produce((draft) => {
              delete draft[key]
            }),
          )
        },
        togglePinned(directory: string, sessionID: string) {
          this.setPinned(directory, sessionID, !this.isPinned(directory, sessionID))
        },
        stamp() {
          return Object.keys(store.pinnedSessions)
            .sort()
            .join("|")
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
            setStore("review", { diffStyle, panelOpened: false, defaultClosedApplied: true })
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
        const reviewPanelOpened = createMemo(() => store.review?.panelOpened ?? false)
        const reviewEnabled = createMemo(() => store.sessionView[key()]?.reviewEnabled ?? false)
        const summaryCardOpened = createMemo(() => store.sessionView[key()]?.summaryCard ?? true)

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
            setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next, defaultClosedApplied: true })
            return
          }

          const value = current.panelOpened ?? false
          if (value === next) return
          setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll, flush = false) {
            const session = key()
            scroll.setScroll(session, tab, pos)
            if (flush) scroll.flush(session)
          },
          viewportSnapshot: createMemo(() => store.sessionView[key()]?.viewportSnapshot),
          sessionState: createMemo(() => store.sessionView[key()]?.sessionState),
          turnStart: createMemo(() => store.sessionView[key()]?.turnStart),
          reviewEnabled,
          setReviewEnabled(next: boolean) {
            const session = key()
            const current = store.sessionView[session]
            if (!current) {
              setStore("sessionView", session, {
                scroll: {},
                reviewEnabled: next,
              })
              return
            }
            const value = current.reviewEnabled ?? false
            if (value === next) return
            setStore("sessionView", session, "reviewEnabled", next)
          },
          summaryCard: {
            opened: summaryCardOpened,
            open() {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, { scroll: {}, summaryCard: true })
                return
              }
              if (current.summaryCard ?? true) return
              setStore("sessionView", session, "summaryCard", true)
            },
            close() {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, { scroll: {}, summaryCard: false })
                return
              }
              if (!(current.summaryCard ?? true)) return
              setStore("sessionView", session, "summaryCard", false)
            },
            toggle() {
              const session = key()
              const current = store.sessionView[session]
              const next = !(current?.summaryCard ?? true)
              if (!current) {
                setStore("sessionView", session, { scroll: {}, summaryCard: next })
                return
              }
              setStore("sessionView", session, "summaryCard", next)
            },
          },
          setViewportSnapshot(snapshot: SessionViewportStateV3 | undefined) {
            const session = key()
            if (!store.sessionView[session]) {
              setStore("sessionView", session, {
                scroll: {},
                viewportSnapshot: snapshot,
              })
              return
            }
            setStore("sessionView", session, "viewportSnapshot", snapshot)
          },
          setSessionState(state: SessionViewStateV4 | undefined) {
            const session = key()
            if (!store.sessionView[session]) {
              setStore("sessionView", session, {
                scroll: {},
                sessionState: state,
              })
              return
            }
            setStore("sessionView", session, "sessionState", state)
          },
          setTurnStart(next: number | undefined) {
            const session = key()
            const value =
              typeof next === "number" && Number.isFinite(next) && next >= 0 ? Math.trunc(next) : undefined
            if (!store.sessionView[session]) {
              setStore("sessionView", session, {
                scroll: {},
                turnStart: value,
              })
              return
            }
            if (store.sessionView[session]?.turnStart === value) return
            setStore("sessionView", session, "turnStart", value)
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
            open(tabID: string, url: string, title?: string, options?: { activate?: boolean }) {
              const session = key()
              browserState(session)
              const current = store.sessionView[session]?.browser?.[tabID]
              const next = normalizeBrowserURL(url)
              if (!next) return
              const tab = browserTab(tabID)
              const currentTabs = store.sessionTabs[session]
              const nextTabs =
                currentTabs?.all.includes(tab)
                  ? options?.activate === false && currentTabs
                    ? { ...currentTabs }
                    : currentTabs
                  : options?.activate === false
                    ? nextSessionTabsForInsert(currentTabs, tab)
                    : nextSessionTabsForOpen(currentTabs, tab)
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
