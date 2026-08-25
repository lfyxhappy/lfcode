import type { Message, Part, UserMessage } from "@lfcode-ai/sdk/v2"
import type { Session } from "@lfcode-ai/sdk/v2/client"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import {
  batch,
  onCleanup,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createComputed,
  createSignal,
  on,
  onMount,
  untrack,
  createResource,
  lazy,
  type Accessor,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import { createStore, produce } from "solid-js/store"
import { ResizeHandle } from "@lfcode-ai/ui/resize-handle"
import { Select } from "@lfcode-ai/ui/select"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { Icon } from "@lfcode-ai/ui/icon"
import { createAutoScroll } from "@lfcode-ai/ui/hooks"
import { previewSelectedLines } from "@lfcode-ai/ui/pierre/selection-bridge"
import { showToast } from "@lfcode-ai/ui/toast"
import { Binary } from "@lfcode-ai/shared/util/binary"
import { getFilename } from "@lfcode-ai/shared/util/path"
import type { FileReferenceApp } from "@lfcode-ai/ui/context/file-reference"
import { checksum } from "@lfcode-ai/shared/util/encode"
import { useLocation, useSearchParams } from "@solidjs/router"
import { NewSessionView } from "@/components/session/session-new-view"
import { SessionHeader } from "@/components/session/session-header"
import { useComments } from "@/context/comments"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt, type Prompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import type { ExternalAgentControl } from "@/components/prompt-input"
import { formatExternalAgentPrompt, type ExternalAgentPrompt } from "@/components/prompt-input/external-agent"
import { CLAUDE_CODE_CONTROLS, type ClaudePermissionMode } from "@/pages/session/claude-code-controls"
import type { HtmlComponentEventDetail } from "@lfcode-ai/ui/markdown"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import { findPluginSessionComposer } from "@/pages/session/plugin-session-composer"
import { isPluginProjectRoute } from "@/pages/session/plugin-project-route"
import { resolveTavernPluginAvailability } from "@/pages/session/tavern-plugin-availability"
import { isTavernManagedDirectory } from "@/pages/session/tavern-project-directory"
import { workspaceKey } from "@/pages/layout/helpers"
import {
  BROWSER_REQUEST_OPEN_EVENT,
  type BrowserOpenRequestDetail,
  browserTab,
  browserTabID,
  createBrowserTabID,
  createOpenReviewFile,
  createSessionTabs,
  createSizing,
  normalizeBrowserRequestURL,
  isSideChatTab,
  sideChatTab,
  sideChatTabID,
} from "@/pages/session/helpers"
import { getSessionHandoff, SESSION_HANDOFF_EVENT, setSessionHandoff } from "@/pages/session/handoff"
import {
  deepActiveElement,
  eventBelongsToEditableSurface,
  shouldRoutePrintableKeyToComposer,
} from "@/pages/session/editable-surface"
import { buildHtmlComponentFollowupDraft } from "@/pages/session/html-component-followup"
import { batchFollowupDrafts, canBatchFollowupDrafts } from "@/pages/session/followup-batch"
import { wideSessionLayoutQuery } from "@/pages/session/wide-layout"
import {
  BROWSER_KEEPALIVE_SLOT_EVENT,
  hasBrowserKeepaliveSlots,
} from "@/pages/session/browser-keepalive-slot"
import type { DiffStyle, SessionReviewTabProps } from "@/pages/session/review-tab"
import { useSessionLayout } from "@/pages/session/session-layout"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SelectionToolbar } from "@/pages/session/selection-toolbar"
import { buildDetachedSidePanelRoute, getDetachedSidePanelContext } from "@/pages/session/detached-side-panel"
import { createLfcodeEditorPath } from "@/pages/session/file-tab-navigation"
import {
  buildSessionMessageViews,
  createSessionHistoryWindow,
  createSessionTimelineMessageSource,
} from "@/pages/session/session-timeline-history"
import { createSessionContentSignature, sessionContentRevision } from "@/pages/session/session-view-state"
import {
  activateSessionViewSurface,
  registerSessionViewport,
  registerSessionViewSurface,
  sessionViewSurfaceDiagnostics,
  startSessionViewMemoryGuard,
} from "@/pages/session/session-viewport-registry"
import { TimelineVirtualController } from "@/pages/session/timeline-virtual-controller"
import { findTimelineViewportAnchor } from "@/pages/session/timeline-viewport-anchor"
import { sessionVirtualCacheDiagnostics } from "@/pages/session/session-virtual-cache"
import {
  rememberSessionTimelineVisualSnapshot,
  sessionTimelineVisualSnapshotDiagnostics,
} from "@/pages/session/session-timeline-visual-cache"
import type { VirtualizerHandle } from "virtua/solid"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { decode64 } from "@/utils/base64"
import { Identifier } from "@/utils/id"
import { diffs as list } from "@/utils/diffs"
import { getParentPath, inferFileReferenceKind, resolveFileReferencePath } from "@lfcode-ai/ui/file-reference-path"
import { Persist, persisted } from "@/utils/persist"
import { SUBAGENT_VIEW_REQUEST_EVENT } from "@lfcode-ai/ui/message-part-events"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { createSessionStorageKey, normalizeSessionStorageKey } from "@/utils/session-key"
import { formatServerError } from "@/utils/server-errors"
import { isSessionStreaming } from "@/utils/session-status"
import { LINUX_APPS, MAC_APPS, WINDOWS_APPS } from "@/components/session/session-open-apps"
import { messageIdFromHash } from "@/pages/session/message-id-from-hash"
import { isNavigableSubagent } from "@/pages/session/subagent-view"
import { UiAutomationRegistry } from "@/automation/registry"
import {
  isSettingsTabUiDriverToken,
  sessionUiDriverTokens,
  settingsTabUiDriverSelector,
  type UiDriverEditorInput,
  type UiDriverNodeSnapshot,
  type UiDriverQueryInput,
  type UiDriverReadTextInput,
  type UiDriverTypeInput,
  type UiDriverWaitInput,
  type UiDriverToken,
} from "@/automation/ui-driver"

const emptyUserMessages: UserMessage[] = []
const emptyMessages: Message[] = []
type FollowupItem = FollowupDraft & { id: string }
type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">
const emptyFollowups: FollowupItem[] = []
type ReviewMode = "recent-1" | "recent-15" | "full"

type MainTimelineSurfaceState = {
  sessionID: string
  key: string
  source: ReturnType<typeof createSessionTimelineMessageSource>
  history: ReturnType<typeof createSessionHistoryWindow>
  ready: Accessor<boolean>
  historyMore: Accessor<boolean>
  historyLoading: Accessor<boolean>
  contentRevision: Accessor<number>
}

const MAX_FULL_REVIEW_FILES = 5000
const TavernManager = lazy(() => import("@/pages/session/tavern-manager").then((mod) => ({ default: mod.TavernManager })))
const TavernSessionPage = lazy(() => import("@/pages/session/tavern-session-page").then((mod) => ({ default: mod.TavernSessionPage })))
const TerminalPanel = lazy(() => import("@/pages/session/terminal-panel").then((mod) => ({ default: mod.TerminalPanel })))
const ClaudeCodeSession = lazy(() => import("@/pages/session/claude-code-session").then((mod) => ({ default: mod.ClaudeCodeSession })))
const BrowserKeepaliveHost = lazy(() => import("@/pages/session/browser-keepalive-host").then((mod) => ({ default: mod.BrowserKeepaliveHost })))
const DetachedSidePanelView = lazy(() => import("@/pages/session/detached-side-panel-view").then((mod) => ({ default: mod.DetachedSidePanelView })))
const SessionJobsRail = lazy(() => import("@/components/session/session-jobs-rail").then((mod) => ({ default: mod.SessionJobsRail })))
const SessionTimelineSurface = lazy(() => import("@/pages/session/session-timeline-surface").then((mod) => ({ default: mod.SessionTimelineSurface })))
const SessionSidePanel = lazy(() => import("@/pages/session/session-side-panel").then((mod) => ({ default: mod.SessionSidePanel })))
const SessionReviewTab = lazy(() => import("@/pages/session/review-tab").then((mod) => ({ default: mod.SessionReviewTab })))

export default function Page() {
  if (typeof window !== "undefined") {
    window.__LFCODE__ ??= {}
    window.__LFCODE__.sessionModuleSentinel = "pages/session.tsx:v1-filetab"
  }
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const settings = useSettings()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [browserKeepaliveActive, setBrowserKeepaliveActive] = createSignal(false)
  const routeLocation = useLocation()
  const routeMessageHash = createMemo(() => messageIdFromHash(routeLocation.hash))
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string; agentID?: string; view?: string }>()
  const { params, sessionKey, tabs, view } = useSessionLayout()
  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const [claudeBinding] = createResource(
    () => params.id,
    async (sessionID) => {
      if (!sessionID) return
      try {
        return (await sdk.client.claudeCode.get({ sessionID })).data ?? undefined
      } catch {
        return undefined
      }
    },
  )
  const claudeCodeSession = createMemo(() => claudeBinding())
  const [claudeTerminalConnected, setClaudeTerminalConnected] = createSignal(false)
  const [claudeTerminalRestart, setClaudeTerminalRestart] = createSignal(0)
  const [claudePermissionMode, setClaudePermissionMode] = createSignal<ClaudePermissionMode>()
  const [claudeModel, setClaudeModel] = createSignal<string>()

  const claudeControls = createMemo<ExternalAgentControl[]>(() => {
    const binding = claudeCodeSession()
    const models = (binding?.models ?? []).map((model) => ({
      id: `model-${model.id}`,
      group: "model" as const,
      kind: "input" as const,
      icon: "models" as const,
      label: model.label,
      shortcut: model.id,
      data: `/model ${model.id}`,
      selected: claudeModel() === model.id,
    }))
    const permissions = CLAUDE_CODE_CONTROLS.map((control) => ({
      ...control,
      label: language.t(control.labelKey),
      selected: claudePermissionMode() === control.permissionMode,
    }))
    return [...models, ...permissions]
  })

  createEffect(() => {
    const binding = claudeCodeSession()
    params.id
    setClaudeTerminalConnected(false)
    setClaudePermissionMode(binding?.permissionMode)
    setClaudeModel(undefined)
  })

  const submitClaudeComposer = async (input: ExternalAgentPrompt) => {
    const sessionID = params.id
    if (!sessionID) throw new Error(language.t("claudeCode.terminalUnavailable"))
    const data = formatExternalAgentPrompt(input)
    if (!data) return
    const response = await sdk.client.claudeCode.input({ sessionID, data })
    if (!response.data) throw new Error(language.t("claudeCode.terminalUnavailable"))
  }

  const sendClaudeControl = async (control: ExternalAgentControl) => {
    const sessionID = params.id
    if (!sessionID) throw new Error(language.t("claudeCode.terminalUnavailable"))
    if (control.group === "permissions" && control.permissionMode) {
      const response = await sdk.client.claudeCode.setPermissionMode({ sessionID, mode: control.permissionMode })
      if (!response.data) throw new Error(language.t("claudeCode.terminalUnavailable"))
      setClaudeTerminalConnected(false)
      setClaudePermissionMode(response.data.permissionMode)
      setClaudeTerminalRestart((value) => value + 1)
      return
    }
    const data = control.data
    if (!data) return
    const response =
      control.kind === "input"
        ? await sdk.client.claudeCode.input({ sessionID, data })
        : await sdk.client.claudeCode.key({ sessionID, data })
    if (!response.data) throw new Error(language.t("claudeCode.terminalUnavailable"))
    if (control.group === "model") setClaudeModel(control.data.replace("/model ", ""))
    if (control.group === "permissions" && control.permissionMode) setClaudePermissionMode(control.permissionMode)
  }

  onMount(() => {
    if (hasBrowserKeepaliveSlots()) setBrowserKeepaliveActive(true)
    return makeEventListener(window, BROWSER_KEEPALIVE_SLOT_EVENT, () => setBrowserKeepaliveActive(true))
  })

  createEffect(() => {
    if (!platform.onBrowserState) return
    return platform.onBrowserState((event) => {
      if (event.sessionKey !== sessionKey()) return
      if (event.closed) {
        layout.view(event.sessionKey).browser.close(event.tabID)
        tabs().close(browserTab(event.tabID))
        return
      }
      layout.view(event.sessionKey).browser.sync(event.tabID, event)
    })
  })

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      if (params.id) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ prompt: undefined })
    })
  })

  const [ui, setUi] = createStore({
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
    },
  })

  const composer = createSessionComposerState()
  const sessionActors = createMemo(() => (params.id ? ((sync.data.actor ?? {})[params.id] ?? []) : []))
  const selectedViewAgentID = createMemo(() => {
    const agentID = searchParams.agentID ?? "main"
    if (agentID === "main") return "main"
    if (isNavigableSubagent(sessionActors(), agentID)) return agentID
    return "main"
  })
  const openSubagent = async (actorID: string) => {
    const sessionID = params.id
    if (!sessionID || !actorID || actorID === "main") return
    if (!isNavigableSubagent(sessionActors(), actorID)) {
      try {
        await sync.session.sync(sessionID)
      } catch (error) {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: formatServerError(error, language.t, language.t("common.requestFailed")),
        })
        return
      }
    }
    if (params.id !== sessionID || !isNavigableSubagent(sessionActors(), actorID)) return
    setSearchParams({ agentID: actorID })
  }
  const [mainSelectionRoot, setMainSelectionRoot] = createSignal<HTMLElement>()
  const [activeSideChatContentRoot, setActiveSideChatContentRoot] = createSignal<HTMLDivElement>()
  const [activeSideChatInputRoot, setActiveSideChatInputRoot] = createSignal<HTMLDivElement>()
  const [activeMainTimelineSurface, setActiveMainTimelineSurface] = createSignal<MainTimelineSurfaceState>()
  const activeHistoryWindow = () => activeMainTimelineSurface()?.history

  createEffect(
    on(
      () => [params.id, selectedViewAgentID()] as const,
      () => {
        const agentID = selectedViewAgentID()
        if (!params.id) return
        if (agentID === (searchParams.agentID ?? "main")) return
        setSearchParams({ agentID: agentID === "main" ? undefined : agentID })
      },
      { defer: true },
    ),
  )

  const workspaceStorageKey = createMemo(() => createSessionStorageKey(params.dir))
  const workspaceTabs = createMemo(() => layout.tabs(workspaceStorageKey))
  const openLfcodeEditorPath = createLfcodeEditorPath({
    normalizePath: file.normalize,
    loadFile: file.load,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActiveTab: tabs().setActive,
  })

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== workspaceStorageKey()) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = params.id
    if (!id) return
    const key = sessionKey()
    const handoff = getSessionHandoff(key)
    const browser = handoff?.browser
    if (!browser?.url) return
    const consumedKey = `${key}\n${browser.url}\n${browser.title ?? ""}`
    if (consumedBrowserHandoffs.has(consumedKey)) return
    consumedBrowserHandoffs.add(consumedKey)

    openBrowserTab(browser.url, browser.title)
    setSessionHandoff(key, { browser: undefined })
  })

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: { browser?: { url: string; title?: string } } }>)
        .detail
      if (detail?.key !== sessionKey()) return
      const browser = detail.value?.browser
      if (!browser?.url) return
      const consumedKey = `${detail.key}\n${browser.url}\n${browser.title ?? ""}`
      if (consumedBrowserHandoffs.has(consumedKey)) return
      consumedBrowserHandoffs.add(consumedKey)
      openBrowserTab(browser.url, browser.title)
      setSessionHandoff(detail.key, { browser: undefined })
    }

    makeEventListener(window, SESSION_HANDOFF_EVENT, handler as EventListener)
  })

  // Layout follows the viewport, while platform remains the authority for
  // Electron-only capabilities such as local path and PTY operations.
  const isDesktop = createMediaQuery(wideSessionLayoutQuery)
  const size = createSizing()
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const desktopFileTreeOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const desktopSidePanelOpen = createMemo(() => desktopReviewOpen() || desktopFileTreeOpen())
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopReviewOpen()) return `${layout.session.width()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && !desktopReviewOpen())
  const historyRailSpace = createMemo(() => {
    const surface = activeMainTimelineSurface()
    if (!isDesktop() || !params.id || selectedViewAgentID() !== "main" || !surface) return false
    return surface.source.userMessages().length > 0
  })

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openFileTree = () => {
    layout.fileTree.open()
    layout.fileTree.setTab("all")
  }

  let pendingDeferredTabActivationFrame: number | undefined
  let pendingSideChatFocusFrame: number | undefined
  const activateSessionTabWhenReady = (tab: string, remaining = 8) => {
    if (pendingDeferredTabActivationFrame !== undefined) cancelAnimationFrame(pendingDeferredTabActivationFrame)
    pendingDeferredTabActivationFrame = requestAnimationFrame(() => {
      pendingDeferredTabActivationFrame = undefined
      if (tabs().active() === tab) return
      if (!tabs().all().includes(tab)) {
        if (remaining <= 0) return
        activateSessionTabWhenReady(tab, remaining - 1)
        return
      }

      tabs().setActive(tab)
      if (tabs().active() === tab || remaining <= 0) return
      activateSessionTabWhenReady(tab, remaining - 1)
    })
  }

  const openBrowserTab = (url: string, title?: string, activate = true) => {
    const id = createBrowserTabID()
    const tab = browserTab(id)
    batch(() => {
      layout.view(sessionKey()).browser.open(id, url, title)
      openReviewPanel()
      void tabs().open(tab)
      if (activate) tabs().setActive(tab)
    })
    if (activate && tabs().active() !== tab) activateSessionTabWhenReady(tab)
    return { id, tab }
  }

  const openDetachedBrowserTab = async (url: string, title: string | undefined, background: boolean) => {
    const id = createBrowserTabID()
    const tab = browserTab(id)
    const detachedWindowID = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const route = buildDetachedSidePanelRoute({
      detachedWindowID,
      sessionKey: sessionKey(),
      tab,
      kind: "browser",
    })
    batch(() => {
      layout.view(sessionKey()).browser.open(id, url, title, { background: true })
      layout.detachedPanels.detach({
        detachedWindowID,
        sessionKey: sessionKey(),
        tab,
        kind: "browser",
        sourceWindowID: -1,
        title,
      })
    })
    await platform
      .createDetachedSidePanelWindow?.({
        detachedWindowID,
        route,
        sessionKey: sessionKey(),
        tab,
        kind: "browser",
        title,
        background,
      })
      .catch(() => {
        layout.detachedPanels.redock(detachedWindowID)
      })
    return { id, tab, detachedWindowID }
  }

  const focusWithoutScroll = (el: HTMLDivElement | undefined) => {
    if (!el) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      el.focus()
    }
  }

  const scheduleSideChatInputFocus = () => {
    if (pendingSideChatFocusFrame !== undefined) cancelAnimationFrame(pendingSideChatFocusFrame)
    pendingSideChatFocusFrame = requestAnimationFrame(() => {
      pendingSideChatFocusFrame = requestAnimationFrame(() => {
        pendingSideChatFocusFrame = undefined
        focusWithoutScroll(activeSideChatInputRoot())
      })
    })
  }

  const openSideChatTab = (sideSessionID: string, options?: { focus?: boolean }) => {
    const tab = sideChatTab(sideSessionID)
    preserveMainTimelineViewport(() => {
      batch(() => {
        openReviewPanel()
        void tabs().open(tab)
        tabs().setActive(tab)
      })
    })
    if (tabs().active() !== tab) activateSessionTabWhenReady(tab)
    if (options?.focus !== false) scheduleSideChatInputFocus()
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<BrowserOpenRequestDetail>).detail
      if (detail?.sessionKey && normalizeSessionStorageKey(detail.sessionKey) !== sessionKey()) return
      if (detail?.requestID) {
        const consumed = ((
          window as typeof window & {
            __LFCODE_BROWSER_REQUESTS__?: Map<string, number>
          }
        ).__LFCODE_BROWSER_REQUESTS__ ??= new Map<string, number>())
        const now = Date.now()
        for (const [key, at] of consumed) {
          if (now - at <= 10_000) continue
          consumed.delete(key)
        }
        if (consumed.has(detail.requestID)) {
          event.preventDefault()
          return
        }
        consumed.set(detail.requestID, now)
      }
      const next = normalizeBrowserRequestURL(detail?.url)
      if (!next) {
        showToast({
          title: language.t("toast.browser.invalidUrl.title"),
          description: language.t("toast.browser.invalidUrl.description"),
          variant: "error",
        })
        return
      }

      event.preventDefault()
      if (detail?.reason === "tool") {
        const title = typeof detail.title === "string" ? detail.title : undefined
        if (detail.presentation === "sidebar") {
          openBrowserTab(next, title)
          return
        }
        void openDetachedBrowserTab(next, title, detail.presentation !== "detached")
        return
      }
      openBrowserTab(next)
    }

    makeEventListener(window, BROWSER_REQUEST_OPEN_EVENT, handler as EventListener)
  })

  onCleanup(() => {
    if (pendingDeferredTabActivationFrame !== undefined) cancelAnimationFrame(pendingDeferredTabActivationFrame)
    if (pendingSideChatFocusFrame !== undefined) cancelAnimationFrame(pendingSideChatFocusFrame)
  })

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const listedProject = createMemo(() =>
    globalSync.data.project.find((item) => workspaceKey(item.worktree) === workspaceKey(projectDirectory())),
  )
  // Only unlisted Tavern-managed directories need a direct project probe. A
  // normal new session already has enough project state from global sync.
  const tavernManagedDirectoryRoute = createMemo(() => isTavernManagedDirectory(projectDirectory()))
  const [resolvedProject] = createResource(
    () => (!params.id && !listedProject()?.extension && tavernManagedDirectoryRoute() ? projectDirectory() : undefined),
    async () =>
      (
        await sdk.client.project.getManaged({
          pluginID: "lfcode-tavern",
          type: "tavern",
        })
      ).data,
  )
  const project = createMemo(() => {
    const resolved = resolvedProject()
    if (resolved && workspaceKey(resolved.worktree) === workspaceKey(projectDirectory())) return resolved
    return listedProject()
  })
  const pluginContext = createMemo(() => params.id ? info()?.extension : project()?.extension)
  // Plugin manifests are only consumed by extension-owned session surfaces.
  // Avoid their RPC during a standard session startup.
  const [plugins, { refetch: refetchPlugins }] = createResource(
    () => (pluginContext() && sync.status === "complete" ? projectDirectory() : undefined),
    async (directory) => (await sdk.client.plugin.list({ directory })).data ?? [],
  )
  const pluginComposer = createMemo(() =>
    findPluginSessionComposer({ session: info(), project: project(), plugins: plugins() ?? [] }),
  )
  const pluginComposerPending = createMemo(
    () => !!(params.id ? info()?.extension : project()?.extension) && (sync.status !== "complete" || plugins.loading || plugins() === undefined),
  )
  const tavernPluginAvailability = createMemo(() =>
    resolveTavernPluginAvailability({
      pending: sync.status !== "complete" || plugins.loading || (plugins() === undefined && !plugins.error),
      error: plugins.error,
      plugins: plugins(),
    }),
  )
  const tavernManagerView = createMemo(() => {
    if (params.id || project()?.extension?.pluginID !== "lfcode-tavern") return
    const view = searchParams.view
    return view === "tavern-new" || view === "tavern-characters" || view === "tavern-personas" || view === "tavern-presets" || view === "tavern-groups" || view === "tavern-worldbooks" || view === "tavern-history" || view === "tavern-trash" || view === "tavern-settings"
      ? view.slice(7) as "new" | "characters" | "personas" | "presets" | "groups" | "worldbooks" | "history" | "trash" | "settings"
      : undefined
  })
  const isTavernSession = createMemo(
    () => sync.session.get(params.id ?? "")?.extension?.pluginID === "lfcode-tavern",
  )
  // The managed worktree is private to the Tavern plugin, including its sessions.
  const tavernRoute = createMemo(() =>
    tavernManagedDirectoryRoute() ||
    isPluginProjectRoute({
      sessionID: params.id,
      sessionExtension: info()?.extension,
      projectExtension: project()?.extension,
      pluginID: "lfcode-tavern",
      type: "tavern",
    }),
  )
  const hiddenPluginComponents = createMemo(
    () => new Set(pluginComposer()?.hiddenComponents ?? (isTavernSession() ? ["summary", "jobs-rail", "side-panel"] : [])),
  )
  const desktopSummaryCardVisible = createMemo(
    () =>
      platform.platform === "desktop" &&
      !!params.id &&
      !hiddenPluginComponents().has("summary") &&
      !desktopSidePanelOpen() &&
      view().summaryCard.opened(),
  )
  const isChildSession = createMemo(() => !!info()?.parentID)
  const canReview = createMemo(() => !!sync.project)
  const reviewTab = createMemo(() => isDesktop() && view().reviewEnabled())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const sources = createMemo(() => {
    const items = new Map<string, { path: string; title: string }>()
    const add = (path: string) => {
      const normalized = path.replaceAll("\\", "/")
      const key = normalized.toLowerCase()
      if (items.has(key)) return
      items.set(key, { path: normalized, title: getFilename(normalized) || normalized })
    }

    for (const item of prompt.current()) {
      if (item.type === "file") add(item.path)
    }
    for (const message of messages()) {
      if (message.role !== "user") continue
      for (const part of (sync.data.part[message.id] ?? []) as Part[]) {
        if (part.type !== "file" || part.source?.type !== "file") continue
        add(part.source.path)
      }
    }
    return [...items.values()]
  })
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return sync.data.message[id] !== undefined
  })
  const messageViews = createMemo(() =>
    buildSessionMessageViews({
      messages: messages(),
      partsByMessageID: sync.data.part,
      revertMessageID: revertMessageID(),
      viewAgentID: selectedViewAgentID(),
    }),
  )
  const mainUserMessages = createMemo(() => messageViews().mainUserMessages, emptyUserMessages, { equals: same })
  const visibleUserMessages = createMemo(() => messageViews().visibleUserMessages, emptyUserMessages, {
    equals: same,
  })
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))
  const latestMainContextMessageID = createMemo(() => messageViews().latestMainContextMessageID)

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes",
    changes: "recent-1" as ReviewMode,
    newSessionWorktree: "main",
  })
  const mainComposerScope = createMemo(() => {
    if (!params.id) return
    return { dir: sdk.directory, id: params.id }
  })
  const attachSources = (paths: string[]) => {
    const current = prompt.current()
    const existing = new Set(
      current
        .filter((item) => item.type === "file")
        .map((item) => item.path.replaceAll("\\", "/").toLowerCase()),
    )
    const next = paths.reduce<Prompt>((result, path) => {
      const normalized = path.replaceAll("\\", "/")
      const key = normalized.toLowerCase()
      if (existing.has(key)) return result
      existing.add(key)
      const start = result.reduce((total, item) => total + ("content" in item ? item.content.length : 0), 0)
      const content = "@" + normalized
      return [...result, { type: "file", path: normalized, content, start, end: start + content.length }]
    }, current)
    if (next === current) return
    prompt.set(next, next.reduce((total, item) => total + ("content" in item ? item.content.length : 0), 0))
  }

  const [followup, setFollowup] = persisted(
    Persist.workspace(sdk.directory, "followup", ["followup.v1"]),
    createStore<{
      items: Record<string, FollowupItem[] | undefined>
      failed: Record<string, string | undefined>
      paused: Record<string, boolean | undefined>
      edit: Record<string, FollowupEdit | undefined>
    }>({
      items: {},
      failed: {},
      paused: {},
      edit: {},
    }),
  )

  let reviewFrame: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createComputed((prev) => {
    const open = desktopReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setUi("reviewSnap", false)
    })
    return open
  }, desktopReviewOpen())

  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
      : store.mobileTab === "changes",
  )
  const reviewModeOptions = createMemo<ReviewMode[]>(() => ["recent-1", "recent-15", "full"])
  const fullReviewFileCount = createMemo(() => {
    if (store.changes !== "full") return 0
    return info()?.summary?.files ?? 0
  })
  const fullReviewBlocked = createMemo(() => {
    if (!wantsReview()) return false
    if (store.changes !== "full") return false
    return fullReviewFileCount() > MAX_FULL_REVIEW_FILES
  })
  const reviewWindowRequest = createMemo(() => {
    const id = params.id
    if (!id || !wantsReview()) return
    if (store.changes === "full") return
    return { sessionID: id, turns: store.changes === "recent-15" ? 15 : 1 }
  })
  const [reviewWindowDiffs, { refetch: refetchReviewWindowDiffs }] = createResource(
    reviewWindowRequest,
    async (input) => {
      return sdk.client.session
        .diff({
          sessionID: input.sessionID,
          turns: input.turns,
        })
        .then((result) => list(result.data))
        .catch((error) => {
          console.debug("[session-review] failed to load session diff window", {
            sessionID: input.sessionID,
            turns: input.turns,
            error,
          })
          return []
        })
    },
  )
  const reviewLoading = createMemo(() => {
    const id = params.id
    if (!id || !wantsReview()) return false
    if (fullReviewBlocked()) return false
    if (store.changes === "full") return sync.status === "loading" || sync.data.session_diff[id] === undefined
    return reviewWindowDiffs.loading
  })
  const reviewReady = createMemo(() => !reviewLoading())
  const reviewDiffs = createMemo(() => {
    const id = params.id
    if (!id || !wantsReview() || !reviewReady()) return []
    if (fullReviewBlocked()) return []
    if (store.changes === "full") return list(sync.data.session_diff[id])
    return reviewWindowDiffs() ?? []
  })
  const reviewCount = () => (fullReviewBlocked() ? fullReviewFileCount() : reviewDiffs().length)
  const hasReview = () => reviewCount() > 0
  const sessionStreaming = createMemo(() => {
    const id = params.id
    if (!id) return false
    return isSessionStreaming(sync.data.session_status[id])
  })
  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const viewportAnchorFor = findTimelineViewportAnchor

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId
    return viewportAnchorFor(root)?.turnID ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeTimelineToBottom()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  const [scrollRefVersion, setScrollRefVersion] = createSignal(0)
  let content: HTMLDivElement | undefined
  let scrollMark = 0
  let messageMark = 0
  let viewportController: TimelineVirtualController | undefined
  let timelineVirtualizer: VirtualizerHandle | undefined
  let timelineSnapshotHost: HTMLDivElement | undefined

  const scrollGestureWindowMs = 250
  const scrollGestureThrottleMs = 64

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    const now = Date.now()
    if (now - ui.scrollGesture < scrollGestureThrottleMs) return
    setUi("scrollGesture", now)
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  createEffect(() => {
    const directory = sdk.directory
    const id = params.id
    if (!id) return

    const cached = untrack(() => sync.data.message[id] !== undefined)
    const prefetch = cached ? getSessionPrefetch(directory, id) : undefined
    const force = !cached && (!prefetch || Date.now() - prefetch.at > SESSION_PREFETCH_TTL)
    void sync.session.sync(id, force ? { force: true } : undefined).catch(() => undefined)
  })

  createEffect(
    on(
      () => {
        const id = params.id
        return [
          sdk.directory,
          id,
          id ? (sync.data.session_status[id]?.type ?? "idle") : "idle",
          id ? composer.blocked() : false,
        ] as const
      },
      ([dir, id, _status, blocked]) => {
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (!isSessionStreaming(sync.data.session_status[id]) && !blocked) return
        const cached = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (sdk.directory !== dir || params.id !== id) return
            untrack(() => {
              void sync.session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      sessionKey,
      () => {
        setStore("messageId", undefined)
        setStore("changes", "recent-1")
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => params.dir,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  const handleKeyDown = (event: KeyboardEvent) => {
    const activeElement = deepActiveElement()
    if (eventBelongsToEditableSurface(event, activeElement)) return

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (!shouldRoutePrintableKeyToComposer({ event, activeElement, dialogActive: !!dialog.active })) return
    if (composer.blocked() || isChildSession()) return
    inputRef?.focus()
  }

  createEffect(
    on(
      () => sync.data.session_status[params.id ?? ""]?.type,
      (next, prev) => {
        const streaming = next === "busy" || next === "retry"
        const wasStreaming = prev === "busy" || prev === "retry"
        if (streaming || prev === undefined || !wasStreaming) return

        const id = params.id
        if (!id || !wantsReview()) return
        if (store.changes === "full") {
          if (fullReviewBlocked()) return
          void sync.session.diff(id, { force: true })
          return
        }

        void refetchReviewWindowDiffs()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      revertMessageID,
      (_, prev) => {
        if (prev === undefined) return

        const id = params.id
        if (!id || !wantsReview()) return
        if (isSessionStreaming(sync.data.session_status[id])) return
        if (store.changes === "full") {
          if (fullReviewBlocked()) return
          void sync.session.diff(id, { force: true })
          return
        }

        void refetchReviewWindowDiffs()
      },
      { defer: true },
    ),
  )

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })
  const consumedBrowserHandoffs = new Set<string>()

  createEffect(
    on(
      sessionKey,
      () => {
        setTree({
          reviewScroll: undefined,
          pendingDiff: undefined,
          activeDiff: undefined,
        })
      },
      { defer: true },
    ),
  )

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const focusInput = () => {
    if (isChildSession()) return
    inputRef?.focus()
  }

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    review: reviewTab,
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const openWithCandidates = createMemo(() => {
    if (platform.os === "macos") return MAC_APPS
    if (platform.os === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })
  const [availableOpenApps, setAvailableOpenApps] = createStore<FileReferenceApp[]>([])
  let openAppsRequested = false
  const requestOpenWithApps = () => {
    if (openAppsRequested) return
    openAppsRequested = true
    if (platform.platform !== "desktop" || !platform.checkAppExists) {
      setAvailableOpenApps([])
      return
    }

    void Promise.all(
      openWithCandidates().map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((ok) =>
            ok ? { id: app.id, label: language.t(app.label), icon: app.icon, openWith: app.openWith } : undefined,
          )
          .catch(() => undefined),
      ),
    ).then((items) => {
      const next: FileReferenceApp[] = []
      for (const item of items) {
        if (!item) continue
        next.push(item)
      }
      setAvailableOpenApps(next)
    })
  }

  const showPathError = (path: string, err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: typeof err === "string" ? err : formatServerError(err, language.t, path),
    })
  }

  const openConversationPath = (path: string, app?: string) => {
    if (platform.platform !== "desktop" || !platform.openPath) return Promise.resolve()
    return platform.openPath(path, app).catch((err) => showPathError(path, err))
  }

  const htmlPreviewable = (path: string) => /\.(?:html?|xhtml)$/iu.test(path)

  const openBrowserPreview = (path: string) => {
    const url = `file://${encodeFilePath(path)}`
    openBrowserTab(url, file.normalize(path))
  }

  const previewConversationPath = (path: string) => {
    const absolute = resolveFileReferencePath(path, projectDirectory()) ?? path
    const normalized = file.normalize(absolute)
    const tab = file.tab(normalized)
    const canonical = file.pathFromTab(tab) ?? normalized
    openReviewPanel()
    if (htmlPreviewable(absolute)) {
      openBrowserPreview(absolute)
      return
    }
    tabs().open(tab)
    tabs().setActive(tab)
    void file.load(canonical)
  }

  const copyConversationPath = (path: string) =>
    navigator.clipboard.writeText(path).catch((err) => {
      showPathError(path, err)
    })

  const fileReferences = createMemo(() => ({
    baseDir: projectDirectory(),
    canOpenPaths: true,
    canExternalOpenPaths: platform.platform === "desktop" && !!platform.openPath,
    canBrowseInAppPaths: platform.platform === "desktop",
    enableMarkdownDecorations: true,
    allowContextMenu: true,
    resolvePath: (value: string, baseDir?: string) => resolveFileReferencePath(value, baseDir ?? projectDirectory()),
    validatePath: (path: string) => {
      if (platform.platform === "desktop" && platform.statPath) return platform.statPath(path)
      return sdk.client.file.stat({ path }).then((result) => result.data ?? { exists: false, kind: "unknown" as const })
    },
    openWithApps: availableOpenApps,
    inferKind: inferFileReferenceKind,
    onPreviewPath: (path: string) => {
      previewConversationPath(path)
    },
    onOpenDefaultApp: (path: string) => {
      void openConversationPath(path)
    },
    onOpenInApp:
      platform.platform === "desktop"
        ? (path: string) => {
            const target = file.normalize(path)
            void sdk.client.file
              .referenceGrant({ path: target })
              .then((result) => {
                const grant = result.data
                if (!grant) throw new Error("Reference directory grant was not returned")
                file.referenceTree.authorize(grant.root, grant.token)
                layout.fileTree.openReference(grant.root)
              })
              .catch((error) => showPathError(target, error))
          }
        : undefined,
    onOpenFolder: (path: string) => {
      const parent = getParentPath(path)
      if (!parent) return
      void openConversationPath(parent)
    },
    onOpenWith: (path: string, app: string) => {
      void openConversationPath(path, app)
    },
    onCopyPath: (path: string) => {
      void copyConversationPath(path)
    },
    onRequestOpenWithApps: requestOpenWithApps,
    onReviewPath: (path: string) => {
      openReviewPanel()
      focusReviewDiff(file.normalize(path))
      openReviewFile(file.normalize(path))
    },
  }))

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    const label = (option: ReviewMode) => {
      if (option === "recent-15") return language.t("ui.sessionReview.title.lastFifteenTurns")
      if (option === "full") return language.t("ui.sessionReview.title.fullSession")
      return language.t("ui.sessionReview.title.lastTurn")
    }

    return (
      <Select
        options={reviewModeOptions()}
        current={store.changes}
        label={label}
        onSelect={(option) => option && setStore("changes", option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const reviewEmptyText = createMemo(() => language.t("session.review.noChanges"))

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
    if (fullReviewBlocked()) {
      return (
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-3 px-6">
          <div class="text-14-medium text-text-strong">全量变更过大，已阻止应用内加载</div>
          <div class="text-13-regular text-text-weak max-w-[32rem] leading-6">
            当前会话记录了 {reviewCount().toLocaleString()}{" "}
            个文件变更。一次性加载会导致渲染线程卡死或崩溃，因此这里不再直接渲染。 请改用“最近 1 轮”或“最近 15
            轮”，如果确实要看完整列表，请在仓库里直接查看 Git 变更。
          </div>
        </div>
      )
    }
    return empty(reviewEmptyText())
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <SessionReviewTab
      title={changesTitle()}
      empty={reviewEmpty(input)}
      diffs={reviewDiffs}
      view={view}
      diffStyle={input.diffStyle}
      onDiffStyleChange={input.onDiffStyleChange}
      onScrollRef={(el) => setTree("reviewScroll", el)}
      focusedFile={tree.activeDiff}
      onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
      onLineCommentUpdate={updateCommentInContext}
      onLineCommentDelete={removeCommentFromContext}
      lineCommentActions={reviewCommentActions()}
      commentMentions={{
        items: file.searchFilesAndDirectories,
      }}
      comments={comments.all()}
      focusedComment={comments.focus()}
      onFocusedCommentChange={comments.setFocus}
      onViewFile={openReviewFile}
      classes={input.classes}
    />
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  const detachedContext = createMemo(() => window.__LFCODE__?.detachedSidePanel ?? getDetachedSidePanelContext())

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    setTree({ activeDiff: path, pendingDiff: path })
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  createEffect(() => {
    const id = params.id
    if (!id) return

    if (!wantsReview()) return
    if (store.changes !== "full") return
    if (fullReviewBlocked()) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  createEffect(
    on(
      () => [sessionKey(), wantsReview(), store.changes] as const,
      ([key, wants, mode]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = params.id
        if (!id) return
        if (mode !== "full") return
        if (untrack(fullReviewBlocked)) return
        if (!untrack(() => sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (sessionKey() !== key) return
            void sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    const tab = fileTreeTab()
    // A new session opens on the empty Changes tab. There is no file tree to
    // render until the user asks for All files or the session has activity.
    if (!params.id && tab !== "all") return
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  createEffect(
    on(
      () => sdk.directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const autoScroll = createAutoScroll({
    working: sessionStreaming,
    overflowAnchor: "none",
    onUserInteracted: () => {
      if (!hasScrollGesture()) return
      viewportController?.cancelForUserInput()
      scrollMark += 1
      captureTimelineViewport()
    },
  })

  let scrollStateFrame: number | undefined
  let scrollStateTarget:
    | {
        el: HTMLDivElement
        sessionID: string | undefined
        capture: boolean
      }
    | undefined
  let fillFrame: number | undefined
  let mainViewportPreserveFrame: number | undefined
  let mainViewportMutationLock:
    | {
        root: HTMLDivElement
        sessionID: string
        token: number
      }
    | undefined
  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)
  const scrollerOwner = (el: HTMLDivElement | undefined) => el?.dataset.sessionScrollerId
  const setScrollerOwner = (el: HTMLDivElement | undefined, sessionID: string | undefined) => {
    if (!el) return
    if (!sessionID) {
      delete el.dataset.sessionScrollerId
      return
    }
    el.dataset.sessionScrollerId = sessionID
  }
  const matchesScrollerOwner = (el: HTMLDivElement, sessionID: string | undefined) =>
    !sessionID || scrollerOwner(el) === sessionID
  const messageElement = (root: HTMLDivElement, messageID: string) =>
    [...root.querySelectorAll<HTMLElement>("[data-message-id]")].find((el) => el.dataset.messageId === messageID)
  const anchorElement = (root: HTMLDivElement, blockID: string) =>
    [...root.querySelectorAll<HTMLElement>("[data-viewport-anchor]")].find(
      (el) => el.dataset.viewportAnchor === blockID,
    )
  const turnElement = (root: HTMLDivElement, turnID: string) =>
    [...root.querySelectorAll<HTMLElement>("[data-viewport-turn]")].find((el) => el.dataset.viewportTurn === turnID)

  const clearTimelineVisualSnapshot = () => {
    timelineSnapshotHost?.replaceChildren()
  }

  const captureTimelineVisualSnapshot = () => {
    const root = scroller
    const surface = activeMainTimelineSurface()
    if (!root || !surface) return
    if (!matchesScrollerOwner(root, surface.sessionID)) return
    const turnIDs = surface.history.renderedUserMessages().map((message) => message.id)
    const revision = String(surface.contentRevision())
    rememberSessionTimelineVisualSnapshot({
      key: `${surface.key}/main`,
      sessionID: surface.sessionID,
      revision,
      turnIDs,
      root,
    })
  }

  const captureTimelineSurfaceState = () => {
    captureTimelineVisualSnapshot()
  }

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom && ui.scroll.jump === jump) return
    setUi("scroll", { overflow, bottom, jump })
  }

  const scheduleScrollState = (
    el: HTMLDivElement,
    options?: {
      capture?: boolean
      sessionID?: string
    },
  ) => {
    const sessionID = options?.sessionID ?? params.id
    scrollStateTarget = { el, sessionID, capture: options?.capture !== false }
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return
      if (target.el !== scroller) return
      if (target.sessionID && target.sessionID !== params.id) return
      if (!matchesScrollerOwner(target.el, target.sessionID)) return
      if (
        mainViewportMutationLock &&
        mainViewportMutationLock.root === target.el &&
        mainViewportMutationLock.sessionID === target.sessionID
      ) {
        updateScrollState(target.el)
        return
      }

      if (target.capture) viewportController?.scheduleCapture()
      updateScrollState(target.el)
    })
  }

  const captureTimelineViewport = () => {
    viewportController?.scheduleCapture()
  }

  const preserveMainTimelineViewport = (action: () => void) => {
    const root = scroller
    const sessionID = params.id
    if (!root || !sessionID || !matchesScrollerOwner(root, sessionID)) {
      action()
      return
    }

    const token = Date.now() + Math.random()
    mainViewportMutationLock = { root, sessionID, token }
    const box = root.getBoundingClientRect()
    const anchorID = viewportAnchorFor(root)?.turnID
    const anchorOffset = anchorID
      ? (messageElement(root, anchorID)?.getBoundingClientRect().top ?? box.top) - box.top
      : undefined
    const fallback = { left: root.scrollLeft, top: root.scrollTop }
    const restore = () => {
      if (params.id !== sessionID || scroller !== root || !matchesScrollerOwner(root, sessionID)) return false

      const anchor = anchorID ? messageElement(root, anchorID) : undefined
      if (anchor && anchorOffset !== undefined) {
        const nextOffset = anchor.getBoundingClientRect().top - root.getBoundingClientRect().top
        root.scrollTo({
          left: fallback.left,
          top: Math.max(0, root.scrollTop + nextOffset - anchorOffset),
          behavior: "auto",
        })
        return true
      }

      root.scrollTo({
        left: fallback.left,
        top: fallback.top,
        behavior: "auto",
      })
      return true
    }

    try {
      action()
      restore()
    } catch (error) {
      if (mainViewportMutationLock?.token === token) mainViewportMutationLock = undefined
      throw error
    }

    if (mainViewportPreserveFrame !== undefined) cancelAnimationFrame(mainViewportPreserveFrame)
    mainViewportPreserveFrame = requestAnimationFrame(() => {
      mainViewportPreserveFrame = undefined
      restore()
      if (mainViewportMutationLock?.token === token) mainViewportMutationLock = undefined
      scheduleScrollState(root, { capture: false, sessionID })
    })
  }

  let clearMessageHashRef = () => {}
  const resumeTimelineToBottom = () => {
    setStore("messageId", undefined)
    viewportController?.cancelRestore()
    autoScroll.forceScrollToBottom()
    clearMessageHashRef()
    const el = scroller
    if (el) scheduleScrollState(el, { capture: false, sessionID: params.id })
    captureTimelineViewport()
  }

  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHashRef()
        captureTimelineViewport()
      },
      { defer: true },
    ),
  )

  let fill = () => {}

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    if (scroller && scroller !== el) {
      delete scroller.dataset.sessionScroller
      delete scroller.dataset.sessionScrollerId
    }
    scroller = el
    setScrollRefVersion((value) => value + 1)
    if (el) {
      el.dataset.sessionScroller = "true"
      setScrollerOwner(el, params.id)
    }
    autoScroll.scrollRef(el)
    if (!el) {
      viewportController?.setRoot(undefined)
      return
    }
    viewportController?.setRoot(el)
    viewportController?.activate()
    scheduleScrollState(el, { capture: false, sessionID: params.id })
    fill()
  }

  const markUserScroll = () => {
    if (hasScrollGesture()) viewportController?.cancelForUserInput()
    autoScroll.markUserScrolled()
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el, { capture: false, sessionID: params.id })
      viewportController?.notifyLayout()
      fill()
    },
  )

  viewportController = new TimelineVirtualController({
    active: () => {
      const surface = activeMainTimelineSurface()
      if (!surface) return
      return {
        key: surface.key,
        sessionID: surface.sessionID,
        assistantRevision: String(surface.contentRevision()),
        streaming: isSessionStreaming(sync.data.session_status[surface.sessionID]),
      }
    },
    ready: () => activeMainTimelineSurface()?.ready() ?? false,
    root: () => scroller,
    virtualizer: () => timelineVirtualizer,
    state: (key) => layout.view(key).sessionState(),
    persist: (key, state) => layout.view(key).setSessionState(state),
    turnStart: () => activeHistoryWindow()?.turnStart() ?? 0,
    setTurnStart: (value) => activeHistoryWindow()?.setTurnStart(value),
    resetHistoryToRecent: () => activeHistoryWindow()?.resetToRecent(),
    prepareAnchorWindow: (turnID, fallbackStart) =>
      activeHistoryWindow()?.prepareAnchorWindow(turnID, fallbackStart) ?? false,
    historyMore: () => activeMainTimelineSurface()?.historyMore() ?? false,
    historyLoading: () => activeMainTimelineSurface()?.historyLoading() ?? false,
    loadHistory: async () => activeHistoryWindow()?.loadForRestore(),
    findAnchor: viewportAnchorFor,
    anchorElement,
    turnElement,
    pauseAutoScroll: autoScroll.pause,
    scrollToBottom: autoScroll.forceScrollToBottom,
    turnIDs: () =>
      activeHistoryWindow()
        ?.renderedUserMessages()
        .map((message) => message.id) ?? [],
    onPhase: (phase, detail) => {
      if (phase === "committed") {
        requestAnimationFrame(clearTimelineVisualSnapshot)
      }
      if (phase === "cancelled") {
        requestAnimationFrame(clearTimelineVisualSnapshot)
      }
      document.documentElement.dataset.timelineSurfacePhase = phase
      document.documentElement.dataset.timelineVirtualItems = String(detail.virtualItems)
      document.documentElement.dataset.timelineContentRevision = String(
        activeMainTimelineSurface()?.contentRevision() ?? 0,
      )
    },
  })

  createEffect(
    on(
      () => {
        const surface = activeMainTimelineSurface()
        return [
          surface?.key,
          surface?.ready(),
          surface?.history.turnStart(),
          surface?.history.renderedUserMessages().length,
        ] as const
      },
      () => viewportController?.notifyDataReady(),
      { defer: true },
    ),
  )

  createEffect(() => {
    const surface = activeMainTimelineSurface()
    const root = scroller
    scrollRefVersion()
    if (!surface || !root) return
    if (!matchesScrollerOwner(root, surface.sessionID)) return
    const unregisterViewport = registerSessionViewport({
      key: surface.key,
      flush: () => viewportController?.flush(),
      snapshot: captureTimelineSurfaceState,
    })
    const unregisterSurface = registerSessionViewSurface({
      key: surface.key,
      sessionID: surface.sessionID,
      surface: "main",
      phase: "active",
      freeze: () => {
        captureTimelineSurfaceState()
        viewportController?.flush()
        viewportController?.cancelRestore()
        autoScroll.pause()
      },
      resume: () => {
        viewportController?.activate()
        viewportController?.notifyDataReady()
      },
      cool: () => {
        captureTimelineSurfaceState()
        viewportController?.deactivate()
      },
      estimateWeight: () => surface.history.renderedUserMessages().length,
    })
    activateSessionViewSurface(surface.key)
    onCleanup(() => {
      unregisterSurface()
      unregisterViewport()
    })
  })

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      const surface = activeMainTimelineSurface()
      if (!surface?.ready()) return
      if (autoScroll.userScrolled() || surface.historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (surface.history.turnStart() <= 0 && !surface.historyMore()) return

      surface.history.fillViewport()
    })
  }

  createEffect(
    on(
      () =>
        [
          activeMainTimelineSurface()?.key,
          activeMainTimelineSurface()?.ready(),
          activeMainTimelineSurface()?.history.turnStart(),
          activeMainTimelineSurface()?.historyMore(),
          activeMainTimelineSurface()?.historyLoading(),
          autoScroll.userScrolled(),
          activeMainTimelineSurface()?.source.userMessages().length,
        ] as const,
      ([id, ready, start, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (start === undefined) return
        if (start <= 0 && !more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const seedSession = (next: Session) =>
    sync.set("session", (list) => {
      const result = Binary.search(list, next.id, (item) => item.id)
      const out = list.slice()
      if (result.found) {
        out[result.index] = next
        return out
      }
      out.splice(result.index, 0, next)
      return out
    })

  const appendSelectionToPrompt = (input: { text: string; comment?: string; messageID?: string; sessionID?: string }) => {
    const scope = input.sessionID ? { dir: sdk.directory, id: input.sessionID } : undefined
    const current = scope ? prompt.scope(scope).current() : prompt.current()
    const next = [
      ...current,
      {
        type: "selected-text" as const,
        text: input.text,
        comment: input.comment,
        messageID: input.messageID,
        content: "",
        start: 0,
        end: 0,
        selection: undefined,
      },
    ]
    prompt.set(
      next,
      next.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      scope,
    )
    requestAnimationFrame(() => {
      if (scope?.id && sideChatTab(scope.id) === tabs().active()) {
        activeSideChatInputRoot()?.focus()
        return
      }
      inputRef?.focus()
    })
  }

  const createSideChat = async (input: { text: string; messageID?: string; focus?: boolean }) => {
    const sessionID = params.id
    if (!sessionID) return
    const contextWatermark = input.messageID ?? latestMainContextMessageID()
    return sdk.client.session
      .create({
        parentID: sessionID,
        contextFrom: sessionID,
        contextWatermark,
        title: language.t("session.sideChat.title"),
      })
      .then((result) => {
        if (!result.data) throw new Error(language.t("common.requestFailed"))
        const sideSessionID = result.data.id
        seedSession(result.data)
        sync.set("message", sideSessionID, (messages) => messages ?? [])
        if (input.text) {
          prompt.set(
            [
              {
                type: "selected-text",
                text: input.text,
                messageID: input.messageID,
                content: "",
                start: 0,
                end: 0,
                selection: undefined,
              },
            ],
            0,
            { dir: sdk.directory, id: sideSessionID },
          )
        }
        openSideChatTab(sideSessionID, { focus: input.focus })
        void sync.session.sync(sideSessionID, { force: true })
        return sideSessionID
      })
      .catch((err) => {
        fail(err)
        return undefined
      })
  }

  const askInSideChat = (input: { text: string; messageID?: string; sessionID?: string }) => {
    const activeSideSessionID = sideChatTabID(tabs().active() ?? "")
    if (activeSideSessionID && tabs().all().includes(sideChatTab(activeSideSessionID))) {
      appendSelectionToPrompt({ ...input, sessionID: activeSideSessionID })
      return
    }
    void createSideChat({ text: input.text, messageID: input.messageID })
  }

  const closeSideChatSession = async (sideSessionID: string) => {
    const tab = sideChatTab(sideSessionID)
    await sdk.client.session
      .delete({ sessionID: sideSessionID })
      .then(() => {
        prompt.reset({ dir: sdk.directory, id: sideSessionID })
        preserveMainTimelineViewport(() => {
          sync.set(
            produce((draft) => {
              draft.session = draft.session.filter((item) => item.id !== sideSessionID)
              delete draft.message[sideSessionID]
              delete draft.session_diff[sideSessionID]
              delete draft.todo[sideSessionID]
              delete draft.actor[sideSessionID]
            }),
          )
          tabs().close(tab)
        })
      })
      .catch((error) => {
        showToast({
          variant: "error",
          title: language.t("session.delete.failed.title"),
          description: formatServerError(error, language.t, language.t("common.requestFailed")),
        })
        throw error
      })
  }

  const waitForAutomationFrames = async (count = 2) => {
    for (let index = 0; index < count; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }

  const waitForFileTabMode = async (mode: "edit" | "preview", attempts = 90) => {
    for (let index = 0; index < attempts; index += 1) {
      const state = readSessionAutomationState().fileTab
      if (activeFileTabMode() === mode) {
        if (mode === "preview") return state
        if (state.loaded && state.editor.implementation !== "none") return state
      }
      await waitForAutomationFrames(1)
    }
    return readSessionAutomationState().fileTab
  }

  const findCodeEditorAutomation = (root?: ParentNode | null) => {
    const host =
      root instanceof HTMLDivElement && root.dataset.automationId === "code-editor-phase0"
        ? root
        : root?.querySelector('[data-automation-id="code-editor-phase0"]')
    if (!(host instanceof HTMLDivElement)) return
    const automation = (host as HTMLDivElement & { __lfcodeCodeEditorAutomation?: LfcodeCodeEditorAutomationHandle })
      .__lfcodeCodeEditorAutomation
    if (!automation) return
    return {
      host,
      automation,
    }
  }

  const visibleRect = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  }

  const snapshotUiElement = (token: UiDriverToken, element?: HTMLElement): UiDriverNodeSnapshot => {
    const promptValue = automationPromptValueForToken(token)
    const promptParts = automationPromptPartsForToken(token)
    const selectedTexts = promptParts?.filter((part) => part.type === "selected-text").map((part) => part.text) ?? []
    if (!element) {
      return {
        token,
        found: false,
        visible: false,
        draftText: promptValue,
        selectedTextCount: selectedTexts.length,
        selectedTexts,
      }
    }
    const dataset = Object.fromEntries(
      Object.entries(element.dataset).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
    const editor = findCodeEditorAutomation(element)
    const value =
      promptValue ??
      (editor
        ? editor.automation.getState().value
        : "value" in element && typeof (element as HTMLInputElement | HTMLTextAreaElement).value === "string"
          ? (element as HTMLInputElement | HTMLTextAreaElement).value
          : undefined)
    return {
      token,
      found: true,
      visible: !!(element.offsetParent || element.getClientRects().length > 0),
      focused: element === document.activeElement || element.contains(document.activeElement),
      text: element.textContent ?? "",
      value,
      draftText: promptValue,
      selectedTextCount: selectedTexts.length,
      selectedTexts,
      dataset,
      title: element.title || undefined,
      ariaLabel: element.getAttribute("aria-label") ?? undefined,
      rect: visibleRect(element),
      tagName: element.tagName,
    }
  }

  const resolveUiToken = (input: UiDriverQueryInput) => {
    if (input.token === "settings.toggle") {
      const button = document.querySelector('[data-action="settings-toggle"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "settings.dialog") {
      const dialog = document.querySelector(".settings-dialog")
      return dialog instanceof HTMLElement ? dialog : undefined
    }
    if (isSettingsTabUiDriverToken(input.token)) {
      const button = document.querySelector(settingsTabUiDriverSelector(input.token))
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "project.sidebar.menu") {
      const button = document.querySelector('[data-action="project-sidebar-menu"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "project.sidebar.new-temporary-session") {
      const item = document.querySelector('[data-action="project-sidebar-new-temporary-session"]')
      return item instanceof HTMLElement ? item : undefined
    }
    if (input.token === "project.sidebar.new-claude-code-session") {
      const item = document.querySelector('[data-action="project-sidebar-new-claude-code-session"]')
      return item instanceof HTMLElement ? item : undefined
    }
    if (input.token === "prompt.schedule-automation") {
      const button = document.querySelector('[data-action="prompt-schedule-automation"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "session.summary.toggle") {
      const button = document.querySelector('[data-action="session-summary-toggle"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "composer.main.input") {
      return inputRef
    }
    if (input.token === "composer.main.submit") {
      const button = inputRef
        ?.closest('[data-prompt-composer="true"]')
        ?.querySelector('[data-action="prompt-submit-inline"], [data-action="prompt-submit-external-agent"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "claudeCode.model.menu" || input.token === "claudeCode.permissions.menu") {
      const control = inputRef
        ?.closest('[data-prompt-composer="true"]')
        ?.querySelector(`[data-action="claude-code-${input.token === "claudeCode.model.menu" ? "model" : "permissions"}-menu"]`)
      return control instanceof HTMLElement ? control : undefined
    }
    if (input.token.startsWith("claudeCode.control.")) {
      const selector = `[data-action="claude-code-control-${input.token.slice("claudeCode.control.".length)}"]`
      const button = inputRef
        ?.closest('[data-prompt-composer="true"]')
        ?.querySelector(selector)
      if (button instanceof HTMLElement) return button
      const portalButton = document.querySelector(selector)
      return portalButton instanceof HTMLElement ? portalButton : undefined
    }
    if (input.token === "sidechat.active.input") {
      const sideSessionID = sideChatTabID(tabs().active() ?? "")
      if (!sideSessionID) return
      return automationPromptRoot(sideSessionID)
    }
    if (input.token === "sidechat.active.submit") {
      const sideSessionID = sideChatTabID(tabs().active() ?? "")
      if (!sideSessionID) return
      const editor = automationPromptRoot(sideSessionID)
      const button = editor?.closest("form")?.querySelector('[data-action="prompt-submit"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "filetab.active.panel") {
      return activeFileTabPanel()
    }
    if (input.token === "filetab.active.editor") {
      const editor = activeFileTabEditor()
      return editor?.implementation === "phase0" ? editor.host : activeCppEditorTextarea()
    }
    if (input.token === "filetab.active.mode.edit") return activeCppToolbarButton("edit")
    if (input.token === "filetab.active.mode.preview") return activeCppToolbarButton("preview")
    if (input.token === "filetab.active.mode.save") return activeCppToolbarButton("save")
    if (input.token === "filetab.active.command-menu") {
      const button = activeFileTabPanel()?.querySelector('[data-automation-id="code-editor-more-actions"]')
      return button instanceof HTMLElement ? button : undefined
    }
    const root = messageCodeBlockRoot(input.blockKey)
    if (input.token === "messageblock.root") return root
    if (input.token === "messageblock.editor") {
      const editor = messageCodeBlockEditor(root)
      return editor?.implementation === "phase0"
        ? editor.host
        : editor?.implementation === "fallback"
          ? editor.textarea
          : undefined
    }
    if (input.token === "messageblock.mode.edit") return messageCodeBlockButton(root, "edit")
    if (input.token === "messageblock.mode.preview") return messageCodeBlockButton(root, "preview")
    if (input.token === "messageblock.mode.save") return messageCodeBlockButton(root, "save")
    if (input.token === "messageblock.mode.reload") return messageCodeBlockButton(root, "reload")
    if (input.token === "messageblock.mode.open-sidebar") return messageCodeBlockButton(root, "open-sidebar")
    if (input.token === "messageblock.mode.bind-file") return messageCodeBlockButton(root, "bind-file")
  }

  const uiReadText = (input: UiDriverReadTextInput) => {
    const promptValue = automationPromptValueForToken(input.token)
    if (promptValue !== undefined) {
      const selectedTexts =
        automationPromptPartsForToken(input.token)
          ?.filter((part) => part.type === "selected-text")
          .map((part) => part.text) ?? []
      if (selectedTexts.length === 0) return promptValue
      return [promptValue, ...selectedTexts].filter(Boolean).join("\n")
    }
    const node = resolveUiToken(input)
    if (!node) return ""
    if ("value" in node && typeof (node as HTMLInputElement | HTMLTextAreaElement).value === "string") {
      return (node as HTMLInputElement | HTMLTextAreaElement).value
    }
    const editor = findCodeEditorAutomation(node)
    if (editor) return editor.automation.getState().value
    return node.textContent ?? ""
  }

  const uiQuery = (input: UiDriverQueryInput) => snapshotUiElement(input.token, resolveUiToken(input))

  const uiClick = async (input: UiDriverQueryInput) => {
    if (input.token === "composer.main.submit") {
      await submitAutomationPrompt("main")
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    if (input.token === "sidechat.active.submit") {
      await submitAutomationPrompt("active-side")
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    if (input.token.startsWith("claudeCode.control.")) {
      const control = claudeControls().find((item) => item.id === input.token.slice("claudeCode.control.".length))
      if (!control) throw new Error(`Claude Code control was not found: ${input.token}`)
      await sendClaudeControl(control)
      await waitForAutomationFrames(2)
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    const node = resolveUiToken(input)
    if (!node) {
      if (input.token === "messageblock.mode.reload") {
        const root = messageCodeBlockRoot(input.blockKey)
        const automation = messageCodeBlockAutomation(root)
        if (!automation) throw new Error(`UI token was not found: ${input.token}`)
        await automation.reload()
        await waitForAutomationFrames(2)
        return snapshotUiElement(input.token, resolveUiToken(input))
      }
      throw new Error(`UI token was not found: ${input.token}`)
    }
    if (input.token === "composer.main.input" || input.token === "sidechat.active.input") {
      await waitForAutomationFrames(2)
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    node.click()
    await waitForAutomationFrames(2)
    return snapshotUiElement(input.token, resolveUiToken(input))
  }

  const uiType = async (input: UiDriverTypeInput) => {
    const node = resolveUiToken(input)
    if (!node) throw new Error(`UI token was not found: ${input.token}`)
    const editor = findCodeEditorAutomation(node)
    if (editor) {
      const current = editor.automation.getState().value
      editor.automation.setValue(input.append ? `${current}${input.text}` : input.text)
      await waitForAutomationFrames(2)
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    if (node === inputRef || node.dataset.component === "prompt-input") {
      const target = input.token === "sidechat.active.input" ? "active-side" : "main"
      setAutomationPromptText(input.text, target, undefined, input.append)
      await waitForAutomationFrames(2)
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    if ("value" in node && typeof (node as HTMLTextAreaElement | HTMLInputElement).value === "string") {
      const field = node as HTMLTextAreaElement | HTMLInputElement
      const next = input.append ? `${field.value}${input.text}` : input.text
      field.value = next
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: input.text }))
      await waitForAutomationFrames(2)
      return snapshotUiElement(input.token, resolveUiToken(input))
    }
    throw new Error(`UI token does not support typing: ${input.token}`)
  }

  const uiWait = async (input: UiDriverWaitInput) => {
    const timeoutMs = input.timeoutMs ?? 10_000
    const intervalMs = input.intervalMs ?? 120
    const startedAt = Date.now()
    while (Date.now() - startedAt <= timeoutMs) {
      const snapshot = uiQuery(input)
      if (snapshot.found && (input.visible === undefined || snapshot.visible === input.visible)) return snapshot
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return uiQuery(input)
  }

  const uiEditor = async (input: UiDriverEditorInput) => {
    const node = resolveUiToken(input)
    if (!node) throw new Error(`UI token was not found: ${input.token}`)
    const editor = findCodeEditorAutomation(node)
    if (!editor) throw new Error(`UI token is not backed by a phase0 editor: ${input.token}`)
    if (input.action === "getState") return editor.automation.getState()
    if (input.action === "focus" || input.action === "reveal") {
      const state = editor.automation.getState()
      if (state.selection) editor.automation.revealSelection(state.selection)
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "save") {
      await editor.automation.save()
      await waitForAutomationFrames(2)
      return editor.automation.getState()
    }
    if (input.action === "undo") {
      await editor.automation.undo()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "redo") {
      await editor.automation.redo()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "navigateBack") {
      await editor.automation.navigateBack()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "navigateForward") {
      await editor.automation.navigateForward()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openCommandPalette") {
      await editor.automation.openCommandPalette()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openQuickOutline") {
      await editor.automation.openQuickOutline()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "setSelection") {
      editor.automation.setSelection(input.selection)
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openFind") {
      await editor.automation.openFind()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openReplace") {
      await editor.automation.openReplace()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "findPrevious") {
      await editor.automation.findPrevious()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "findNext") {
      await editor.automation.findNext()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openGoToLine") {
      await editor.automation.openGoToLine()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openQuickFix") {
      await editor.automation.openQuickFix()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "renameSymbol") {
      await editor.automation.renameSymbol()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "showHover") {
      await editor.automation.showHover()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "triggerSuggest") {
      await editor.automation.triggerSuggest()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "triggerParameterHints") {
      await editor.automation.triggerParameterHints()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "openProblems") {
      await editor.automation.openProblems()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "nextProblem") {
      await editor.automation.nextProblem()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "previousProblem") {
      await editor.automation.previousProblem()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "organizeImports") {
      await editor.automation.organizeImports()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "expandSelection") {
      await editor.automation.expandSelection()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "shrinkSelection") {
      await editor.automation.shrinkSelection()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "moveLineUp") {
      await editor.automation.moveLineUp()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "moveLineDown") {
      await editor.automation.moveLineDown()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "copyLineUp") {
      await editor.automation.copyLineUp()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "copyLineDown") {
      await editor.automation.copyLineDown()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "deleteLine") {
      await editor.automation.deleteLine()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "addNextMatchToSelection") {
      await editor.automation.addNextMatchToSelection()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "duplicateSelection") {
      await editor.automation.duplicateSelection()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "insertCursorAbove") {
      await editor.automation.insertCursorAbove()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "insertCursorBelow") {
      await editor.automation.insertCursorBelow()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "joinLines") {
      await editor.automation.joinLines()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "trimTrailingWhitespace") {
      await editor.automation.trimTrailingWhitespace()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "toggleWordWrap") {
      await editor.automation.toggleWordWrap()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "foldCurrent") {
      await editor.automation.foldCurrent()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "unfoldCurrent") {
      await editor.automation.unfoldCurrent()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "foldAll") {
      await editor.automation.foldAll()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "unfoldAll") {
      await editor.automation.unfoldAll()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "peekDefinition") {
      await editor.automation.peekDefinition()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "peekDeclaration") {
      await editor.automation.peekDeclaration()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "peekTypeDefinition") {
      await editor.automation.peekTypeDefinition()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "peekImplementation") {
      await editor.automation.peekImplementation()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "peekReferences") {
      await editor.automation.peekReferences()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "formatDocument") {
      await editor.automation.formatDocument()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "formatSelection") {
      await editor.automation.formatSelection()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "toggleLineComment") {
      await editor.automation.toggleLineComment()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "toggleBlockComment") {
      await editor.automation.toggleBlockComment()
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "getHover") {
      return editor.automation.getHover()
    }
    if (input.action === "getDocumentSymbols") {
      return editor.automation.getDocumentSymbols()
    }
    if (input.action === "getWorkspaceSymbols") {
      return editor.automation.getWorkspaceSymbols(input.query)
    }
    if (input.action === "getIncomingCalls") {
      return editor.automation.getIncomingCalls()
    }
    if (input.action === "getOutgoingCalls") {
      return editor.automation.getOutgoingCalls()
    }
    if (input.action === "getDeclarations") {
      return editor.automation.getDeclarations()
    }
    if (input.action === "getDefinitions") {
      return editor.automation.getDefinitions()
    }
    if (input.action === "getTypeDefinitions") {
      return editor.automation.getTypeDefinitions()
    }
    if (input.action === "getImplementations") {
      return editor.automation.getImplementations()
    }
    if (input.action === "getReferences") {
      return editor.automation.getReferences()
    }
    if (input.action === "getDocumentHighlights") {
      return editor.automation.getDocumentHighlights()
    }
    if (input.action === "openNavigationTarget") {
      await editor.automation.openNavigationTarget(input.target)
      await waitForAutomationFrames(1)
      return editor.automation.getState()
    }
    if (input.action === "inspectLanguage") {
      return editor.automation.inspectLanguage(input.inspect)
    }
    return editor.automation.getState()
  }

  const findEditorTextarea = (root?: ParentNode | null) => {
    const textarea = root?.querySelector("textarea")
    return textarea instanceof HTMLTextAreaElement ? textarea : undefined
  }

  const textareaPositionOffset = (value: string, lineNumber: number, column: number) =>
    Math.min(
      value.length,
      value
        .split("\n")
        .slice(0, Math.max(0, lineNumber - 1))
        .reduce((offset, line) => offset + line.length + 1, 0) + Math.max(0, column - 1),
    )

  const findCodeEditorFailureMessage = (root?: ParentNode | null) => {
    const host =
      root instanceof HTMLDivElement && root.dataset.automationId === "code-editor-phase0"
        ? root
        : root?.querySelector('[data-automation-id="code-editor-phase0"]')
    if (host instanceof HTMLDivElement && host.parentElement?.dataset.editorFailureMessage) {
      return host.parentElement.dataset.editorFailureMessage
    }
    const error = root?.querySelector('[data-automation-id="code-editor-phase0-error"]')
    if (error instanceof HTMLElement) return error.textContent ?? ""
    return ""
  }

  const activeCppEditorTextarea = () => {
    return findEditorTextarea(activeFileTabPanel())
  }

  const activeFileTabPanel = () => {
    const tab = activeFileTab()
    if (!tab) return
    const panel = document.querySelector(`[data-automation-id="session-file-tab-panel"][data-key="${CSS.escape(tab)}"]`)
    return panel instanceof HTMLElement ? panel : undefined
  }

  const activeCodeEditorHost = () => {
    return findCodeEditorAutomation(activeFileTabPanel())
  }

  const activeFileTabEditor = () => {
    const phase0 = activeCodeEditorHost()
    if (phase0) {
      return {
        implementation: "phase0" as const,
        ...phase0,
      }
    }

    const textarea = activeCppEditorTextarea()
    if (textarea) {
      return {
        implementation: "fallback" as const,
        textarea,
        failureMessage: findCodeEditorFailureMessage(activeFileTabPanel()),
      }
    }
  }

  const activeFileTabMode = () => {
    const mode = activeFileTabPanel()?.dataset.editorMode
    if (mode === "edit" || mode === "preview") return mode
  }

  const activeCppToolbarButton = (kind: "edit" | "preview" | "save" | "run" | "reload") => {
    const panel = activeFileTabPanel()
    if (!(panel instanceof HTMLElement)) return
    const selectors = {
      edit: '[data-automation-id="code-file-edit"]',
      preview: '[data-automation-id="code-file-preview"]',
      save: '[data-automation-id="cpp-file-save"]',
      run: '[data-automation-id="cpp-file-run"]',
      reload: '[data-automation-id="cpp-file-reload"]',
    } as const
    const button = panel.querySelector(selectors[kind])
    return button instanceof HTMLButtonElement ? button : undefined
  }

  const messageCodeBlockRoots = () =>
    Array.from(document.querySelectorAll('[data-automation-id="session-message-code-block"]')).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )

  const messageCodeBlockRoot = (blockKey?: string) => {
    if (blockKey) {
      const root = document.querySelector(
        `[data-automation-id="session-message-code-block"][data-block-key="${CSS.escape(blockKey)}"]`,
      )
      return root instanceof HTMLElement ? root : undefined
    }
    return messageCodeBlockRoots()[0]
  }

  const messageCodeBlockEditor = (root?: HTMLElement) => {
    const phase0 = findCodeEditorAutomation(root)
    if (phase0) {
      return {
        implementation: "phase0" as const,
        ...phase0,
      }
    }

    const textarea = findEditorTextarea(root)
    if (textarea) {
      return {
        implementation: "fallback" as const,
        textarea,
        failureMessage: findCodeEditorFailureMessage(root),
      }
    }
  }

  const messageCodeBlockAutomation = (root?: HTMLElement) => {
    const automation = (
      root as
        | (HTMLElement & {
            __lfcodeMessageCodeBlockAutomation?: LfcodeMessageCodeBlockAutomationHandle
          })
        | undefined
    )?.__lfcodeMessageCodeBlockAutomation
    if (!automation) return
    return automation
  }

  const readMessageCodeBlockState = (root: HTMLElement) => {
    const editor = messageCodeBlockEditor(root)
    return {
      blockKey: root.dataset.blockKey ?? "",
      languageID: root.dataset.languageId ?? "",
      path: root.dataset.bindingPath ?? "",
      mode: root.dataset.editorMode === "edit" ? ("edit" as const) : ("preview" as const),
      externalChanged: root.dataset.externalChanged === "true",
      saveConflict: root.dataset.saveConflict === "true",
      editor:
        editor?.implementation === "phase0"
          ? editor.automation.getState()
          : editor?.implementation === "fallback"
            ? {
                implementation: "fallback" as const,
                value: editor.textarea.value,
                ...(editor.failureMessage ? { failureMessage: editor.failureMessage } : {}),
              }
            : {
                implementation: "none" as const,
              },
    }
  }

  const messageCodeBlockButton = (
    root: HTMLElement | undefined,
    kind: "edit" | "preview" | "open-sidebar" | "bind-file" | "save" | "reload",
  ) => {
    if (!root) return
    const selectors = {
      edit: '[data-automation-id="message-code-block-edit"]',
      preview: '[data-automation-id="message-code-block-preview"]',
      "open-sidebar": '[data-automation-id="message-code-block-open-sidebar"]',
      "bind-file": '[data-automation-id="message-code-block-bind-file"]',
      save: '[data-automation-id="message-code-block-save"]',
      reload: '[data-automation-id="message-code-block-reload"]',
    } as const
    const button = root.querySelector(selectors[kind])
    return button instanceof HTMLButtonElement ? button : undefined
  }

  const waitForMessageCodeBlockMode = async (blockKey: string | undefined, mode: "edit" | "preview", attempts = 90) => {
    for (let index = 0; index < attempts; index += 1) {
      const root = messageCodeBlockRoot(blockKey)
      if (root) {
        const state = readMessageCodeBlockState(root)
        if (
          mode === "preview" &&
          root.dataset.editorMode === "preview" &&
          messageCodeBlockButton(root, "preview")?.getAttribute("data-variant") === "secondary"
        ) {
          return state
        }
        if (
          mode === "edit" &&
          root.dataset.editorMode === "edit" &&
          messageCodeBlockButton(root, "edit")?.getAttribute("data-variant") === "secondary" &&
          state.editor.implementation !== "none"
        ) {
          return state
        }
      }
      await waitForAutomationFrames(1)
    }
    const root = messageCodeBlockRoot(blockKey)
    return root ? readMessageCodeBlockState(root) : undefined
  }

  const automationPromptScope = (target?: string, explicitSessionID?: string) => {
    const sideSessionID =
      explicitSessionID && explicitSessionID.length > 0
        ? explicitSessionID
        : target === "active-side"
          ? sideChatTabID(tabs().active() ?? "")
          : undefined
    if (sideSessionID) {
      return {
        scope: { dir: sdk.directory, id: sideSessionID },
        target: sideSessionID,
      }
    }
    return {
      scope: mainComposerScope(),
      target: "main",
    }
  }

  const automationPromptValueForToken = (token: UiDriverToken) => {
    if (token === "composer.main.input") {
      return automationPromptText(mainComposerScope())
    }
    if (token === "sidechat.active.input") {
      const sideSessionID = sideChatTabID(tabs().active() ?? "")
      if (!sideSessionID) return ""
      return automationPromptText({ dir: sdk.directory, id: sideSessionID })
    }
  }

  const automationPromptText = (scope?: { dir: string; id?: string }) =>
    (scope ? prompt.scope(scope).current() : prompt.current())
      .map((part) => ("content" in part ? part.content : ""))
      .join("")

  const automationPromptPartsForToken = (token: UiDriverToken) => {
    if (token === "composer.main.input") {
      return prompt.current()
    }
    if (token === "sidechat.active.input") {
      const sideSessionID = sideChatTabID(tabs().active() ?? "")
      if (!sideSessionID) return []
      return prompt.scope({ dir: sdk.directory, id: sideSessionID }).current()
    }
  }

  const automationPromptWithText = (parts: Prompt, text: string) => {
    const next: Prompt = [{ type: "text", content: text, start: 0, end: text.length }]
    let position = text.length
    for (const part of parts) {
      if (part.type === "text") continue
      if (part.type === "image") {
        next.push(part)
        continue
      }
      if (part.type === "selected-text") {
        next.push({ ...part, content: "", start: position, end: position })
        continue
      }
      next.push({
        ...part,
        start: position,
        end: position + part.content.length,
      })
      position += part.content.length
    }
    return next
  }

  const automationPromptRoot = (target: string) => {
    if (target === "main") return inputRef
    const panel = document.querySelector(`[data-component="side-chat-panel"][data-session-id="${CSS.escape(target)}"]`)
    const editor = panel?.querySelector('[contenteditable="true"]')
    return editor instanceof HTMLDivElement ? editor : undefined
  }

  const readSessionAutomationState = () => {
    const active = tabs().active()
    const activeSideSessionID = sideChatTabID(active ?? "")
    const activeBrowserTabID = active ? browserTabID(active) : undefined
    const activeFileTabValue = activeFileTab()
    const activeFilePath = activeFileTabValue ? file.pathFromTab(activeFileTabValue) : undefined
    const activeFileState = activeFilePath ? file.get(activeFilePath) : undefined
    const sideChatItems = tabs()
      .all()
      .filter(isSideChatTab)
      .map((tab) => ({
        tab,
        sessionID: sideChatTabID(tab) ?? "",
      }))
      .filter((item) => !!item.sessionID)
    const browserItems = Object.entries(view().browser.tabs()).map(([id, item]) => ({
      id,
      url: item.url,
      input: item.input,
      title: item.title,
      loading: !!item.loading,
      error: item.error,
    }))
    const activeFileEditor = activeFileTabEditor()
    const activeComposer = automationPromptScope(activeSideSessionID ? "active-side" : "main")
    const messageBlocks = messageCodeBlockRoots().map(readMessageCodeBlockState)
    return {
      automationVersion: "session-automation-filetab-v2",
      sessionID: params.id,
      sessionKey: sessionKey(),
      directory: sdk.directory,
      extension: info()?.extension ? `${info()!.extension!.pluginID}/${info()!.extension!.type}` : undefined,
      projectExtension: project()?.extension ? `${project()!.extension!.pluginID}/${project()!.extension!.type}` : undefined,
      pluginComposer: pluginComposer() ? `${pluginComposer()!.pluginID}/${pluginComposer()!.type}` : undefined,
      pluginManifestState: plugins.state,
      messagesReady: messagesReady(),
      streaming: sessionStreaming(),
      loading: !messagesReady(),
      tabs: {
        active,
        all: tabs().all(),
      },
      sideChat: {
        activeSessionID: activeSideSessionID,
        items: sideChatItems,
      },
      browser: {
        activeTabID: activeBrowserTabID,
        items: browserItems,
      },
      composer: {
        activeTarget: activeComposer.target,
        mainText: automationPromptText(mainComposerScope()),
        activeText: automationPromptText(activeComposer.scope),
      },
      claudeCode: claudeCodeSession()
        ? {
            permissionMode: claudePermissionMode(),
            terminalConnected: claudeTerminalConnected(),
          }
        : undefined,
      fileTabSummary: {
        active: activeFileTabValue ?? null,
        path: activeFilePath ?? null,
        loaded: activeFileState?.loaded ?? false,
        loading: activeFileState?.loading ?? false,
      },
      fileTab: {
        active: activeFileTabValue,
        path: activeFilePath,
        loaded: activeFileState?.loaded ?? false,
        loading: activeFileState?.loading ?? false,
        error: activeFileState?.error,
        editor:
          activeFileEditor?.implementation === "phase0"
            ? activeFileEditor.automation.getState()
            : activeFileEditor?.implementation === "fallback"
              ? {
                  implementation: "fallback",
                  value: activeFileEditor.textarea.value,
                  ...(activeFileEditor.failureMessage ? { failureMessage: activeFileEditor.failureMessage } : {}),
                }
              : {
                  implementation: "none",
                },
      },
      messageBlocks,
      timeline: {
        scrollTop: scroller?.scrollTop ?? 0,
        scrollHeight: scroller?.scrollHeight ?? 0,
        clientHeight: scroller?.clientHeight ?? 0,
        atBottom: scroller ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 4 : true,
        phase: document.documentElement.dataset.timelineSurfacePhase ?? "idle",
        virtualItems: Number(document.documentElement.dataset.timelineVirtualItems ?? 0),
        contentRevision: Number(document.documentElement.dataset.timelineContentRevision ?? 0),
        viewport: viewportController?.inspect(),
        surfaces: sessionViewSurfaceDiagnostics(),
        cache: sessionVirtualCacheDiagnostics(),
        visualCache: sessionTimelineVisualSnapshotDiagnostics(),
      },
    }
  }

  const setAutomationPromptText = (text: string, target?: string, explicitSessionID?: string, append?: boolean) => {
    const resolved = automationPromptScope(target, explicitSessionID)
    const current = resolved.scope ? prompt.scope(resolved.scope).current() : prompt.current()
    const next = `${append ? automationPromptText(resolved.scope) : ""}${text}`
    prompt.set(automationPromptWithText(current, next), next.length, resolved.scope)
    return resolved
  }

  const submitAutomationPrompt = async (target?: string, explicitSessionID?: string) => {
    const resolved = automationPromptScope(target, explicitSessionID)
    if (resolved.target !== "main") {
      openSideChatTab(resolved.target, { focus: false })
      await waitForAutomationFrames(2)
    }
    const form = automationPromptRoot(resolved.target)?.closest("form")
    if (!(form instanceof HTMLFormElement)) {
      throw new Error(`Prompt form is not available for target: ${resolved.target}`)
    }
    form.requestSubmit()
    await waitForAutomationFrames(2)
    return resolved
  }

  const callSessionAutomation = async (action: string, input?: unknown) => {
    if (action === "session.create") {
      const value = input as { title?: unknown; open?: unknown; temporary?: unknown } | undefined
      const result = await sdk.client.session.create({
        title: typeof value?.title === "string" && value.title.trim() ? value.title.trim() : undefined,
        temporary: value?.temporary === true,
      })
      if (!result.data) throw new Error(language.t("common.requestFailed"))
      const sessionID = result.data.id
      seedSession(result.data)
      sync.set("message", sessionID, (messages) => messages ?? [])
      void sync.session.sync(sessionID, { force: true })
      if (value?.open !== false) {
        window.__LFCODE__?.navigate?.(`/${params.dir}/session/${sessionID}`)
        await waitForAutomationFrames(3)
      }
      return {
        sessionID,
        route: `/${params.dir}/session/${sessionID}`,
        opened: value?.open !== false,
        state: readSessionAutomationState(),
      }
    }
    if (action === "sidechat.create") {
      const value = input as { text?: unknown; messageID?: unknown } | undefined
      const sideSessionID = await createSideChat({
        text: typeof value?.text === "string" ? value.text : "",
        messageID: typeof value?.messageID === "string" ? value.messageID : undefined,
        focus: false,
      })
      await waitForAutomationFrames(3)
      return { sideSessionID, state: readSessionAutomationState() }
    }
    if (action === "sidechat.open") {
      const value = input as { sessionID?: unknown } | undefined
      const sideSessionID = typeof value?.sessionID === "string" ? value.sessionID : ""
      if (!sideSessionID) throw new Error("Missing sessionID")
      openSideChatTab(sideSessionID, { focus: false })
      await waitForAutomationFrames(2)
      return { sideSessionID, state: readSessionAutomationState() }
    }
    if (action === "sidechat.close") {
      const value = input as { sessionID?: unknown } | undefined
      const sideSessionID = typeof value?.sessionID === "string" ? value.sessionID : ""
      if (!sideSessionID) throw new Error("Missing sessionID")
      await closeSideChatSession(sideSessionID)
      await waitForAutomationFrames(2)
      return { sideSessionID, state: readSessionAutomationState() }
    }
    if (action === "composer.setText") {
      const value = input as { text?: unknown; target?: unknown; sessionID?: unknown; append?: unknown } | undefined
      const resolved = setAutomationPromptText(
        typeof value?.text === "string" ? value.text : "",
        typeof value?.target === "string" ? value.target : undefined,
        typeof value?.sessionID === "string" ? value.sessionID : undefined,
        value?.append === true,
      )
      if (resolved.target !== "main") {
        openSideChatTab(resolved.target, { focus: false })
        await waitForAutomationFrames(2)
      }
      return {
        target: resolved.target,
        text: automationPromptText(resolved.scope),
        state: readSessionAutomationState(),
      }
    }
    if (action === "composer.submit") {
      const value = input as { target?: unknown; sessionID?: unknown } | undefined
      const resolved = await submitAutomationPrompt(
        typeof value?.target === "string" ? value.target : undefined,
        typeof value?.sessionID === "string" ? value.sessionID : undefined,
      )
      return {
        target: resolved.target,
        submitted: true,
        state: readSessionAutomationState(),
      }
    }
    if (action === "timeline.inspect") {
      return readSessionAutomationState().timeline
    }
    if (action === "timeline.scroll") {
      const value = input as { position?: unknown; top?: unknown } | undefined
      const root = scroller
      const sessionID = params.id
      if (!root || !sessionID || !matchesScrollerOwner(root, sessionID)) {
        throw new Error("Timeline scroller is not available")
      }
      const max = Math.max(0, root.scrollHeight - root.clientHeight)
      const position = typeof value?.position === "string" ? value.position : undefined
      const top =
        typeof value?.top === "number" && Number.isFinite(value.top)
          ? Math.max(0, Math.min(max, value.top))
          : position === "top"
            ? 0
            : position === "middle"
              ? Math.round(max / 2)
              : max
      viewportController?.cancelForUserInput()
      root.scrollTo({ top, behavior: "auto" })
      scheduleScrollState(root, { sessionID })
      viewportController?.flush()
      await waitForAutomationFrames(2)
      return readSessionAutomationState().timeline
    }
    if (action === "messageblock.setMode") {
      const value = input as { blockKey?: unknown; mode?: unknown } | undefined
      const mode = typeof value?.mode === "string" ? value.mode : ""
      if (mode !== "edit" && mode !== "preview") throw new Error("Missing message block mode")
      const root = messageCodeBlockRoot(typeof value?.blockKey === "string" ? value.blockKey : undefined)
      if (!root) throw new Error("Message code block was not found")
      const button = messageCodeBlockButton(root, mode)
      if (!button) throw new Error(`Message code block ${mode} button is not available`)
      button.click()
      const block = await waitForMessageCodeBlockMode(root.dataset.blockKey, mode)
      await waitForAutomationFrames(2)
      return {
        block,
        state: readSessionAutomationState(),
      }
    }
    if (action === "messageblock.setText") {
      const value = input as { blockKey?: unknown; text?: unknown; append?: unknown } | undefined
      const text = typeof value?.text === "string" ? value.text : ""
      const root = messageCodeBlockRoot(typeof value?.blockKey === "string" ? value.blockKey : undefined)
      if (!root) throw new Error("Message code block was not found")
      const editor = messageCodeBlockEditor(root)
      if (!editor) throw new Error("Message code block editor is not available")
      if (editor.implementation === "phase0") {
        const current = editor.automation.getState().value
        editor.automation.setValue(value?.append === true ? `${current}${text}` : text)
      } else {
        const next = value?.append === true ? `${editor.textarea.value}${text}` : text
        editor.textarea.value = next
        editor.textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: next }))
      }
      await waitForAutomationFrames(2)
      return {
        block: readMessageCodeBlockState(root),
        state: readSessionAutomationState(),
      }
    }
    if (action === "messageblock.save") {
      const value = input as { blockKey?: unknown } | undefined
      const root = messageCodeBlockRoot(typeof value?.blockKey === "string" ? value.blockKey : undefined)
      if (!root) throw new Error("Message code block was not found")
      const button = messageCodeBlockButton(root, "save")
      if (!button) throw new Error("Message code block save button is not available")
      button.click()
      await waitForAutomationFrames(4)
      return {
        block: readMessageCodeBlockState(root),
        state: readSessionAutomationState(),
      }
    }
    if (action === "messageblock.bindFileToPath") {
      const value = input as { blockKey?: unknown; path?: unknown } | undefined
      const path = typeof value?.path === "string" ? value.path.trim() : ""
      if (!path) throw new Error("Missing path")
      const root = messageCodeBlockRoot(typeof value?.blockKey === "string" ? value.blockKey : undefined)
      if (!root) throw new Error("Message code block was not found")
      const automation = messageCodeBlockAutomation(root)
      if (!automation) throw new Error("Message code block bindFile automation is not available")
      const saved = await automation.bindFileToPath(path)
      await waitForAutomationFrames(4)
      return {
        saved,
        block: readMessageCodeBlockState(root),
        state: readSessionAutomationState(),
      }
    }
    if (action === "messageblock.reload") {
      const value = input as { blockKey?: unknown } | undefined
      const root = messageCodeBlockRoot(typeof value?.blockKey === "string" ? value.blockKey : undefined)
      if (!root) throw new Error("Message code block was not found")
      const automation = messageCodeBlockAutomation(root)
      if (automation) {
        await automation.reload()
      } else {
        const button = messageCodeBlockButton(root, "reload")
        if (!button) throw new Error("Message code block reload button is not available")
        button.click()
      }
      await waitForAutomationFrames(4)
      return {
        block: readMessageCodeBlockState(root),
        state: readSessionAutomationState(),
      }
    }
    if (action === "messageblock.openInSidebar") {
      const value = input as { blockKey?: unknown } | undefined
      const root = messageCodeBlockRoot(typeof value?.blockKey === "string" ? value.blockKey : undefined)
      if (!root) throw new Error("Message code block was not found")
      const button = messageCodeBlockButton(root, "open-sidebar")
      if (!button) throw new Error("Message code block open in sidebar button is not available")
      button.click()
      await waitForAutomationFrames(4)
      return {
        block: readMessageCodeBlockState(root),
        state: readSessionAutomationState(),
      }
    }
    if (action === "browser.open") {
      const value = input as { url?: unknown; title?: unknown; presentation?: unknown } | undefined
      const url = typeof value?.url === "string" ? value.url : ""
      if (!url) throw new Error("Missing url")
      const title = typeof value?.title === "string" ? value.title : undefined
      const presentation =
        value?.presentation === "detached" || value?.presentation === "sidebar" || value?.presentation === "headless"
          ? value.presentation
          : "headless"
      const target =
        presentation === "sidebar"
          ? openBrowserTab(url, title)
          : await openDetachedBrowserTab(url, title, presentation === "headless")
      await waitForAutomationFrames(3)
      return { ...target, presentation, state: readSessionAutomationState() }
    }
    if (action === "browser.close") {
      const value = input as { tabID?: unknown } | undefined
      const tabID = typeof value?.tabID === "string" ? value.tabID : browserTabID(tabs().active() ?? "")
      if (!tabID) throw new Error("No active browser tab to close")
      layout.view(sessionKey()).browser.close(tabID)
      tabs().close(browserTab(tabID))
      void platform.reportBrowserState?.({
        sessionKey: sessionKey(),
        tabID,
        closed: true,
      })
      await waitForAutomationFrames(2)
      return { tabID, state: readSessionAutomationState() }
    }
    if (action === "browser.focusTab") {
      const value = input as { tabID?: unknown } | undefined
      const tabID = typeof value?.tabID === "string" ? value.tabID : ""
      if (!tabID) throw new Error("Missing tabID")
      const tab = browserTab(tabID)
      if (!tabs().all().includes(tab)) {
        throw new Error(`Browser tab was not found: ${tabID}`)
      }
      openReviewPanel()
      tabs().setActive(tab)
      if (tabs().active() !== tab) activateSessionTabWhenReady(tab)
      await waitForAutomationFrames(2)
      return { tabID, state: readSessionAutomationState() }
    }
    if (action === "filetab.focus") {
      const value = input as { tab?: unknown; path?: unknown } | undefined
      const targetTab =
        typeof value?.tab === "string"
          ? normalizeTab(value.tab)
          : typeof value?.path === "string"
            ? file.tab(value.path)
            : activeFileTab()
      if (!targetTab) throw new Error("Missing file tab target")
      openReviewPanel()
      const targetPath = file.pathFromTab(targetTab)
      if (targetPath) {
        await file.load(targetPath)
      }
      if (!tabs().all().includes(targetTab)) {
        await tabs().open(targetTab)
      }
      tabs().setActive(targetTab)
      if (tabs().active() !== targetTab) activateSessionTabWhenReady(targetTab)
      await waitForAutomationFrames(3)
      return { tab: targetTab, state: readSessionAutomationState() }
    }
    if (action === "filetab.openPath") {
      const value = input as
        | {
            path?: unknown
            selection?: {
              startLineNumber?: unknown
              startColumn?: unknown
              endLineNumber?: unknown
              endColumn?: unknown
            }
          }
        | undefined
      const targetPath = typeof value?.path === "string" ? value.path.trim() : ""
      if (!targetPath) throw new Error("Missing path")
      const selection = value?.selection
      const startLineNumber = typeof selection?.startLineNumber === "number" ? selection.startLineNumber : undefined
      const startColumn = typeof selection?.startColumn === "number" ? selection.startColumn : undefined
      await openLfcodeEditorPath({ path: targetPath })
      openReviewPanel()
      const targetTab = file.tab(targetPath)
      if (tabs().active() !== targetTab) activateSessionTabWhenReady(targetTab)
      await waitForFileTabMode("edit")
      await waitForAutomationFrames(1)
      const targetEditor = activeFileTabEditor()
      if (startLineNumber && startColumn && targetEditor?.implementation === "phase0") {
        targetEditor.automation.setSelection({
          startLineNumber,
          startColumn,
          ...(typeof selection?.endLineNumber === "number" ? { endLineNumber: selection.endLineNumber } : {}),
          ...(typeof selection?.endColumn === "number" ? { endColumn: selection.endColumn } : {}),
        })
      }
      if (startLineNumber && startColumn && targetEditor?.implementation === "fallback") {
        const endLineNumber = typeof selection?.endLineNumber === "number" ? selection.endLineNumber : startLineNumber
        const endColumn = typeof selection?.endColumn === "number" ? selection.endColumn : startColumn
        targetEditor.textarea.setSelectionRange(
          textareaPositionOffset(targetEditor.textarea.value, startLineNumber, startColumn),
          textareaPositionOffset(targetEditor.textarea.value, endLineNumber, endColumn),
        )
      }
      return { tab: targetTab, state: readSessionAutomationState() }
    }
    if (action === "filetab.setMode") {
      const value = input as { mode?: unknown } | undefined
      const mode = typeof value?.mode === "string" ? value.mode : ""
      if (mode !== "edit" && mode !== "preview") throw new Error("Missing file tab mode")
      if (activeFileTabMode() === mode) {
        return { mode, state: readSessionAutomationState() }
      }
      const button = activeCppToolbarButton(mode)
      if (!button) throw new Error(`Active file tab ${mode} button is not available`)
      button.click()
      await waitForFileTabMode(mode)
      await waitForAutomationFrames(2)
      return { mode, state: readSessionAutomationState() }
    }
    if (action === "filetab.setText") {
      const value = input as { text?: unknown; append?: unknown } | undefined
      const text = typeof value?.text === "string" ? value.text : ""
      const editor = activeFileTabEditor()
      if (!editor) throw new Error("Active file editor is not available")
      if (editor.implementation === "phase0") {
        const current = editor.automation.getState().value
        editor.automation.setValue(value?.append === true ? `${current}${text}` : text)
      } else {
        const next = value?.append === true ? `${editor.textarea.value}${text}` : text
        editor.textarea.value = next
        editor.textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: next }))
      }
      await waitForAutomationFrames(2)
      const state = readSessionAutomationState()
      return {
        editor: state.fileTab.editor,
        state,
      }
    }
    if (action === "filetab.save") {
      const button = activeCppToolbarButton("save")
      if (!button) throw new Error("Active file save button is not available")
      button.click()
      await waitForAutomationFrames(4)
      return { saved: true, state: readSessionAutomationState() }
    }
    throw new Error(`Unsupported session automation action: ${action}`)
  }

  createEffect(() => {
    window.__LFCODE__ ??= {}
    const unregisterUi = UiAutomationRegistry.register({
      id: "session",
      tokens: sessionUiDriverTokens,
      query: uiQuery,
      click: uiClick,
      type: uiType,
      readText: uiReadText,
      wait: uiWait,
      editor: uiEditor,
    })
    const bridge: LfcodeRendererAutomation = {
      getState: readSessionAutomationState,
      call: callSessionAutomation,
      ui: {
        catalog: UiAutomationRegistry.catalog,
        query: uiQuery,
        click: uiClick,
        type: uiType,
        readText: uiReadText,
        wait: uiWait,
        editor: uiEditor,
      },
    }
    window.__LFCODE__.sessionAutomation = bridge
    onCleanup(() => {
      unregisterUi()
      if (window.__LFCODE__?.sessionAutomation === bridge) {
        window.__LFCODE__.sessionAutomation = undefined
      }
    })
  })

  const emitSessionAutomationEvent = (type: string, data?: unknown) => {
    ;(
      window as Window & {
        api?: {
          automationEvent?: (payload: { type: string; data?: unknown }) => Promise<void>
        }
      }
    ).api?.automationEvent?.({ type, data })
  }

  createEffect(
    on(
      () => params.id,
      (sessionID) => {
        emitSessionAutomationEvent("session.active", { sessionID, sessionKey: sessionKey(), directory: sdk.directory })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => tabs().active(),
      (tab) => {
        emitSessionAutomationEvent("session.tab.active", { sessionID: params.id, tab })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () =>
        tabs()
          .all()
          .filter(isSideChatTab)
          .map((tab) => sideChatTabID(tab) ?? "")
          .filter(Boolean)
          .join(","),
      (value) => {
        emitSessionAutomationEvent("session.sidechat.tabs", {
          sessionID: params.id,
          sessionIDs: value ? value.split(",") : [],
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => Object.keys(view().browser.tabs()).join(","),
      (value) => {
        emitSessionAutomationEvent("session.browser.tabs", {
          sessionID: params.id,
          tabIDs: value ? value.split(",") : [],
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sync.data.session_status[params.id ?? ""]?.type ?? "idle",
      (status) => {
        emitSessionAutomationEvent("session.status", { sessionID: params.id, status })
      },
      { defer: true },
    ),
  )

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => isSessionStreaming(sync.data.session_status[sessionID])
  const sessionGoal = createMemo(() => {
    const id = params.id
    if (!id) return
    return sync.data.session_goal[id]
  })
  const latestGoalVerdict = createMemo(() => {
    const goal = sessionGoal()
    if (!goal?.lastMessageID) return
    return goal.verdicts[goal.lastMessageID]
  })
  const goalStatusLabel = createMemo(() => {
    const state = sessionGoal()?.state
    const verdict = latestGoalVerdict()
    if (state?.status === "blocked") return "Blocked"
    if (verdict?.error) return "Judge error"
    if (verdict?.impossible) return "Impossible"
    if (state?.status === "complete" || verdict?.ok) return "Complete"
    if (verdict) return `Attempt ${verdict.attempt}: not met`
    if (state?.status === "active") return "Active"
    return undefined
  })

  const queuedFollowups = createMemo(() => {
    const id = params.id
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    return followup.edit[id]
  })

  const followupMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; ids: string[]; draft: FollowupDraft; manual?: boolean }) => {
      if (input.ids.length === 0) return

      if (input.manual) setFollowup("paused", input.sessionID, undefined)
      setFollowup("failed", input.sessionID, undefined)

      const ok = await sendFollowupDraft({
        client: sdk.client,
        sync,
        globalSync,
        draft: input.draft,
        optimisticBusy: input.draft.sessionDirectory === sdk.directory,
      }).catch((err) => {
        setFollowup("failed", input.sessionID, input.ids[0])
        fail(err)
        return false
      })
      if (!ok) return

      setFollowup("items", input.sessionID, (items) => (items ?? []).filter((entry) => !input.ids.includes(entry.id)))
      if (input.manual) resumeTimelineToBottom()
    },
  }))

  const followupBusy = (sessionID: string) =>
    followupMutation.isPending && followupMutation.variables?.sessionID === sessionID

  const sendingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    if (!followupBusy(id)) return
    return followupMutation.variables?.ids[0]
  })

  const followupMode = createMemo(() => {
    const id = params.id
    if (!id) return
    if (!busy(id) || composer.blocked() || isChildSession()) return
    return settings.general.followup()
  })
  const queueEnabled = createMemo(() => followupMode() === "queue")

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const handleHtmlComponentEvent = (detail: HtmlComponentEventDetail) => {
    const sessionID = params.id
    if (!sessionID) return
    if (detail.context?.sessionID && detail.context.sessionID !== sessionID) return
    if (sync.session.get(sessionID)?.parentID) return

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const fallbackModel =
      detail.context?.modelProviderID && detail.context?.modelID
        ? {
            providerID: detail.context.modelProviderID,
            modelID: detail.context.modelID,
          }
        : undefined
    const providerID = currentModel?.provider.id ?? fallbackModel?.providerID
    const modelID = currentModel?.id ?? fallbackModel?.modelID
    const agent = currentAgent?.name ?? detail.context?.agent
    if (!providerID || !modelID || !agent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    const draft = buildHtmlComponentFollowupDraft(detail, {
      sessionID,
      sessionDirectory: sdk.directory,
      agent,
      model: {
        providerID,
        modelID,
      },
      variant: local.model.variant.current() ?? detail.context?.variant,
      questionGuidance: local.questionGuidance.current(),
    })

    if (queueEnabled() || followupBusy(sessionID)) {
      queueFollowup(draft)
      return
    }

    void sendFollowupDraft({
      client: sdk.client,
      sync,
      globalSync,
      draft,
      optimisticBusy: true,
    }).catch((err) => {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
      queueFollowup(draft)
    })
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    if (sync.session.get(sessionID)?.parentID) return Promise.resolve()
    const items = followup.items[sessionID] ?? []
    const index = items.findIndex((entry) => entry.id === id)
    const item = items[index]
    if (!item) return Promise.resolve()
    if (followupBusy(sessionID)) return Promise.resolve()

    const candidates = items.slice(index)
    const boundary = candidates.findIndex((next, nextIndex) => nextIndex > 0 && !canBatchFollowupDrafts(item, next))
    const batch = opts?.manual ? [item] : candidates.slice(0, boundary === -1 ? undefined : boundary)

    return followupMutation.mutateAsync({
      sessionID,
      ids: batch.map((entry) => entry.id),
      draft: batchFollowupDrafts(batch),
      manual: opts?.manual,
    })
  }

  const editFollowup = (id: string) => {
    const sessionID = params.id
    if (!sessionID) return
    if (followupBusy(sessionID)) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = params.id
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  const halt = (sessionID: string) =>
    (sync.data.session_status[sessionID]?.type ?? "idle") !== "idle"
      ? sdk.client.session.abort({ sessionID }).catch(() => {})
      : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const scope = mainComposerScope()
      const prev = prompt.scope(scope).current().slice()
      const last = info()?.revert
      const value = draft(input.messageID)
      batch(() => {
        roll(input.sessionID, { messageID: input.messageID })
        prompt.set(value, undefined, scope)
      })
      await halt(input.sessionID)
        .then(() => sdk.client.session.revert(input))
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(input.sessionID, last)
            prompt.set(prev, undefined, scope)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = params.id
      if (!sessionID) return

      const scope = mainComposerScope()
      const prev = prompt.scope(scope).current().slice()
      const last = info()?.revert

      batch(() => {
        roll(sessionID, { messageID: id })
        prompt.set(draft(id), undefined, scope)
      })

      await halt(sessionID)
        .then(() => sdk.client.session.revert({ sessionID, messageID: id }))
        .then((result) => {
          if (result.data) merge(result.data)
          requestAnimationFrame(focusInput)
        })
        .catch((err) => {
          batch(() => {
            roll(sessionID, last)
            prompt.set(prev, undefined, scope)
          })
          fail(err)
        })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!params.id || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return mainUserMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = { revert }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followupBusy(sessionID)) return
    if (followup.failed[sessionID] === item.id) return
    if (followup.paused[sessionID]) return
    if (isChildSession()) return
    if (composer.blocked()) return
    if (busy(sessionID)) return

    void sendFollowup(sessionID, item.id)
  })

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el, { capture: false, sessionID: params.id })
      fill()
    },
  )

  const hashScroll = useSessionHashScroll({
    sessionID: () => params.id,
    messagesReady,
    streaming: sessionStreaming,
    messages: () => activeMainTimelineSurface()?.source.timelineMessages() ?? emptyMessages,
    visibleUserMessages: () => activeMainTimelineSurface()?.source.userMessages() ?? emptyUserMessages,
    turnStart: () => activeHistoryWindow()?.turnStart() ?? 0,
    currentMessageId: () => store.messageId,
    setActiveMessage,
    setTurnStart: (value) => activeHistoryWindow()?.setTurnStart(value),
    autoScroll,
    scroller: () => scroller,
    anchor,
  })
  const { scrollToMessage } = hashScroll
  clearMessageHashRef = hashScroll.clearMessageHash

  const bindTimelineContent = (el: HTMLDivElement) => {
    content = el
    setMainSelectionRoot(el)
    autoScroll.contentRef(el)
    const root = scroller
    if (root) scheduleScrollState(root, { capture: false, sessionID: params.id })
  }

  const MainTimelineSurface = (props: { sessionID: string; sessionKey: string }) => {
    const source = createSessionTimelineMessageSource({
      sessionID: props.sessionID,
      messages: (sessionID) => sync.data.message[sessionID],
      partsByMessageID: () => sync.data.part,
      revertMessageID: (sessionID) => sync.session.get(sessionID)?.revert?.messageID,
      viewAgentID: selectedViewAgentID,
    })
    const ready = () => sync.data.message[props.sessionID] !== undefined
    const historyMoreForSurface = () => sync.session.history.more(props.sessionID)
    const historyLoadingForSurface = () => sync.session.history.loading(props.sessionID)
    const history = createSessionHistoryWindow({
      sessionID: () => props.sessionID,
      messagesReady: ready,
      loaded: () => source.userMessages().length,
      visibleUserMessages: source.userMessages,
      historyMore: historyMoreForSurface,
      historyLoading: historyLoadingForSurface,
      loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
      userScrolled: autoScroll.userScrolled,
      scroller: () => scroller,
      storedTurnStart: () => layout.view(props.sessionKey).turnStart(),
      setStoredTurnStart: (value) => layout.view(props.sessionKey).setTurnStart(value),
    })
    const contentRevision = createMemo(() => {
      const timeline = source.timelineMessages()
      const tail = timeline.at(-1)
      return sessionContentRevision(
        props.sessionKey,
        createSessionContentSignature({
          status: sync.data.session_status[props.sessionID]?.type ?? "idle",
          updatedAt: sync.session.get(props.sessionID)?.time.updated,
          messageCount: timeline.length,
          tailMessage: tail,
          tailParts: tail ? sync.data.part[tail.id] : undefined,
        }),
      )
    })

    onMount(() => {
      const surface = {
        sessionID: props.sessionID,
        key: props.sessionKey,
        source,
        history,
        ready,
        historyMore: historyMoreForSurface,
        historyLoading: historyLoadingForSurface,
        contentRevision,
      } satisfies MainTimelineSurfaceState
      setActiveMainTimelineSurface(surface)
      requestAnimationFrame(() => {
        if (activeMainTimelineSurface()?.key !== props.sessionKey) return
        if (scroller) setScrollerOwner(scroller, props.sessionID)
        viewportController?.activate()
        viewportController?.notifyDataReady()
      })
    })

    onCleanup(() => {
      if (activeMainTimelineSurface()?.key !== props.sessionKey) return
      if (scroller && matchesScrollerOwner(scroller, props.sessionID)) viewportController?.deactivate()
      else viewportController?.cancelRestore()
      setActiveMainTimelineSurface()
    })

    return (
      <SessionTimelineSurface
        surface="main"
        sessionID={() => props.sessionID}
        sessionKey={() => props.sessionKey}
        mobileChanges={mobileChanges()}
        mobileFallback={reviewContent({
          diffStyle: "unified",
          classes: {
            root: "pb-8",
            header: "px-4",
            container: "px-4",
          },
          loadingClass: "px-4 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
        timelineVisible
        actions={actions}
        scroll={ui.scroll}
        onResumeScroll={resumeTimelineToBottom}
        setScrollRef={setScrollRef}
        onScheduleScrollState={scheduleScrollState}
        onAutoScrollHandleScroll={autoScroll.handleScroll}
        onMarkScrollGesture={markScrollGesture}
        hasScrollGesture={hasScrollGesture}
        onUserScroll={markUserScroll}
        onTurnBackfillScroll={history.onScrollerScroll}
        onAutoScrollInteraction={autoScroll.handleInteraction}
        onVirtualizerRef={(handle) => {
          timelineVirtualizer = handle
          viewportController?.setVirtualizer(handle)
        }}
        turnIDs={() => history.renderedUserMessages().map((message) => message.id)}
        contentRevision={() => String(contentRevision())}
        centered={centered()}
        rightInset={desktopSummaryCardVisible()}
        setContentRef={bindTimelineContent}
        turnStart={history.turnStart()}
        historyMore={historyMoreForSurface()}
        historyLoading={historyLoadingForSurface()}
        onLoadEarlier={() => void history.loadAndReveal()}
        timelineMessages={source.timelineMessages()}
        renderedUserMessages={history.renderedUserMessages()}
        viewAgentID={selectedViewAgentID()}
        sessionActors={(sync.data.actor ?? {})[props.sessionID] ?? []}
        onViewAgentChange={(agentID) => {
          if (agentID === "main") {
            setSearchParams({ agentID: undefined })
            return
          }
          void openSubagent(agentID)
        }}
        anchor={anchor}
        domAnchor={(id) => `timeline-${checksum(props.sessionKey)}-${anchor(id)}`}
        fileReferences={fileReferences()}
        onOpenSideChat={() => void createSideChat({ text: "" })}
        onHtmlComponentEvent={handleHtmlComponentEvent}
      />
    )
  }

  const SessionTimelineViewport = () => (
    <div class="relative size-full min-h-0 overflow-hidden" data-component="session-timeline-viewport">
      <Show when={params.id ? { id: params.id, key: createSessionStorageKey(params.dir, params.id) } : undefined} keyed>
        {(surface) => <MainTimelineSurface sessionID={surface.id} sessionKey={surface.key} />}
      </Show>
      <div ref={(el) => (timelineSnapshotHost = el)} class="absolute inset-0 z-20 overflow-hidden pointer-events-none" />
    </div>
  )

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) inputRef?.focus()
      },
    ),
  )

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
    makeEventListener(window, SUBAGENT_VIEW_REQUEST_EVENT, ((event: CustomEvent<{ sessionID?: string; actorID?: string }>) => {
      const detail = event.detail
      if (detail.sessionID !== params.id || !detail.actorID) return
      void openSubagent(detail.actorID)
    }) as EventListener)
    if (platform.getRendererMemoryInfo) onCleanup(startSessionViewMemoryGuard(platform.getRendererMemoryInfo))
  })

  onCleanup(() => {
    viewportController?.dispose()
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
    if (mainViewportPreserveFrame !== undefined) cancelAnimationFrame(mainViewportPreserveFrame)
    clearTimelineVisualSnapshot()
    if (pendingSideChatFocusFrame !== undefined) cancelAnimationFrame(pendingSideChatFocusFrame)
    mainViewportMutationLock = undefined
  })

  if (detachedContext()) {
    return <DetachedSidePanelView context={detachedContext()!} reviewPanel={reviewPanel} />
  }

  let browserKeepaliveMount: HTMLDivElement | undefined
  let sessionDropRoot: HTMLDivElement | undefined

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col" data-session-canvas>
      <Show
        when={tavernRoute()}
        fallback={<>
      <SessionHeader />
      <div
        class="relative flex-1 min-h-0 flex"
        classList={{
          "flex-row": isDesktop(),
          "flex-col": !isDesktop(),
        }}
      >
        <Show when={!isDesktop() && !!params.id && !claudeCodeSession()}>
          <Tabs value={store.mobileTab} class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="!w-1/2 !max-w-none"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "session")}
              >
                {language.t("session.tab.session")}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="changes"
                class="!w-1/2 !max-w-none !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "changes")}
              >
                {hasReview()
                  ? language.t("session.review.filesChanged", { count: reviewCount() })
                  : language.t("session.review.change.other")}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        {/* Session panel */}
        <div
          ref={(el) => (sessionDropRoot = el)}
          data-component="session-main-panel"
          data-session-dropzone={sessionKey()}
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
          }}
          data-resizing={size.active()}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={tavernManagerView()}>{(manager) => <TavernManager view={manager()} projectID={project()?.id ?? ""} worktree={project()?.worktree ?? projectDirectory()} />}</Match>
              <Match when={claudeCodeSession()}>{(binding) => <ClaudeCodeSession sessionID={params.id!} binding={binding()} restartToken={claudeTerminalRestart()} onConnectionChange={setClaudeTerminalConnected} onPermissionModeChange={setClaudePermissionMode} />}</Match>
              <Match when={params.id}>
                <Show when={sessionGoal()?.state || latestGoalVerdict()}>
                  <div class="border-b border-border bg-background-base/80 px-4 py-3">
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <Show when={sessionGoal()?.state?.objective ?? sessionGoal()?.state?.condition}>
                        {(objective) => (
                          <div class="flex min-w-0 items-center gap-2">
                            <span class="text-text-dim">Goal</span>
                            <span class="truncate text-text">{objective()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={goalStatusLabel()}>
                        {(label) => (
                          <div class="flex items-center gap-2 text-text-dim">
                            <span>Judge</span>
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                    </div>
                    <Show when={latestGoalVerdict()?.reason}>
                      {(reason) => <p class="mt-2 text-xs text-text-dim">{reason()}</p>}
                    </Show>
                  </div>
                </Show>
                <SessionTimelineViewport />
              </Match>
              <Match when={true}>
                <NewSessionView worktree={newSessionWorktree()} />
              </Match>
            </Switch>
          </div>

          <Show when={!tavernManagerView() && claudeCodeSession()}>
            <div class="shrink-0">
              <SessionComposerRegion
                state={composer}
                ready={true}
                centered={false}
                historyRailSpace={false}
                scope={mainComposerScope()}
                dropRoot={() => sessionDropRoot}
                inputRef={(el) => {
                  inputRef = el
                }}
                newSessionWorktree="main"
                onNewSessionWorktreeReset={() => undefined}
                onSubmit={() => undefined}
                onResponseSubmit={() => undefined}
                externalAgent={{
                  submit: submitClaudeComposer,
                  disabled: () => !claudeTerminalConnected(),
                  disabledMessage: () => (claudeTerminalConnected() ? undefined : language.t("claudeCode.terminalUnavailable")),
                  imageUnsupported: {
                    title: language.t("claudeCode.imageUnsupported.title"),
                    description: language.t("claudeCode.imageUnsupported.description"),
                  },
                  label: language.t("claudeCode.title"),
                  placeholder: language.t("claudeCode.composer.placeholder"),
                  controls: claudeControls(),
                  controlSubmit: sendClaudeControl,
                }}
                setPromptDockRef={(el) => {
                  promptDock = el
                }}
              />
            </div>
          </Show>
          <Show when={!tavernManagerView() && !claudeCodeSession()}>
            <Show
              when={selectedViewAgentID() === "main"}
              fallback={
                <button
                  type="button"
                  class="pointer-events-auto absolute bottom-4 left-4 z-[70] flex items-center gap-2 rounded-lg border border-border-base bg-surface-raised-base px-3 py-2 text-13-medium text-text-weak shadow-md transition-colors hover:bg-surface-raised-base-hover hover:text-text-base"
                  onClick={() => setSearchParams({ agentID: undefined })}
                >
                  <Icon name="arrow-left" size="small" />
                  {language.t("session.child.backToParent")}
                </button>
              }
            >
              <div class="shrink-0">
                <SessionComposerRegion
              state={composer}
              pluginComposer={pluginComposer()}
              pluginComposerPending={pluginComposerPending()}
              ready={messagesReady()}
              centered={centered()}
              historyRailSpace={historyRailSpace()}
              rightInset={desktopSummaryCardVisible()}
              scope={mainComposerScope()}
              dropRoot={() => sessionDropRoot}
              inputRef={(el) => {
                inputRef = el
              }}
              newSessionWorktree={newSessionWorktree()}
              onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
              onSubmit={() => {
                comments.clear()
                resumeTimelineToBottom()
              }}
              onResponseSubmit={resumeTimelineToBottom}
              followup={
                params.id && !isChildSession()
                  ? {
                    mode: followupMode,
                    items: followupDock(),
                    sending: sendingFollowup(),
                    edit: editingFollowup(),
                    onQueue: queueFollowup,
                    onAbort: () => {
                      const id = params.id
                      if (!id) return
                      setFollowup("paused", id, true)
                    },
                    onSend: (id) => {
                      void sendFollowup(params.id!, id, { manual: true })
                    },
                    onEdit: editFollowup,
                    onEditLoaded: clearFollowupEdit,
                  }
                  : undefined
              }
              revert={
                rolled().length > 0
                  ? {
                    items: rolled(),
                    restoring: restoring(),
                    disabled: reverting(),
                    onRestore: restore,
                  }
                  : undefined
              }
              setPromptDockRef={(el) => {
                promptDock = el
              }}
                />
              </div>
            </Show>
          </Show>
          <Show when={!claudeCodeSession() && desktopSummaryCardVisible() && !hiddenPluginComponents().has("jobs-rail")}>
            <SessionJobsRail
              sessionID={params.id!}
              directory={sdk.directory}
              messages={messages}
              parts={() => sync.data.part}
              actors={sessionActors}
              changes={reviewCount}
              sources={sources}
              onOpenChanges={() => {
                openReviewPanel()
                layout.fileTree.setTab("changes")
              }}
              onOpenFiles={openFileTree}
              onAttachSources={attachSources}
              onOpenSubagent={(actorID) => void openSubagent(actorID)}
            />
          </Show>

          <Show when={!claudeCodeSession() && desktopReviewOpen()}>
            <div onPointerDown={() => size.start()}>
              <ResizeHandle
                direction="horizontal"
                size={layout.session.width()}
                min={450}
                max={typeof window === "undefined" ? 1000 : Math.max(450, window.innerWidth - 96)}
                onResize={(width) => {
                  size.touch()
                  layout.session.resize(width)
                }}
                collapseThreshold={typeof window === "undefined" ? 760 : Math.max(450, window.innerWidth - 240)}
                collapseWhen="above"
                onCollapse={() => view().reviewPanel.close()}
              />
            </div>
          </Show>
        </div>

        <Show when={!claudeCodeSession() && !hiddenPluginComponents().has("side-panel") && (desktopSidePanelOpen() || (!isDesktop() && !!params.id))}>
          <SessionSidePanel
            canReview={canReview}
            diffs={reviewDiffs}
            diffsReady={reviewReady}
            empty={reviewEmptyText}
            hasReview={hasReview}
            reviewCount={reviewCount}
            reviewPanel={reviewPanel}
            activeDiff={tree.activeDiff}
            focusReviewDiff={focusReviewDiff}
            reviewSnap={ui.reviewSnap}
            size={size}
            onOpenSideChat={() => void createSideChat({ text: "" })}
            onCloseSideChat={(sideSessionID) => void closeSideChatSession(sideSessionID)}
            onAddToChat={appendSelectionToPrompt}
            onAskSideChat={askInSideChat}
            setActiveSideChatContentRef={setActiveSideChatContentRoot}
            setActiveSideChatInputRef={setActiveSideChatInputRoot}
          />
        </Show>
        <div ref={browserKeepaliveMount} class="pointer-events-none absolute inset-0 z-20 overflow-hidden" />
        <Show when={browserKeepaliveActive()}>
          <BrowserKeepaliveHost activeSessionKey={sessionKey} mount={() => browserKeepaliveMount} />
        </Show>
      </div>

      <Show when={!claudeCodeSession() && view().terminal.opened()}>
        <TerminalPanel />
      </Show>
      <SelectionToolbar
        roots={() => [mainSelectionRoot(), activeSideChatContentRoot()]}
        onAddToChat={appendSelectionToPrompt}
        onAskSideChat={askInSideChat}
      />
        </>}
      >
        <TavernSessionPage
          sessionID={params.id}
          directory={project()?.worktree ?? projectDirectory()}
          projectID={project()?.id ?? ""}
          managerView={tavernManagerView()}
          pluginAvailability={tavernPluginAvailability()}
          onRetryPluginStatus={() => void refetchPlugins()}
        />
      </Show>
    </div>
  )
}
