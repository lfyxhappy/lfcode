import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useLayout, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@lfcode-ai/ui/resize-handle"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { Session, type Message } from "@lfcode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createStore, produce, reconcile } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@lfcode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetchInflight,
  clearSessionPrefetch,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { retry } from "@lfcode-ai/shared/util/retry"
import { playSoundById } from "@/utils/sound"
import { createAim } from "@/utils/aim"
import { BROWSER_LOGINS_UPDATED_EVENT } from "@/utils/browser-events"
import { setNavigate } from "@/utils/notification-click"
import { sessionTitle } from "@/utils/session-title"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { createSessionStorageKey, normalizeSessionStorageKey } from "@/utils/session-key"
import {
  BROWSER_REQUEST_OPEN_EVENT,
  createBrowserRequestID,
  createBrowserTabID,
  normalizeBrowserRequestURL,
  normalizeBrowserURL,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"

import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@lfcode-ai/ui/theme/context"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis, getDraggableId } from "@/utils/solid-dnd"
import { Titlebar } from "@/components/titlebar"
import { SettingsView } from "@/components/dialog-settings"
import type { SettingsTab } from "@/components/dialog-settings-logic"
import { UiAutomationRegistry } from "@/automation/registry"
import {
  SCHEDULED_AUTOMATION_CREATE_EVENT,
  type ScheduledAutomationCreateRequest,
  requestScheduledAutomation,
} from "@/automation/scheduled-task"
import {
  globalUiDriverTokens,
  isAutomationDialogUiDriverToken,
  isLanAccessSettingsUiDriverToken,
  isSettingsTabUiDriverToken,
  resolveAutomationDialogUiDriverElement,
  resolveLanAccessSettingsUiDriverElement,
  settingsTabUiDriverSelectors,
  snapshotUiDriverElement,
  type UiDriverQueryInput,
  type UiDriverTypeInput,
} from "@/automation/ui-driver"
import { useServer } from "@/context/server"
import { useLanguage, type Locale } from "@/context/language"
import {
  displayName,
  descendantSessionIDs,
  effectiveWorkspaceOrder,
  errorMessage,
  latestRootSession,
  orderedWorkspaceDirs,
  projectActivityTime,
  projectRootForDirectory,
  sidebarSessionRemovalTarget,
  storedWorkspaceLabel,
  storedWorkspaceName,
  sortedRootSessions,
  sortedProjects,
  startupProjectRoot,
  visibleWorkspaceSessionDirs,
  workspaceKey,
} from "./layout/helpers"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  collectOpenSessionDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"
import { createRenameDialogController } from "./layout/inline-editor"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./layout/sidebar-workspace"
import { ProjectSection } from "./layout/sidebar-project"
import type { ProjectSidebarContext } from "./layout/sidebar-project-context"
import { SidebarContent, type SidebarQuickAction } from "./layout/sidebar-shell"
import { DebugBar } from "@/components/debug-bar"

const automationSettingsTabs = new Set<SettingsTab>([
  "general",
  "editor",
  "personalization",
  "appControl",
  "lanAccess",
  "shortcuts",
  "browser",
  "research",
  "archives",
  "automation",
  "models",
  "mcp",
  "plugins",
  "skills",
  "hooks",
  "usage",
  "agentOS",
])

function automationSettingsTab(value?: string) {
  if (value?.toLowerCase() === "maintenance") return "personalization"
  const normalized =
    value?.toLowerCase() === "app-control" || value?.toLowerCase() === "appcontrol"
      ? "appControl"
      : value ?? "general"
  return automationSettingsTabs.has(normalized as SettingsTab) ? (normalized as SettingsTab) : undefined
}

function settingsTabForUiToken(token: Extract<UiDriverQueryInput["token"], `settings.tab.${string}`>) {
  if (token === "settings.tab.automation") return "automation" as const
  if (token === "settings.tab.editor") return "editor" as const
  if (token === "settings.tab.models") return "models" as const
  if (token === "settings.tab.plugins") return "plugins" as const
  if (token === "settings.tab.lan-access") return "lanAccess" as const
  if (token === "settings.tab.usage") return "usage" as const
  return "appControl" as const
}

export default function Layout(props: ParentProps<{ quotaAction?: Accessor<JSX.Element | undefined> }>) {
  const consumedBrowserRequestIDs = (() => {
    const root = window as typeof window & {
      __LFCODE_BROWSER_REQUESTS__?: Map<string, number>
    }
    root.__LFCODE_BROWSER_REQUESTS__ ??= new Map<string, number>()
    return root.__LFCODE_BROWSER_REQUESTS__
  })()
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeProject: undefined as string | undefined,
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
      projectExpanded: {} as Record<string, boolean>,
      gettingStartedDismissed: false,
    }),
  )
  const [activated, setActivated] = createStore({
    projects: {} as Record<string, boolean>,
    workspaces: {} as Record<string, boolean>,
  })

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined
  let dialogRun = 0
  let dialogDead = false

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  onCleanup(setNavigate(navigate))
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  const initialDirectory = decode64(params.dir)
  const location = useLocation()
  const route = createMemo(() => {
    const slug = params.dir
    if (!slug) return { slug, dir: "" }
    const dir = decode64(slug)
    if (!dir) return { slug, dir: "" }
    const store = globalSync.peek(dir, { bootstrap: false })
    return {
      slug,
      store,
      dir: store[0].path.directory || dir,
    }
  })
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [settingsTab, setSettingsTab] = createSignal<SettingsTab>("general")
  const [settingsDirect, setSettingsDirect] = createSignal(false)
  const isTopLevelWorkspacePage = createMemo(() => /\/(plugins|automation)$/.test(location.pathname))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const currentDir = createMemo(() => route().dir)
  const activeSessionKey = createMemo(() => {
    const directory = currentDir()
    if (!directory || !params.id) return
    return createSessionStorageKey(base64Encode(directory), params.id)
  })

  const [state, setState] = createStore({
    autoselect: !initialDirectory,
    busyWorkspaces: {} as Record<string, boolean>,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
    sizing: false,
  })
  const [sidebarDragWidth, setSidebarDragWidth] = createSignal<number>()

  const editor = createRenameDialogController(dialog)
  const setBusy = (directory: string, value: boolean) => {
    const key = workspaceKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => !!state.busyWorkspaces[workspaceKey(directory)]
  const navLeave = { current: undefined as number | undefined }
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
    if (navLeave.current !== undefined) clearTimeout(navLeave.current)
  })

  onMount(() => {
    const stop = () => setState("sizing", false)
    const blur = () => reset()
    const hide = () => {
      if (document.visibilityState !== "hidden") return
      reset()
    }
    const closeSettingsForSidebarPointer = (event: Event) => closeSettingsForSessionSelection(event)
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
    makeEventListener(window, "blur", blur)
    makeEventListener(document, "visibilitychange", hide)
    // Context menus can stop the delegated click before it reaches the sidebar.
    // Capture the physical interaction at the document boundary so selecting a
    // conversation always leaves a settings-only surface first.
    document.addEventListener("pointerdown", closeSettingsForSidebarPointer, true)
    document.addEventListener("click", closeSettingsForSidebarPointer, true)
    window.__LFCODE__ ??= {}
    const previous = window.__LFCODE__.settings
    const automation = {
      open: (value?: string) => {
        const tab = automationSettingsTab(value)
        if (!tab) return false
        openSettings(tab)
        return true
      },
      close: closeSettings,
      getState: () => ({
        open: settingsOpen(),
        ...(settingsOpen() ? { tab: settingsTab() } : {}),
      }),
    }
    window.__LFCODE__.settings = automation
    return () => {
      document.removeEventListener("pointerdown", closeSettingsForSidebarPointer, true)
      document.removeEventListener("click", closeSettingsForSidebarPointer, true)
      if (window.__LFCODE__?.settings === automation) window.__LFCODE__.settings = previous
    }
  })

  const sidebarHovering = createMemo(() => false)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened())
  const clearHoverProjectSoon = () => {}
  const hoverProjectData = createMemo(() => undefined as LocalProject | undefined)
  const reset = () => {}
  createEffect(() => {
    if (!state.autoselect) return
    const dir = params.dir
    if (!dir) return
    const directory = decode64(dir)
    if (!directory) return
    setState("autoselect", false)
  })

  const openEditor = editor.openEditor
  const RenameTrigger = editor.RenameTrigger

  const clearSidebarHoverState = () => {
    return
  }

  const normalizeNavigationHref = (href: string) => {
    const idx = href.indexOf("#message-")
    return idx >= 0 ? href.slice(0, idx) : href
  }

  const sessionKeyFromWindowHash = () => {
    const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1)
    const matched = hash.match(/^\/([^/]+)\/session\/([^/?#]+)/)
    if (!matched) return
    return createSessionStorageKey(matched[1], matched[2])
  }

  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
    navigate(normalizeNavigationHref(href))
    layout.mobileSidebar.hide()
  }

  function cycleColorScheme(direction = 1) {
    const current = theme.colorScheme()
    const currentIndex = colorSchemeOrder.indexOf(current)
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
    const next = colorSchemeOrder[nextIndex]
    theme.setColorScheme(next)
    showToast({
      title: language.t("toast.scheme.title"),
      description: colorSchemeLabel(next),
    })
  }

  function setLocale(next: Locale) {
    if (next === language.locale()) return
    language.setLocale(next)
    showToast({
      title: language.t("toast.language.title"),
      description: language.t("toast.language.description", { language: language.label(next) }),
    })
  }

  function cycleLanguage(direction = 1) {
    const locales = language.locales
    const currentIndex = locales.indexOf(language.locale())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
    const next = locales[nextIndex]
    if (!next) return
    setLocale(next)
  }

  const useUpdatePolling = () =>
    onMount(() => {
      if (!platform.checkUpdate || !platform.update || !platform.restart) return
      let toastId: number | undefined
      let startupEnabled = false
      let startupPolled = false
      let startupFrame: number | undefined
      let idle: number | undefined
      let fallback: ReturnType<typeof setTimeout> | undefined

      const pollUpdate = () =>
        platform.checkUpdate!().then(({ updateAvailable, version }) => {
          if (!updateAvailable) return
          if (toastId !== undefined) return
          toastId = showToast({
            persistent: true,
            icon: "download",
            title: language.t("toast.update.title"),
            description: language.t("toast.update.description", { version: version ?? "" }),
            actions: [
              {
                label: language.t("toast.update.action.installRestart"),
                onClick: async () => {
                  await platform.update!()
                  await platform.restart!()
                },
              },
              {
                label: language.t("toast.update.action.notYet"),
                onClick: "dismiss",
              },
            ],
          })
        })

      const scheduleStartupPoll = () => {
        if (!startupEnabled || startupPolled || startupFrame !== undefined || idle !== undefined || fallback !== undefined) return
        if (document.visibilityState !== "visible") return
        startupFrame = requestAnimationFrame(() => {
          startupFrame = requestAnimationFrame(() => {
            startupFrame = undefined
            if (document.visibilityState !== "visible") return
            const run = () => {
              idle = undefined
              fallback = undefined
              if (document.visibilityState !== "visible") return
              startupPolled = true
              void pollUpdate()
            }
            if (typeof window.requestIdleCallback === "function") {
              idle = window.requestIdleCallback(run, { timeout: 5_000 })
              return
            }
            fallback = setTimeout(run, 0)
          })
        })
      }

      createEffect(() => {
        if (startupEnabled) return
        if (!settings.ready()) return
        if (!globalSync.ready) return
        if (!settings.updates.startup()) return
        startupEnabled = true
        scheduleStartupPoll()
      })

      const visible = () => scheduleStartupPoll()
      document.addEventListener("visibilitychange", visible)
      onCleanup(() => {
        document.removeEventListener("visibilitychange", visible)
        if (startupFrame !== undefined) cancelAnimationFrame(startupFrame)
        if (idle !== undefined) cancelIdleCallback(idle)
        if (fallback !== undefined) clearTimeout(fallback)
      })
    })

  const useSDKNotificationToasts = () =>
    onMount(() => {
      const toastBySession = new Map<string, number>()
      const alertedAtBySession = new Map<string, number>()
      const cooldownMs = 5000

      const dismissSessionAlert = (sessionKey: string) => {
        const toastId = toastBySession.get(sessionKey)
        if (toastId === undefined) return
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }

      const unsub = globalSDK.event.listen((e) => {
        if (e.details?.type === "worktree.ready") {
          setBusy(e.name, false)
          WorktreeState.ready(e.name)
          return
        }

        if (e.details?.type === "worktree.failed") {
          setBusy(e.name, false)
          WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
          return
        }

        if (
          e.details?.type === "question.replied" ||
          e.details?.type === "question.rejected" ||
          e.details?.type === "permission.replied"
        ) {
          const props = e.details.properties as { sessionID: string }
          const sessionKey = `${e.name}:${props.sessionID}`
          dismissSessionAlert(sessionKey)
          return
        }

        if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
        const title =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.title")
            : language.t("notification.question.title")
        const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
        const directory = e.name
        const props = e.details.properties
        if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

        const [store] = globalSync.child(directory, { bootstrap: false })
        const session = store.session.find((s) => s.id === props.sessionID)
        const sessionKey = `${directory}:${props.sessionID}`

        const sessionTitle = session?.title ?? language.t("command.session.new")
        const projectName = getFilename(directory)
        const description =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.description", { sessionTitle, projectName })
            : language.t("notification.question.description", { sessionTitle, projectName })
        const href = `/${base64Encode(directory)}/session/${props.sessionID}`

        const now = Date.now()
        const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
        if (now - lastAlerted < cooldownMs) return
        alertedAtBySession.set(sessionKey, now)

        if (e.details.type === "permission.asked") {
          if (settings.sounds.permissionsEnabled()) {
            void playSoundById(settings.sounds.permissions())
          }
          if (settings.notifications.permissions()) {
            void platform.notify(title, description, href)
          }
        }

        if (e.details.type === "question.asked") {
          if (settings.notifications.agent()) {
            void platform.notify(title, description, href)
          }
        }

        const currentSession = params.id
        if (workspaceKey(directory) === workspaceKey(currentDir()) && props.sessionID === currentSession) return
        if (workspaceKey(directory) === workspaceKey(currentDir()) && session?.parentID === currentSession) return

        dismissSessionAlert(sessionKey)

        const toastId = showToast({
          persistent: true,
          icon,
          title,
          description,
          actions: [
            {
              label: language.t("notification.action.goToSession"),
              onClick: () => navigate(href),
            },
            {
              label: language.t("common.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
        toastBySession.set(sessionKey, toastId)
      })
      onCleanup(unsub)

      createEffect(() => {
        const currentSession = params.id
        if (!currentDir() || !currentSession) return
        const sessionKey = `${currentDir()}:${currentSession}`
        dismissSessionAlert(sessionKey)
        const [store] = globalSync.child(currentDir(), { bootstrap: false })
        const childSessions = store.session.filter((s) => s.parentID === currentSession)
        for (const child of childSessions) {
          dismissSessionAlert(`${currentDir()}:${child.id}`)
        }
      })
    })

  const useBrowserPasswordCaptureToasts = () =>
    onMount(() => {
      if (!platform.onBrowserPasswordCapture || !platform.acknowledgeBrowserSavePasswordPrompt) return
      const dispose = platform.onBrowserPasswordCapture((event) => {
        showToast({
          persistent: true,
          icon: "checklist",
          title: language.t("settings.browser.passwordPrompt.title"),
          description: language.t("settings.browser.passwordPrompt.description", {
            origin: event.origin,
            username: event.username || language.t("settings.browser.logins.usernameEmpty"),
          }),
          actions: [
            {
              label: language.t("settings.browser.passwordPrompt.action.save"),
              onClick: async () => {
                const saved = await platform.acknowledgeBrowserSavePasswordPrompt?.({ id: event.id, save: true })
                if (saved) window.dispatchEvent(new Event(BROWSER_LOGINS_UPDATED_EVENT))
              },
            },
            {
              label: language.t("settings.browser.passwordPrompt.action.ignore"),
              onClick: async () => {
                await platform.acknowledgeBrowserSavePasswordPrompt?.({ id: event.id, save: false })
              },
            },
          ],
        })
      })
      onCleanup(dispose)
    })

  useUpdatePolling()
  useSDKNotificationToasts()
  useBrowserPasswordCaptureToasts()

  function scrollToSession(sessionId: string, sessionKey: string) {
    if (!scrollContainerRef) return
    if (state.scrollSessionKey === sessionKey) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (!element) return
    const containerRect = scrollContainerRef.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
      setState("scrollSessionKey", sessionKey)
      return
    }
    setState("scrollSessionKey", sessionKey)
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  function currentProject() {
    const directory = currentDir()
    if (!directory) return
    const key = workspaceKey(directory)

    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.some((item) => workspaceKey(item) === key))
    if (sandbox) return sandbox

    const direct = projects.find((p) => workspaceKey(p.worktree) === key)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  }

  const [autoselecting] = createResource(async () => {
    await ready.promise
    await layout.ready.promise
    if (!untrack(() => state.autoselect)) return

    const list = layout.projects.list()
    const last = server.projects.last()
    const next = startupProjectRoot(last, list)
    if (!next) return
    layout.projects.open(next)
    server.projects.touch(next)
    navigateWithSidebarReset(`/${base64Encode(next)}/session`)
  })

  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    return storedWorkspaceName(store, directory, projectId, branch)
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!store.workspaceBranchName[projectId]) {
      setStore("workspaceBranchName", projectId, {})
    }
    setStore("workspaceBranchName", projectId, branch, next)
  }

  const workspaceLabel = (directory: string, branch?: string, projectId?: string) =>
    storedWorkspaceLabel(store, directory, branch, projectId)

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  const visibleSessionDirs = createMemo(() => {
    return visibleWorkspaceSessionDirs({
      project: currentProject(),
      workspacesEnabled: workspaceSetting(),
      currentDir: currentDir(),
      orderedDirs: workspaceIds(currentProject()),
      expanded: Object.fromEntries(
        Object.entries(store.workspaceExpanded).filter(
          ([directory, expanded]) => expanded && activated.workspaces[workspaceKey(directory)],
        ),
      ),
    })
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const key = workspaceKey(directory)
      const project = projects.find(
        (item) =>
          workspaceKey(item.worktree) === key || item.sandboxes?.some((sandbox) => workspaceKey(sandbox) === key),
      )
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const now = Date.now()
    const dirs = visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]

    const result: Session[] = []
    for (const dir of dirs) {
      const existing = globalSync.existing(dir, { bootstrap: false })
      if (!existing) continue
      const [dirStore] = existing
      const dirSessions = sortedRootSessions(dirStore, now, {
        pinned: (session) => layout.sessions.isPinned(session.directory, session.id),
        pinStamp: layout.sessions.stamp(),
      })
      result.push(...dirSessions)
    }
    return result
  })

  const currentSessionMessagesReady = () => {
    const directory = currentDir()
    const sessionID = params.id
    if (!directory || !sessionID) return true
    const existing = globalSync.existing(directory, { bootstrap: false })
    return existing?.[0].message[sessionID] !== undefined
  }

  type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
  }

  // Keep sidebar warming intentionally narrow. These are cancellable hints,
  // never a prerequisite for opening the selected conversation.
  const sessionPrefetchEnabled = true
  const prefetchChunk = 24
  const prefetchConcurrency = 1
  const prefetchPendingLimit = 4
  const span = 1
  const prefetchToken = { value: 0 }
  const prefetchQueues = new Map<string, PrefetchQueue>()
  let automaticPrefetchFrame: number | undefined
  let automaticPrefetchIdle: number | undefined
  let automaticPrefetchFallback: ReturnType<typeof setTimeout> | undefined
  let automaticPrefetchSuppressedToken: number | undefined

  const PREFETCH_MAX_SESSIONS_PER_DIR = 6
  const prefetchedByDir = new Map<string, Set<string>>()

  const cancelAutomaticPrefetch = () => {
    if (automaticPrefetchFrame !== undefined) cancelAnimationFrame(automaticPrefetchFrame)
    if (automaticPrefetchIdle !== undefined) cancelIdleCallback(automaticPrefetchIdle)
    if (automaticPrefetchFallback !== undefined) clearTimeout(automaticPrefetchFallback)
    automaticPrefetchFrame = undefined
    automaticPrefetchIdle = undefined
    automaticPrefetchFallback = undefined
  }

  onMount(() => {
    const suppress = () => {
      automaticPrefetchSuppressedToken = prefetchToken.value
      cancelAutomaticPrefetch()
    }
    const hide = () => {
      if (document.visibilityState !== "hidden") return
      suppress()
    }

    window.addEventListener("pointerdown", suppress, { passive: true })
    window.addEventListener("keydown", suppress)
    window.addEventListener("wheel", suppress, { passive: true })
    document.addEventListener("visibilitychange", hide)
    onCleanup(() => {
      window.removeEventListener("pointerdown", suppress)
      window.removeEventListener("keydown", suppress)
      window.removeEventListener("wheel", suppress)
      document.removeEventListener("visibilitychange", hide)
      cancelAutomaticPrefetch()
    })
  })

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    return pickSessionCacheEvictions({
      seen: lru,
      keep: sessionID,
      limit: PREFETCH_MAX_SESSIONS_PER_DIR,
      preserve: params.id && workspaceKey(directory) === workspaceKey(currentDir()) ? [params.id] : undefined,
    })
  }

  createEffect(() => {
    const active = new Set(visibleSessionDirs())
    for (const directory of prefetchedByDir.keys()) {
      if (active.has(directory)) continue
      prefetchedByDir.delete(directory)
    }
  })

  createEffect(() => {
    route()
    globalSDK.url

    prefetchToken.value += 1
    automaticPrefetchSuppressedToken = undefined
    cancelAutomaticPrefetch()
    clearSessionPrefetchInflight()
    prefetchQueues.clear()
  })

  createEffect(() => {
    const visible = new Set(visibleSessionDirs())
    for (const [directory, q] of prefetchQueues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) prefetchQueues.delete(directory)
    }
  })

  const queueFor = (directory: string) => {
    const existing = prefetchQueues.get(directory)
    if (existing) return existing

    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    prefetchQueues.set(directory, created)
    return created
  }

  const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
    if (current.length === 0) {
      return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    const map = new Map<string, T>()
    for (const item of current) {
      map.set(item.id, item)
    }
    for (const item of incoming) {
      map.set(item.id, item)
    }
    return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    if (!sessionPrefetchEnabled) return
    const [store, setStore] = globalSync.child(directory, { bootstrap: false })

    return runSessionPrefetch({
      directory,
      sessionID,
      task: ({ revision, signal }) =>
        globalSDK.client.session
          .messages({ directory, sessionID, limit: prefetchChunk, agent_id: "*" }, { signal })
          .then((messages) => {
            if (signal.aborted) return
            if (prefetchToken.value !== token) return
            if (!isSessionPrefetchCurrent(directory, sessionID, revision)) return

            const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
            const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
            const sorted = mergeByID([], next)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
            const meta = {
              scope: "all" as const,
              limit: sorted.length,
              cursor,
              complete: !cursor,
              at: Date.now(),
            }

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) {
                globalSync.todo.set(id, undefined)
              }
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )

            if (signal.aborted) return
            if (!isSessionPrefetchCurrent(directory, sessionID, revision)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const message of items) {
                const currentParts = store.part[message.info.id] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
                )

                setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
  }

  const pumpPrefetch = (directory: string) => {
    if (!sessionPrefetchEnabled) return
    const q = queueFor(directory)
    if (q.running >= prefetchConcurrency) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const token = prefetchToken.value

    void prefetchMessages(directory, sessionID, token).finally(() => {
      q.running -= 1
      q.inflight.delete(sessionID)
      pumpPrefetch(directory)
    })
  }

  const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
    if (!sessionPrefetchEnabled) return
    const directory = session.directory
    if (!directory) return

    const [store] = globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk: prefetchChunk,
      })
    })
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) {
      if (priority !== "high") return
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= PREFETCH_MAX_SESSIONS_PER_DIR && priority !== "high") return

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > prefetchPendingLimit) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pumpPrefetch(directory)
  }

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= span; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  const queueAutomaticWarm = (sessions: Session[], index: number) => {
    const token = prefetchToken.value
    if (automaticPrefetchSuppressedToken === token) return
    cancelAutomaticPrefetch()

    const run = () => {
      automaticPrefetchIdle = undefined
      automaticPrefetchFallback = undefined
      if (automaticPrefetchSuppressedToken === token) return
      if (prefetchToken.value !== token) return
      if (document.visibilityState !== "visible") return
      // The active conversation must finish its first message sync before
      // speculative neighbors are allowed onto the network. Explicit
      // navigation still calls `prefetchSession` directly and is unaffected.
      if (!currentSessionMessagesReady()) return

      if (!params.id) {
        const first = sessions[index]
        if (first) prefetchSession(first, "high")
      }
      warm(sessions, index)
    }

    automaticPrefetchFrame = requestAnimationFrame(() => {
      automaticPrefetchFrame = requestAnimationFrame(() => {
        automaticPrefetchFrame = undefined
        if (automaticPrefetchSuppressedToken === token) return
        if (prefetchToken.value !== token) return
        if (document.visibilityState !== "visible") return
        if (typeof window.requestIdleCallback === "function") {
          automaticPrefetchIdle = window.requestIdleCallback(run, { timeout: 3_000 })
          return
        }
        automaticPrefetchFallback = setTimeout(run, 100)
      })
    })
  }

  createEffect(() => {
    if (!sessionPrefetchEnabled) return
    const sessions = currentSessions()
    if (sessions.length === 0) return

    // A new-session screen has no active conversation to warm. Starting a
    // historical message request here competes with the first directory
    // bootstrap and cannot improve the visible page. Explicit session
    // navigation still warms its target through `prefetchSession` below.
    if (!params.id) return
    if (!currentSessionMessagesReady()) {
      cancelAutomaticPrefetch()
      return
    }
    const index = sessions.findIndex((s) => s.id === params.id)
    if (index === -1) return
    queueAutomaticWarm(sessions, index)
  })

  function navigateSessionByOffset(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = (sessionIndex + offset + sessions.length) % sessions.length
    }

    const session = sessions[targetIndex]
    if (!session) return

    prefetchSession(session, "high")
    warm(sessions, targetIndex)

    navigateToSession(session)
  }

  function navigateProjectByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const current = currentProject()?.worktree
    const fallback = currentDir() ? projectRoot(currentDir()) : undefined
    const active = current ?? fallback
    const index = active ? projects.findIndex((project) => project.worktree === active) : -1

    const target =
      index === -1
        ? offset > 0
          ? projects[0]
          : projects[projects.length - 1]
        : projects[(index + offset + projects.length) % projects.length]
    if (!target) return

    // warm up child store to prevent flicker
    globalSync.child(target.worktree)
    void openProject(target.worktree)
  }

  function navigateSessionByUnseen(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const hasUnseen = sessions.some((session) => notification.session.unseenCount(session.id) > 0)
    if (!hasUnseen) return

    const activeIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1
    const start = activeIndex === -1 ? (offset > 0 ? -1 : 0) : activeIndex

    for (let i = 1; i <= sessions.length; i++) {
      const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
      const session = sessions[index]
      if (!session) continue
      if (notification.session.unseenCount(session.id) === 0) continue

      prefetchSession(session, "high")
      warm(sessions, index)

      navigateToSession(session)
      return
    }
  }

  async function renameSession(session: Session, next: string) {
    const title = next.trim()
    const current = sessionTitle(session.title)
    if (!title || title === current) return

    await globalSDK.client.session
      .update({
        directory: session.directory,
        sessionID: session.id,
        title,
      })
      .then(() => {
        const [, setStore] = globalSync.child(session.directory)
        setStore(
          produce((draft) => {
            const index = draft.session.findIndex((item) => item.id === session.id)
            if (index !== -1) draft.session[index].title = title
          }),
        )
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const removed = descendantSessionIDs(store.session, session.id)
    const roots = sortedRootSessions(store, Date.now(), {
      pinned: (item) => layout.sessions.isPinned(item.directory, item.id),
      pinStamp: layout.sessions.stamp(),
    })
    const rootIndex = roots.findIndex((item) => item.id === session.id)
    const nextRootSessionID = rootIndex === -1 ? undefined : (roots[rootIndex + 1] ?? roots[rootIndex - 1])?.id
    const archivedAt = Date.now()

    await Promise.all(
      Array.from(removed).map((sessionID) =>
        globalSDK.client.session.update({
          directory: session.directory,
          sessionID,
          time: { archived: archivedAt },
        }),
      ),
    )
      .then(() => {
        setStore(
          produce((draft) => {
            draft.session = draft.session.filter((item) => !removed.has(item.id))
          }),
        )
        navigateAfterSidebarSessionRemoval(session, removed, nextRootSessionID)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  async function deleteSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const removed = descendantSessionIDs(store.session, session.id)
    const roots = sortedRootSessions(store, Date.now(), {
      pinned: (item) => layout.sessions.isPinned(item.directory, item.id),
      pinStamp: layout.sessions.stamp(),
    })
    const rootIndex = roots.findIndex((item) => item.id === session.id)
    const nextRootSessionID = rootIndex === -1 ? undefined : (roots[rootIndex + 1] ?? roots[rootIndex - 1])?.id

    const result = await globalSDK.client.session
      .delete({ directory: session.directory, sessionID: session.id })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) return false

    setStore(
      produce((draft) => {
        draft.session = draft.session.filter((item) => !removed.has(item.id))
      }),
    )
    navigateAfterSidebarSessionRemoval(session, removed, nextRootSessionID)
    return true
  }

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.previous",
        title: language.t("command.project.previous"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowup",
        onSelect: () => navigateProjectByOffset(-1),
      },
      {
        id: "project.next",
        title: language.t("command.project.next"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowdown",
        onSelect: () => navigateProjectByOffset(1),
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) void archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
    ]

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(1),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
      })
    }

    return commands
  })

  function connectProvider() {
    const run = ++dialogRun
    void import("@/components/dialog-select-provider").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  function openServer() {
    const run = ++dialogRun
    void import("@/components/dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectServer />)
    })
  }

  function openSettings(tab: SettingsTab = "general", direct = false) {
    setSettingsTab(tab)
    setSettingsDirect(direct)
    setSettingsOpen(true)
    layout.mobileSidebar.hide()
  }

  function closeSettings() {
    setSettingsOpen(false)
    setSettingsTab("general")
    setSettingsDirect(false)
  }

  function closeSettingsForSessionSelection(event: Event) {
    if (!settingsOpen()) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest('[data-component="sidebar-session-item"]')) return
    if (target.closest("button, input, textarea, select, [contenteditable]")) return
    closeSettings()
  }

  function openSidebarNewSession() {
    const project = currentProject()
    closeSettings()
    if (project) {
      navigateWithSidebarReset(`/${base64Encode(project.worktree)}/session`)
      return
    }

    void globalSDK.client.path
      .get()
      .then((result) => {
        const directory = result.data?.directory
        if (!directory) throw new Error("A global session directory was not found")
        navigateWithSidebarReset(`/${base64Encode(directory)}/session`)
      })
      .catch((error) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        })
      })
  }

  function openScheduledAutomation(input: ScheduledAutomationCreateRequest = {}) {
    const run = ++dialogRun
    void import("@/components/dialog-scheduled-automation").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogScheduledAutomation {...input} />)
    })
  }

  const openAutomationSession = (sessionID: string) => {
    void globalSDK.client.global.automation.session
      .resolve({ sessionID })
      .then((resolution) => {
        const directory = resolution.data?.directory
        if (!directory) throw new Error("Automation session directory was not found")
        return globalSDK.createClient({ directory, throwOnError: true }).session.get({ sessionID })
      })
      .then((result) => {
        const session = result.data
        if (!session) throw new Error("Automation session was not found")
        globalSync.child(session.directory, { bootstrap: true })
        navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
      })
      .catch((error) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        })
      })
  }

  onMount(() => {
    const create = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (!detail || typeof detail !== "object") return
      openScheduledAutomation(detail as ScheduledAutomationCreateRequest)
    }
    const open = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (!detail || typeof detail !== "object") return
      if (!("sessionID" in detail) || typeof detail.sessionID !== "string") return
      openAutomationSession(detail.sessionID)
    }
    makeEventListener(window, SCHEDULED_AUTOMATION_CREATE_EVENT, create)
    makeEventListener(window, "lfcode:automation-create", create)
    makeEventListener(window, "lfcode:automation-open-session", open)
  })

  const resolveGlobalUiToken = (input: UiDriverQueryInput) => {
    if (input.token === "settings.toggle") {
      const button = document.querySelector('[data-action="settings-toggle"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "settings.close") {
      const button = document.querySelector('[data-action="settings-close"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "settings.dialog") {
      const dialog = document.querySelector(".settings-dialog")
      return dialog instanceof HTMLElement ? dialog : undefined
    }
    if (input.token === "settings.provider-quota") {
      const button = document.querySelector('[data-action^="settings-provider-quota-"]:not([data-action^="settings-provider-quota-config-"])')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "settings.provider-quota-config") {
      const button = document.querySelector('[data-action^="settings-provider-quota-config-"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "sidebar.provider-quota") {
      const button = document.querySelector('[data-action^="sidebar-provider-quota-"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "sidebar.provider-quota.card") {
      const card = document.querySelector('[data-component="provider-quota-card"]')
      return card instanceof HTMLElement ? card : undefined
    }
    if (isSettingsTabUiDriverToken(input.token)) {
      const button = settingsTabUiDriverSelectors(input.token)
        .map((selector) => document.querySelector(selector))
        .find((element): element is HTMLElement => element instanceof HTMLElement)
      return button instanceof HTMLElement ? button : undefined
    }
    if (isLanAccessSettingsUiDriverToken(input.token)) {
      return resolveLanAccessSettingsUiDriverElement(input.token)
    }
    if (input.token === "project.sidebar.menu") {
      const button = document.querySelector('[data-action="project-sidebar-menu"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "project.sidebar.new-temporary-session") {
      const button = document.querySelector('[data-action="project-sidebar-new-temporary-session"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "project.sidebar.new-automation") {
      const button = document.querySelector('[data-action="project-sidebar-new-automation"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (input.token === "automation.dialog") {
      const dialog = document.querySelector('[data-action="scheduled-automation-dialog"]')
      return dialog instanceof HTMLElement ? dialog : undefined
    }
    if (input.token === "automation.dialog.save") {
      const button = document.querySelector('[data-action="scheduled-automation-save"]')
      return button instanceof HTMLElement ? button : undefined
    }
    if (isAutomationDialogUiDriverToken(input.token)) {
      return resolveAutomationDialogUiDriverElement(input.token)
    }
  }

  const snapshotGlobalUiToken = (input: UiDriverQueryInput) => snapshotUiDriverElement(input.token, resolveGlobalUiToken(input))

  const waitForGlobalUiFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  onMount(() => {
    const unregister = UiAutomationRegistry.register({
      id: "layout",
      tokens: globalUiDriverTokens,
      query: snapshotGlobalUiToken,
      click: async (input) => {
        if (input.token === "settings.toggle") {
          if (settingsOpen()) closeSettings()
          else openSettings()
          await waitForGlobalUiFrame()
          return snapshotGlobalUiToken(input)
        }
        if (input.token === "settings.close") {
          closeSettings()
          await waitForGlobalUiFrame()
          return snapshotGlobalUiToken(input)
        }
        if (input.token === "settings.tab.plugins" || input.token === "settings.tab.automation") {
          const node = resolveGlobalUiToken(input)
          if (!node) throw new Error(`UI token was not found: ${input.token}`)
          node.click()
          await waitForGlobalUiFrame()
          return snapshotGlobalUiToken(input)
        }
        if (isSettingsTabUiDriverToken(input.token)) {
          openSettings(settingsTabForUiToken(input.token))
          await waitForGlobalUiFrame()
          return snapshotGlobalUiToken(input)
        }
        const node = resolveGlobalUiToken(input)
        if (!node) throw new Error(`UI token was not found: ${input.token}`)
        node.click()
        await waitForGlobalUiFrame()
        return snapshotGlobalUiToken(input)
      },
      type: async (input: UiDriverTypeInput) => {
        if (!isAutomationDialogUiDriverToken(input.token)) {
          throw new Error(`UI token does not support type: ${input.token}`)
        }
        const node = resolveGlobalUiToken(input)
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
          throw new Error(`UI token does not target a text field: ${input.token}`)
        }
        const current = node.value
        node.value = input.append ? `${current}${input.text}` : input.text
        node.dispatchEvent(new InputEvent("input", { bubbles: true, data: input.text }))
        await waitForGlobalUiFrame()
        return snapshotGlobalUiToken(input)
      },
      readText: (input) => {
        const snapshot = snapshotGlobalUiToken(input)
        return snapshot.value ?? snapshot.text ?? ""
      },
      wait: async (input) => {
        const timeoutMs = input.timeoutMs ?? 10_000
        const intervalMs = input.intervalMs ?? 120
        const startedAt = Date.now()
        while (Date.now() - startedAt <= timeoutMs) {
          const snapshot = snapshotGlobalUiToken(input)
          if (snapshot.found && (input.visible === undefined || snapshot.visible === input.visible)) return snapshot
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
        }
        return snapshotGlobalUiToken(input)
      },
    })
    onCleanup(unregister)
  })

  function projectRoot(directory: string) {
    const [child] = globalSync.child(directory, { bootstrap: false })
    return projectRootForDirectory({
      directory,
      projects: layout.projects.list(),
      workspaceOrder: store.workspaceOrder,
      childProjectID: child.project,
      projectMeta: globalSync.data.project,
    })
  }

  function activeProjectRoot(directory: string) {
    return currentProject()?.worktree ?? projectRoot(directory)
  }

  function rememberSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    setStore("lastProjectSession", root, { directory, id, at: Date.now() })
    return root
  }

  function clearLastProjectSession(root: string) {
    if (!store.lastProjectSession[root]) return
    setStore(
      "lastProjectSession",
      produce((draft) => {
        delete draft[root]
      }),
    )
  }

  function syncSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    rememberSessionRoute(directory, id, root)
    notification.session.markViewed(id)
    const expanded = untrack(() => store.workspaceExpanded[directory])
    if (expanded === false) {
      setStore("workspaceExpanded", directory, true)
    }
    requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
    return root
  }

  async function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const root = projectRoot(directory)
    server.projects.touch(root)
    const project = layout.projects.list().find((item) => item.worktree === root)
    let dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const canOpen = (value: string | undefined) => {
      if (!value) return false
      return dirs.some((item) => workspaceKey(item) === workspaceKey(value))
    }
    const refreshDirs = async (target?: string) => {
      if (!target || target === root || canOpen(target)) return canOpen(target)
      const listed = await globalSDK.client.worktree
        .list({ directory: root })
        .then((x) => x.data ?? [])
        .catch(() => [] as string[])
      dirs = effectiveWorkspaceOrder(root, [root, ...listed], store.workspaceOrder[root])
      return canOpen(target)
    }
    const navigateSession = (target: { directory: string; id: string }) => {
      setStore("lastProjectSession", root, { directory: target.directory, id: target.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`)
      return true
    }
    const openLoadedSession = (target: { directory: string; id: string }) => {
      if (!canOpen(target.directory)) return false
      const [data] = globalSync.child(target.directory, { bootstrap: false })
      if (data.session.some((item) => item.id === target.id)) {
        return navigateSession(target)
      }
      return false
    }
    const openRememberedSession = async (target: { directory: string; id: string }) => {
      if (openLoadedSession(target)) return true
      const resolved = await globalSDK.client.session
        .get({ sessionID: target.id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!resolved?.directory) return false
      if (!canOpen(resolved.directory)) return false
      return navigateSession(resolved)
    }
    const openListedSession = (target: Session | undefined) => {
      if (!target?.directory) return false
      if (!canOpen(target.directory)) return false
      return navigateSession(target)
    }
    const listLatestRoot = async (item: string) => ({
      path: { directory: item },
      session: await globalSDK.client.session
        .list({ directory: item, roots: true, limit: 1 })
        .then((x) => x.data ?? [])
        .catch(() => []),
    })

    const projectSession = store.lastProjectSession[root]
    if (projectSession?.id) {
      await refreshDirs(projectSession.directory)
      const opened = await openRememberedSession(projectSession)
      if (opened) return
      clearLastProjectSession(root)
    }

    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (openListedSession(latest)) {
      return
    }

    const fetched = latestRootSession(await Promise.all(dirs.map(listLatestRoot)), Date.now())
    if (openListedSession(fetched)) {
      return
    }

    navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  function navigateAfterSidebarSessionRemoval(session: Session, removed: Set<string>, nextRootSessionID?: string) {
    const target = sidebarSessionRemovalTarget({
      session,
      removed,
      activeID: params.id,
      nextRootSessionID,
    })
    if (!target) return
    const slug = base64Encode(target.directory)
    const href = target.sessionID ? `/${slug}/session/${target.sessionID}` : `/${slug}/session`
    navigateWithSidebarReset(href)
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) return navigateToProject(directory)
  }

  async function openBrowserInProject(url: string, directory: string | undefined) {
    if (!directory) return false
    const next = normalizeBrowserURL(url)
    if (!next) return false
    const root = projectRoot(directory)
    layout.projects.open(root)
    server.projects.touch(root)

    const openExisting = async (target: { directory: string; id: string }) => {
      const [data] = globalSync.child(target.directory, { bootstrap: false })
      const exists = data.session.some((item) => item.id === target.id)
      if (!exists) return false
      setSessionHandoff(`${base64Encode(target.directory)}/${target.id}`, { browser: { url: next } })
      setStore("lastProjectSession", root, { directory: target.directory, id: target.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`)
      return true
    }

    const remembered = store.lastProjectSession[root]
    if (remembered && (await openExisting(remembered))) return true

    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]

    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (latest && (await openExisting(latest))) return true

    const client = globalSDK.createClient({ directory: root, throwOnError: true })
    const created = await client.session
      .create()
      .then((x) => x.data ?? undefined)
      .catch(() => undefined)
    if (!created) return false

    setSessionHandoff(`${base64Encode(created.directory)}/${created.id}`, { browser: { url: next } })
    setStore("lastProjectSession", root, { directory: created.directory, id: created.id, at: Date.now() })
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session/${created.id}`)
    return true
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      void openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      void openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      navigateWithSidebarReset(href)
    }

    for (const link of collectOpenSessionDeepLinks(urls)) {
      void openProject(link.directory, false)
      navigateWithSidebarReset(`/${base64Encode(link.directory)}/session/${link.sessionID}`)
    }
  }

  onMount(() => {
    const rememberBrowserRequest = (requestID?: string) => {
      if (!requestID) return false
      const now = Date.now()
      for (const [key, at] of consumedBrowserRequestIDs) {
        if (now - at <= 10_000) continue
        consumedBrowserRequestIDs.delete(key)
      }
      if (consumedBrowserRequestIDs.has(requestID)) return true
      consumedBrowserRequestIDs.set(requestID, now)
      return false
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    const browserHandler = (event: Event) => {
      if (event.defaultPrevented) return
      if (platform.platform !== "desktop") return
      const detail = (
        event as CustomEvent<{
          url?: string
          sessionKey?: string
          sessionID?: string
          reason?: "human" | "tool"
          requestID?: string
        }>
      ).detail
      if (detail?.url && /^\/[^/]/.test(detail.url)) return
      const url = normalizeBrowserRequestURL(detail?.url)
      if (!url) return
      // Tool-originated navigation is claimed by the active session and must
      // never materialize as a user-facing review/sidebar page.
      if (detail?.reason === "tool") return
      if (detail?.sessionKey) {
        const targetSessionKey = normalizeSessionStorageKey(detail.sessionKey)
        if (targetSessionKey === activeSessionKey()) return
        if (targetSessionKey === sessionKeyFromWindowHash()) {
          const tabID = createBrowserTabID()
          batch(() => {
            layout.view(targetSessionKey).browser.open(tabID, url)
            layout.view(targetSessionKey).reviewPanel.open()
            layout.tabs(targetSessionKey).setActive(`browser://${tabID}`)
          })
          event.preventDefault()
          return
        }
        if (rememberBrowserRequest(detail?.requestID)) {
          event.preventDefault()
          return
        }
        layout.browser.open(targetSessionKey, createBrowserTabID(), url)
        event.preventDefault()
        return
      }

      const sessionRoute = /^\/[^/]+\/session(?:\/[^/]+)?$/.test(location.pathname)
      if (sessionRoute) return

      const activeDirectory = currentDir() || undefined
      const recentProject = globalSync.data.project
        .filter((item) => item.worktree !== "/")
        .slice()
        .sort((a, b) => projectActivityTime(b) - projectActivityTime(a))[0]?.worktree
      const fallbackDirectory =
        activeDirectory ??
        currentProject()?.worktree ??
        server.projects.last() ??
        layout.projects.list()[0]?.worktree ??
        recentProject
      if (!fallbackDirectory) return
      if (rememberBrowserRequest(detail?.requestID)) {
        event.preventDefault()
        return
      }

      void openBrowserInProject(url, fallbackDirectory).then((handled) => {
        if (handled) event.preventDefault()
      })
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
    makeEventListener(window, BROWSER_REQUEST_OPEN_EVENT, browserHandler as EventListener)
  })

  async function renameProject(project: LocalProject, next: string) {
    const current = displayName(project)
    if (next === current) return
    const name = next === getFilename(project.worktree) ? "" : next

    if (project.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
      return
    }

    globalSync.project.meta(project.worktree, { name })
  }

  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string) => {
    const current = storedWorkspaceLabel(store, directory, branch, projectId)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  async function clearProjectSnapshot(project: LocalProject) {
    if (!project.id || project.id === "global") return

    const current = server.current
    if (!current) throw new Error(language.t("error.globalSDK.serverNotAvailable"))

    const fetcher = platform.fetch ?? globalThis.fetch
    const url = new URL(
      `project/${encodeURIComponent(project.id)}/snapshot`,
      current.http.url.endsWith("/") ? current.http.url : `${current.http.url}/`,
    )
    const response = await fetcher(url, {
      method: "DELETE",
      headers: current.http.password
        ? {
            Authorization: `Basic ${btoa(`${current.http.username ?? "lfcode"}:${current.http.password}`)}`,
          }
        : undefined,
    })
    if (response.ok) return

    const data = await response.json().catch(() => undefined)
    const message =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : response.statusText || language.t("common.requestFailed")
    throw new Error(message)
  }

  async function closeProject(directory: string) {
    const list = layout.projects.list()
    const key = workspaceKey(directory)
    const index = list.findIndex((x) => workspaceKey(x.worktree) === key)
    if (index === -1) return

    try {
      await clearProjectSnapshot(list[index]!)
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err, language.t("common.requestFailed")),
      })
      return
    }

    const active = workspaceKey(currentProject()?.worktree ?? "") === key
    const next = list[index + 1]

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (!next) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
  }

  function toggleProjectWorkspaces(project: LocalProject) {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const projectEditorID = (project: LocalProject) => `project:${project.id ?? workspaceKey(project.worktree)}`

  const startProjectRename = (project: LocalProject) => {
    layout.sidebar.open()
    setStore("projectExpanded", workspaceKey(project.worktree), true)
    openEditor(projectEditorID(project), displayName(project), (next) => renameProject(project, next))
  }

  const canOpenProjectPath = () => platform.platform === "desktop" && !!platform.openPath && server.isLocal() === true

  const canCreateTemporarySession = () => platform.platform === "desktop" && server.isLocal() === true

  const scheduledAutomationProjectID = (project: LocalProject) =>
    project.id ??
    globalSync.data.project.find((item) => workspaceKey(item.worktree) === workspaceKey(project.worktree))?.id

  const canCreateScheduledAutomation = (project: LocalProject) => {
    const projectID = scheduledAutomationProjectID(project)
    return !!projectID && projectID !== "global"
  }

  const createScheduledAutomation = (project: LocalProject) => {
    const projectID = scheduledAutomationProjectID(project)
    if (!projectID || projectID === "global") {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("settings.automation.error.projectNotReady"),
      })
      return
    }
    requestScheduledAutomation({ target: { kind: "project", projectID } })
  }

  const createTemporarySession = async (project: LocalProject) => {
    if (!canCreateTemporarySession()) return
    const created = await globalSDK
      .createClient({ directory: project.worktree, throwOnError: true })
      .session.create({ temporary: true })
      .then((result) => result.data ?? undefined)
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        })
        return undefined
      })
    if (!created) return

    layout.projects.open(project.worktree)
    setStore("projectExpanded", workspaceKey(project.worktree), true)
    setStore("lastProjectSession", project.worktree, {
      directory: created.directory,
      id: created.id,
      at: Date.now(),
    })
    globalSync.child(created.directory, { bootstrap: false })
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session/${created.id}`)
  }

  const openProjectInExplorer = (project: LocalProject) => {
    if (!canOpenProjectPath()) return
    void platform.openPath?.(project.worktree)
  }

  const clearProjectNotifications = (project: LocalProject) => {
    workspaceIds(project)
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  }

  const archiveProjectSessions = async (project: LocalProject) => {
    const archivedAt = Date.now()
    const directories = workspaceIds(project)
    let activeArchived = false

    for (const directory of directories) {
      const sessions = await globalSDK.client.session.list({ directory }).then(
        (result) => result.data ?? [],
        () => [] as Session[],
      )
      if (sessions.length === 0) continue

      const roots = sortedRootSessions({ path: { directory }, session: sessions }, archivedAt)
      const removed = roots.reduce((set, session) => {
        for (const id of descendantSessionIDs(sessions, session.id)) set.add(id)
        return set
      }, new Set<string>())
      if (removed.size === 0) continue

      const archived = await Promise.all(
        Array.from(removed).map((sessionID) =>
          globalSDK.client.session.update({
            directory,
            sessionID,
            time: { archived: archivedAt },
          }),
        ),
      ).then(
        () => true,
        (err) => {
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(err, language.t("common.requestFailed")),
          })
          return false
        },
      )
      if (!archived) return

      const existing = globalSync.existing(directory, { bootstrap: false })
      if (existing) {
        const [, setStore] = existing
        setStore(
          produce((draft) => {
            draft.session = draft.session.filter((item) => !removed.has(item.id))
          }),
        )
      }
      if (workspaceKey(currentDir()) === workspaceKey(directory) && params.id && removed.has(params.id)) {
        activeArchived = true
      }
    }

    if (!activeArchived) return
    navigateWithSidebarReset(`/${base64Encode(project.worktree)}/session`)
  }

  const showEditProjectDialog = (project: LocalProject) => {
    const run = ++dialogRun
    void import("@/components/dialog-edit-project").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogEditProject project={project} />)
    })
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          void openProject(directory, false)
        }
        void navigateToProject(result[0])
      } else if (result) {
        void openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      const run = ++dialogRun
      void import("@/components/dialog-select-directory").then((x) => {
        if (dialogDead || dialogRun !== run) return
        dialog.show(
          () => <x.DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      })
    }
  }

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = currentDir()
    const currentKey = workspaceKey(current)
    const deletedKey = workspaceKey(directory)
    const shouldLeave = leaveDeletedWorkspace || (!!params.dir && currentKey === deletedKey)
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

    setBusy(directory, true)
    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])
    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)
    if (shouldLeave) await waitForWorkspaceRelease()

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    if (workspaceKey(store.lastProjectSession[root]?.directory ?? "") === workspaceKey(directory)) {
      clearLastProjectSession(root)
    }

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setStore("workspaceOrder", root, (order) => (order ?? []).filter((workspace) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = currentDir()
    const nextKey = workspaceKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const valid = dirs.some((item) => workspaceKey(item) === nextKey)

    if (params.dir && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }
  }

  const waitForWorkspaceRelease = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.setTimeout(resolve, 150)
        })
      })
    })

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  function DialogDeleteSession(props: { session: Session }) {
    const name = createMemo(() => sessionTitle(props.session.title) || language.t("command.session.new"))
    const handleDelete = async () => {
      const deleted = await deleteSession(props.session)
      if (!deleted) return
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogDeleteWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [data, setData] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
    })

    onMount(() => {
      globalSDK.client.file
        .list({ path: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setData({ status: "ready", dirty })
        })
        .catch(() => {
          setData({ status: "error", dirty: false })
        })
    })

    const handleDelete = () => {
      const leaveDeletedWorkspace = !!params.dir && workspaceKey(currentDir()) === workspaceKey(props.directory)
      if (leaveDeletedWorkspace) {
        navigateWithSidebarReset(`/${base64Encode(props.root)}/session`)
      }
      dialog.close()
      void deleteWorkspace(props.root, props.directory, leaveDeletedWorkspace)
    }

    const description = () => {
      if (data.status === "loading") return language.t("workspace.status.checking")
      if (data.status === "error") return language.t("workspace.status.error")
      if (!data.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    return (
      <Dialog title={language.t("workspace.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.delete.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">{description()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
              {language.t("workspace.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogResetWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [state, setState] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
      sessions: [] as Session[],
    })

    const refresh = async () => {
      const sessions = await globalSDK.client.session
        .list({ directory: props.directory })
        .then((x) => x.data ?? [])
        .catch(() => [])
      const active = sessions.filter((session) => session.time.archived === undefined)
      setState({ sessions: active })
    }

    onMount(() => {
      globalSDK.client.file
        .list({ path: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setState({ status: "ready", dirty })
          void refresh()
        })
        .catch(() => {
          setState({ status: "error", dirty: false })
        })
    })

    const handleReset = () => {
      dialog.close()
      void resetWorkspace(props.root, props.directory)
    }

    const archivedCount = () => state.sessions.length

    const description = () => {
      if (state.status === "loading") return language.t("workspace.status.checking")
      if (state.status === "error") return language.t("workspace.status.error")
      if (!state.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    const archivedLabel = () => {
      const count = archivedCount()
      if (count === 0) return language.t("workspace.reset.archived.none")
      if (count === 1) return language.t("workspace.reset.archived.one")
      return language.t("workspace.reset.archived.many", { count })
    }

    return (
      <Dialog title={language.t("workspace.reset.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.reset.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">
              {description()} {archivedLabel()} {language.t("workspace.reset.note")}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
              {language.t("workspace.reset.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const activeRoute = {
    session: "",
    sessionProject: "",
    directory: "",
  }

  createEffect(
    on(
      () => {
        return [pageReady(), route().slug, params.id, currentProject()?.worktree, currentDir()] as const
      },
      ([ready, slug, id, root, dir]) => {
        if (!ready || !slug || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        if (!id) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        const session = `${slug}/${id}`

        if (!root) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = ""
          return
        }

        if (server.projects.last() !== root) server.projects.touch(root)

        const changed = session !== activeRoute.session || dir !== activeRoute.directory
        if (changed) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = syncSessionRoute(dir, id, root)
          return
        }

        if (root === activeRoute.sessionProject) return
        activeRoute.directory = dir
        activeRoute.sessionProject = rememberSessionRoute(dir, id, root)
      },
    ),
  )

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? Math.max(sidebarDragWidth() ?? layout.sidebar.width(), 244) : 64
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
  })

  const side = createMemo(() => Math.max(sidebarDragWidth() ?? layout.sidebar.width(), 244))
  const desktopSidebarWidth = createMemo(() => (layout.sidebar.opened() ? side() : 64))
  const panel = createMemo(() => Math.max(side() - 64, 0))

  const loadedSessionDirs = new Set<string>()

  createEffect(
    on(
      visibleSessionDirs,
      (dirs) => {
        if (dirs.length === 0) {
          loadedSessionDirs.clear()
          return
        }

        const next = new Set(dirs)
        for (const directory of next) {
          if (loadedSessionDirs.has(directory)) continue
          void globalSync.project.loadSessions(directory)
        }

        loadedSessionDirs.clear()
        for (const directory of next) {
          loadedSessionDirs.add(directory)
        }
      },
      { defer: true },
    ),
  )

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeProject", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const projects = layout.projects.list()
      const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== -1) {
        layout.projects.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleDragEnd() {
    setStore("activeProject", undefined)
  }

  function workspaceIds(project: LocalProject | undefined) {
    return orderedWorkspaceDirs({
      project,
      activeProjectWorktree: currentProject()?.worktree,
      currentDir: currentDir(),
      persisted: project ? store.workspaceOrder[project.worktree] : undefined,
      isPending: (directory) => WorktreeState.get(directory)?.status === "pending",
    })
  }

  function handleWorkspaceDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace", id)
  }

  function handleWorkspaceDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = currentProject()
    if (!project) return

    const ids = workspaceIds(project)
    const fromIndex = ids.findIndex((dir) => dir === draggable.id.toString())
    const toIndex = ids.findIndex((dir) => dir === droppable.id.toString())
    if (fromIndex === -1 || toIndex === -1) return
    if (fromIndex === toIndex) return

    const result = ids.slice()
    const [item] = result.splice(fromIndex, 1)
    if (!item) return
    result.splice(toIndex, 0, item)
    setStore(
      "workspaceOrder",
      project.worktree,
      result.filter((directory) => workspaceKey(directory) !== workspaceKey(project.worktree)),
    )
  }

  function handleWorkspaceDragEnd() {
    setStore("activeWorkspace", undefined)
  }

  const createWorkspace = async (project: LocalProject) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, created.branch, project.id, created.branch)

    const local = project.worktree
    const key = workspaceKey(created.directory)
    const root = workspaceKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = workspaceKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    navList: currentSessions,
    sidebarExpanded,
    sidebarHovering,
    clearHoverProjectSoon,
    onSelectSession: closeSettings,
    prefetchSession,
    renameSession,
    archiveSession,
    showDeleteSessionDialog: (session) => dialog.show(() => <DialogDeleteSession session={session} />),
    workspaceName,
    renameWorkspace,
    openEditor,
    RenameTrigger,
    isBusy,
    workspaceExpanded: (directory, local) => {
      const key = workspaceKey(directory)
      if (activated.workspaces[key]) return store.workspaceExpanded[key] ?? false
      if (workspaceKey(currentDir()) === key) return store.workspaceExpanded[key] ?? local
      return false
    },
    workspaceExpansionActivated: (directory) => !!activated.workspaces[workspaceKey(directory)],
    setWorkspaceExpanded: (directory, value) => {
      const key = workspaceKey(directory)
      if (value) setActivated("workspaces", key, true)
      setStore("workspaceExpanded", key, value)
    },
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogResetWorkspace root={root} directory={directory} />),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogDeleteWorkspace root={root} directory={directory} />),
    setScrollContainerRef: (el, mobile) => {
      if (!mobile) scrollContainerRef = el
    },
  }

  const projectSidebarCtx: ProjectSidebarContext = {
    currentDir,
    currentSessionID: () => params.id,
    currentProject,
    sidebarOpened: () => layout.sidebar.opened(),
    sidebarHovering,
    navigateToProject,
    openSidebar: () => layout.sidebar.open(),
    toggleExpanded: (directory: string) => {
      const key = workspaceKey(directory)
      const currentProjectKey = workspaceKey(currentProject()?.worktree ?? "")
      const wasActivated = !!activated.projects[key]
      setActivated("projects", key, true)
      if (!wasActivated && key !== currentProjectKey) {
        setStore("projectExpanded", key, true)
        return
      }
      const current = store.projectExpanded[key] ?? (key === currentProjectKey)
      setStore("projectExpanded", key, !current)
    },
    isExpanded: (directory: string) => {
      const key = workspaceKey(directory)
      const currentProjectKey = workspaceKey(currentProject()?.worktree ?? "")
      if (!activated.projects[key]) {
        if (key !== currentProjectKey) return false
        return store.projectExpanded[key] ?? true
      }
      if (store.projectExpanded[key] !== undefined) return store.projectExpanded[key]
      return key === currentProjectKey
    },
    projectExpansionActivated: (directory: string) => !!activated.projects[workspaceKey(directory)],
    setExpanded: (directory: string, value: boolean) => {
      const key = workspaceKey(directory)
      if (value) setActivated("projects", key, true)
      setStore("projectExpanded", key, value)
    },
    isProjectPinned: (project: LocalProject) => layout.projects.isPinned(project.worktree),
    toggleProjectPinned: (project: LocalProject) => layout.projects.togglePinned(project.worktree),
    closeProject,
    startProjectRename,
    toggleProjectWorkspaces,
    workspacesEnabled: (project: LocalProject) =>
      project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
    workspaceIds,
    workspaceLabel,
    projectEditorID,
    renameProject,
    openProjectInExplorer,
    canCreateScheduledAutomation,
    createScheduledAutomation,
    canCreateTemporarySession,
    createTemporarySession,
    archiveProjectSessions,
    clearProjectNotifications,
    canOpenProjectPath,
    RenameTrigger,
    sessionProps: {
      navList: currentSessions,
      sidebarExpanded,
      sidebarHovering,
      clearHoverProjectSoon,
      onSelect: closeSettings,
      prefetchSession,
      renameSession,
      archiveSession,
      showDeleteSessionDialog: (session: Session) => dialog.show(() => <DialogDeleteSession session={session} />),
      openEditor,
      RenameTrigger,
    },
  }

  const SidebarPanel = (panelProps: {
    project: Accessor<LocalProject | undefined>
    mobile?: boolean
    merged?: boolean
  }) => {
    const project = panelProps.project
    const merged = createMemo(() => panelProps.mobile || (panelProps.merged ?? layout.sidebar.opened()))
    const hover = createMemo(() => !panelProps.mobile && panelProps.merged === false && !layout.sidebar.opened())
    const empty = createMemo(() => !params.dir && layout.projects.list().length === 0)
    const projectName = createMemo(() => {
      const item = project()
      if (!item) return ""
      return item.name || getFilename(item.worktree)
    })
    const projectId = createMemo(() => project()?.id ?? "")
    const worktree = createMemo(() => project()?.worktree ?? "")
    const slug = createMemo(() => {
      const dir = worktree()
      if (!dir) return ""
      return base64Encode(dir)
    })
    const workspaces = createMemo(() => {
      const item = project()
      if (!item) return [] as string[]
      return workspaceIds(item)
    })
    const unseenCount = createMemo(() =>
      workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
    )
    const clearNotifications = () =>
      workspaces()
        .filter((directory) => notification.project.unseenCount(directory) > 0)
        .forEach((directory) => notification.project.markViewed(directory))
    const workspacesEnabled = createMemo(() => {
      const item = project()
      if (!item) return false
      if (item.vcs !== "git") return false
      return layout.sidebar.workspaces(item.worktree)()
    })
    const canToggle = createMemo(() => {
      const item = project()
      if (!item) return false
      return item.vcs === "git" || layout.sidebar.workspaces(item.worktree)()
    })
    const homedir = createMemo(() => globalSync.data.path.home)

    return (
      <div
        classList={{
          "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
          "border border-b-0 border-border-weak-base": !merged(),
          "border-l border-t border-border-weaker-base": merged(),
          "bg-background-base": merged() || hover(),
          "bg-background-stronger": !merged() && !hover(),
          "flex-1 min-w-0": panelProps.mobile,
          "max-w-full overflow-hidden": panelProps.mobile,
        }}
        style={{
          width: panelProps.mobile ? undefined : `${panel()}px`,
        }}
      >
        <Show
          when={project()}
          fallback={
            <Show when={empty()}>
              <div class="flex-1 min-h-0 -mt-4 flex items-center justify-center px-6 pb-64 text-center">
                <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                  <div class="flex flex-col gap-3">
                    <div class="text-14-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.empty.description")}
                    </div>
                  </div>
                  <Button size="large" icon="folder-add-left" onClick={chooseProject}>
                    {language.t("command.project.open")}
                  </Button>
                </div>
              </div>
            </Show>
          }
        >
          {(project) => (
            <>
              <div class="shrink-0 pl-1 py-1">
                <div class="group/project flex items-start justify-between gap-2 py-2 pl-2 pr-0">
                  <div class="flex flex-col min-w-0">
                    <RenameTrigger
                      id={`project:${projectId()}`}
                      value={projectName}
                      onSave={(next) => {
                        const item = project()
                        if (!item) return
                        return renameProject(item, next)
                      }}
                      class="text-14-medium text-text-strong truncate"
                      displayClass="text-14-medium text-text-strong truncate"
                      stopPropagation
                    />

                    <Tooltip
                      placement="bottom"
                      gutter={2}
                      value={worktree()}
                      class="shrink-0"
                      contentStyle={{
                        "max-width": "640px",
                        transform: "translate3d(52px, 0, 0)",
                      }}
                    >
                      <span class="text-12-regular text-text-base truncate select-text">
                        {worktree().replace(homedir(), "~")}
                      </span>
                    </Tooltip>
                  </div>

                  <DropdownMenu modal={!sidebarHovering()}>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      data-action="project-menu"
                      data-project={slug()}
                      class="shrink-0 size-6 rounded-md transition-opacity data-[expanded]:bg-surface-base-active"
                      classList={{
                        "opacity-100": panelProps.mobile || merged(),
                        "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[expanded]:opacity-100":
                          !panelProps.mobile && !merged(),
                      }}
                      aria-label={language.t("common.moreOptions")}
                    />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item
                          onSelect={() => {
                            const item = project()
                            if (!item) return
                            showEditProjectDialog(item)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-action="project-workspaces-toggle"
                          data-project={slug()}
                          disabled={!canToggle()}
                          onSelect={() => {
                            const item = project()
                            if (!item) return
                            toggleProjectWorkspaces(item)
                          }}
                        >
                          <DropdownMenu.ItemLabel>
                            {workspacesEnabled()
                              ? language.t("sidebar.workspaces.disable")
                              : language.t("sidebar.workspaces.enable")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-action="project-clear-notifications"
                          data-project={slug()}
                          disabled={unseenCount() === 0}
                          onSelect={clearNotifications}
                        >
                          <DropdownMenu.ItemLabel>
                            {language.t("sidebar.project.clearNotifications")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          data-action="project-close-menu"
                          data-project={slug()}
                          onSelect={() => {
                            const dir = worktree()
                            if (!dir) return
                            void closeProject(dir)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              </div>

              <div class="flex-1 min-h-0 flex flex-col">
                <Show
                  when={workspacesEnabled()}
                  fallback={
                    <>
                      <div class="shrink-0 py-4">
                        <Button
                          size="large"
                          icon="new-session"
                          class="w-full"
                          onClick={() => {
                            const dir = worktree()
                            if (!dir) return
                            navigateWithSidebarReset(`/${base64Encode(dir)}/session`)
                          }}
                        >
                          {language.t("command.session.new")}
                        </Button>
                      </div>
                      <div class="flex-1 min-h-0">
                        <LocalWorkspace
                          ctx={workspaceSidebarCtx}
                          project={project()}
                          mobile={panelProps.mobile}
                        />
                      </div>
                    </>
                  }
                >
                  <>
                    <div class="shrink-0 py-4">
                      <Button
                        size="large"
                        icon="plus-small"
                        class="w-full"
                        onClick={() => {
                          const item = project()
                          if (!item) return
                          void createWorkspace(item)
                        }}
                      >
                        {language.t("workspace.new")}
                      </Button>
                    </div>
                    <div class="relative flex-1 min-h-0">
                      <DragDropProvider
                        onDragStart={handleWorkspaceDragStart}
                        onDragEnd={handleWorkspaceDragEnd}
                        onDragOver={handleWorkspaceDragOver}
                        collisionDetector={closestCenter}
                      >
                        <DragDropSensors />
                        <ConstrainDragXAxis />
                        <div
                          ref={(el) => {
                            if (!panelProps.mobile) scrollContainerRef = el
                          }}
                          class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar [overflow-anchor:none]"
                        >
                          <SortableProvider ids={workspaces()}>
                            <For each={workspaces()}>
                              {(directory) => (
                                <SortableWorkspace
                                  ctx={workspaceSidebarCtx}
                                  directory={directory}
                                  project={project()}
                                  mobile={panelProps.mobile}
                                />
                              )}
                            </For>
                          </SortableProvider>
                        </div>
                        <DragOverlay>
                          <WorkspaceDragOverlay
                            sidebarProject={currentProject}
                            activeWorkspace={() => store.activeWorkspace}
                            workspaceLabel={workspaceLabel}
                          />
                        </DragOverlay>
                      </DragDropProvider>
                    </div>
                  </>
                </Show>
              </div>
            </>
          )}
        </Show>

        <div
          class="shrink-0 px-3 py-3"
          classList={{
            hidden: store.gettingStartedDismissed || !(providers.all().length > 0 && providers.paid().length === 0),
          }}
        >
          <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
            <div class="p-3 flex flex-col gap-6">
              <div class="flex flex-col gap-2">
                <div class="text-14-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
                <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                  {language.t("sidebar.gettingStarted.line1")}
                </div>
                <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                  {language.t("sidebar.gettingStarted.line2")}
                </div>
              </div>
              <div data-component="getting-started-actions">
                <Button size="large" icon="plus-small" onClick={connectProvider}>
                  {language.t("command.provider.connect")}
                </Button>
                <Button size="large" variant="ghost" onClick={() => setStore("gettingStartedDismissed", true)}>
                  {language.t("toast.update.action.notYet")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const projects = () =>
    sortedProjects(
      layout.projects.list().filter((project) => project.worktree !== "/"),
      {
        pinned: (project) => layout.projects.isPinned(project.worktree),
      },
    )
  const sidebarQuickActions = (): SidebarQuickAction[] => [
    {
      id: "new-session",
      icon: "new-session",
      label: () => language.t("sidebar.quickAction.newSession"),
      active: () => !settingsOpen() && !params.id,
      onSelect: openSidebarNewSession,
    },
    {
      id: "scheduled",
      icon: "status",
      label: () => language.t("sidebar.quickAction.scheduled"),
      active: () => location.pathname.endsWith("/automation"),
      onSelect: () => {
        const directory = currentDir() || currentProject()?.worktree
        if (directory) navigateWithSidebarReset(`/${base64Encode(directory)}/automation`)
      },
    },
    {
      id: "plugins",
      icon: "mcp",
      label: () => language.t("settings.plugins.title"),
      active: () => location.pathname.endsWith("/plugins"),
      onSelect: () => {
        const directory = currentDir() || currentProject()?.worktree
        if (directory) navigateWithSidebarReset(`/${base64Encode(directory)}/plugins`)
      },
    },
  ]
  const sidebarRail = () => (
    <div class="flex h-full w-full flex-col items-center justify-between px-2 py-3">
      <div class="flex min-h-0 w-full flex-col items-center gap-2 overflow-y-auto no-scrollbar">
        <For each={sidebarQuickActions()}>
          {(action) => (
            <Tooltip placement="right" value={action.label()}>
              <IconButton
                icon={action.icon}
                variant="ghost"
                size="large"
                data-action={`sidebar-quick-${action.id}`}
                onClick={action.onSelect}
                aria-label={action.label()}
                aria-current={action.active?.() ? "page" : undefined}
                classList={{
                  "bg-surface-base-active text-icon-strong": action.active?.() === true,
                  "text-icon-weak hover:bg-surface-raised-base-hover hover:text-icon-strong": action.active?.() !== true,
                }}
              />
            </Tooltip>
          )}
        </For>
        <div class="h-px w-full bg-border-weak-base" />
        <Tooltip placement="right" value={language.t("command.project.open")}>
          <IconButton
            icon="plus"
            variant="ghost"
            size="large"
            onClick={chooseProject}
            aria-label={language.t("command.project.open")}
          />
        </Tooltip>
        <For each={projects()}>
          {(project) => {
            const active = () => workspaceKey(project.worktree) === workspaceKey(currentProject()?.worktree ?? "")
            return (
              <Tooltip placement="right" value={displayName(project)}>
                <button
                  type="button"
                  classList={{
                    "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors": true,
                    "bg-surface-base-active text-icon-strong": active(),
                    "text-icon-weak hover:bg-surface-raised-base-hover hover:text-icon-strong": !active(),
                  }}
                  aria-label={displayName(project)}
                  onClick={() => {
                    projectSidebarCtx.setExpanded(project.worktree, true)
                    projectSidebarCtx.navigateToProject(project.worktree)
                    layout.sidebar.open()
                  }}
                >
                  <Icon name="folder" size="small" />
                </button>
              </Tooltip>
            )
          }}
        </For>
      </div>
      <div class="flex w-full flex-col items-center gap-2 border-t border-border-weak-base pt-3">
        <Show when={props.quotaAction?.()}>{(action) => action()}</Show>
        <Tooltip
          placement="right"
          value={settingsOpen() ? language.t("common.goBack") : language.t("sidebar.settings")}
        >
          <IconButton
            icon={settingsOpen() ? "arrow-left" : "settings-gear"}
            variant="ghost"
            size="large"
            data-action="settings-toggle"
            onClick={() => {
              if (settingsOpen()) {
                closeSettings()
                return
              }
              openSettings()
            }}
            aria-label={settingsOpen() ? language.t("common.goBack") : language.t("sidebar.settings")}
          />
        </Tooltip>
        <Tooltip placement="right" value={language.t("sidebar.help")}>
          <IconButton
            icon="help"
            variant="ghost"
            size="large"
            onClick={() => platform.openLink("https://lfcode.ai/desktop-feedback")}
            aria-label={language.t("sidebar.help")}
          />
        </Tooltip>
      </div>
    </div>
  )

  const sidebarContent = (mobile?: boolean) => (
    <SidebarContent
      mobile={mobile}
      quickActions={sidebarQuickActions}
      sections={() =>
        projects().length === 0
          ? [
              <div class="flex-1 min-h-0 -mt-4 flex items-center justify-center px-6 pb-64 text-center">
                <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                  <div class="flex flex-col gap-3">
                    <div class="text-14-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.empty.description")}
                    </div>
                  </div>
                  <Button size="large" icon="folder-add-left" onClick={chooseProject}>
                    {language.t("command.project.open")}
                  </Button>
                </div>
              </div>,
            ]
          : projects().map((project) => (
              <ProjectSection ctx={projectSidebarCtx} project={project} mobile={mobile} />
            ))
      }
      openProjectLabel={language.t("command.project.open")}
      openProjectKeybind={() => command.keybind("project.open")}
      onOpenProject={chooseProject}
      quotaAction={props.quotaAction}
      settingsOpen={settingsOpen}
      settingsLabel={() => (settingsOpen() ? language.t("common.goBack") : language.t("sidebar.settings"))}
      settingsKeybind={() => (settingsOpen() ? undefined : command.keybind("settings.open"))}
      onOpenSettings={openSettings}
      onCloseSettings={closeSettings}
      helpLabel={() => language.t("sidebar.help")}
      onOpenHelp={() => platform.openLink("https://lfcode.ai/desktop-feedback")}
    />
  )

  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      {autoselecting() ?? ""}
      <Titlebar settingsOpen={settingsOpen} />
      <div class="flex-1 min-h-0 min-w-0 flex">
        <div class="flex-1 min-h-0 relative">
          <div class="size-full relative overflow-x-hidden">
            <nav
              aria-label={language.t("sidebar.nav.projectsAndSessions")}
              data-component="sidebar-nav-desktop"
              classList={{
                "hidden lg:block": true,
                "absolute inset-y-0 left-0": true,
                "z-10": true,
              }}
              style={{ width: `${desktopSidebarWidth()}px` }}
              onClick={closeSettingsForSessionSelection}
              ref={(el) => {
                setState("nav", el)
              }}
            >
              <div class="@container w-full h-full contain-strict">
                <Show when={layout.sidebar.opened()} fallback={sidebarRail()}>
                  {sidebarContent()}
                </Show>
              </div>
            </nav>

            <Show when={layout.sidebar.opened()}>
              <div
                class="hidden lg:block absolute inset-y-0 z-30 w-0 overflow-visible"
                style={{ left: `${side()}px` }}
                onPointerDown={() => setState("sizing", true)}
              >
                <ResizeHandle
                  direction="horizontal"
                  class="sidebar-resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整侧边栏宽度"
                  size={side()}
                  min={244}
                  max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                  onResize={(w) => {
                    setState("sizing", true)
                    setSidebarDragWidth(w)
                  }}
                  onResizeEnd={(w) => {
                    layout.sidebar.resize(w)
                    setSidebarDragWidth()
                    setState("sizing", false)
                  }}
                />
              </div>
            </Show>

            <div
              class="hidden lg:block pointer-events-none absolute top-0 right-0 z-0 border-t border-border-weaker-base"
              style={{ left: "calc(4rem + 12px)" }}
            />

            <div class="lg:hidden">
              <div
                data-component="sidebar-mobile-backdrop"
                classList={{
                  "fixed inset-x-0 top-10 bottom-0 z-40 bg-background-inverse/20 transition-opacity duration-200": true,
                  "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
                  "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) layout.mobileSidebar.hide()
                }}
              />
              <nav
                aria-label={language.t("sidebar.nav.projectsAndSessions")}
                data-component="sidebar-nav-mobile"
                classList={{
                  "@container fixed top-10 bottom-0 left-0 z-50 w-full max-w-[400px] overflow-hidden border-r border-border-weaker-base bg-background-base transition-transform duration-200 ease-out": true,
                  "translate-x-0": layout.mobileSidebar.opened(),
                  "-translate-x-full": !layout.mobileSidebar.opened(),
                }}
                onClick={(e) => {
                  closeSettingsForSessionSelection(e)
                  e.stopPropagation()
                }}
              >
                <Show when={layout.mobileSidebar.opened()}>{sidebarContent(true)}</Show>
              </nav>
            </div>

            <div
              classList={{
                "absolute inset-0": true,
                "lg:inset-y-0 lg:right-0 lg:left-[var(--main-left)]": true,
                "z-20": true,
                "transition-[left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[left] motion-reduce:transition-none":
                  !state.sizing,
              }}
              style={{
                "--main-left": `${desktopSidebarWidth()}px`,
              }}
            >
              <main
                classList={{
                  "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base bg-background-base lg:border-l": true,
                  "lg:rounded-tl-[12px]": !settingsOpen() && !isTopLevelWorkspacePage(),
                }}
              >
                <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
                  <div class="relative size-full">
                    <div class="size-full">{props.children}</div>
                  </div>
                </Show>
              </main>
            </div>

            <Show when={import.meta.env.DEV}>
              <DebugBar />
            </Show>
          </div>
        </div>
      </div>
      <Show when={settingsOpen() && !isTopLevelWorkspacePage()}>
        <section
          class="absolute inset-x-0 top-10 bottom-0 z-[60] bg-background-base"
          data-component="settings-full-page"
          aria-label={language.t("sidebar.settings")}
        >
          <SettingsView
            defaultValue={settingsTab()}
            directory={currentDir() || currentProject()?.worktree}
            onClose={closeSettings}
            showNavigation={!settingsDirect()}
          />
        </section>
      </Show>
      <Toast.Region />
    </div>
  )
}
