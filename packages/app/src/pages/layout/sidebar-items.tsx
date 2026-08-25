import type { Session } from "@lfcode-ai/sdk/v2/client"
import { Avatar } from "@lfcode-ai/ui/avatar"
import { ContextMenu } from "@lfcode-ai/ui/context-menu"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Spinner } from "@lfcode-ai/ui/spinner"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { showToast } from "@lfcode-ai/ui/toast"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { A, useNavigate, useParams } from "@solidjs/router"
import { type Accessor, createMemo, For, type JSX, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import type { State } from "@/context/global-sync/types"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { messageAgentColor } from "@/utils/agent"
import { isSessionWorking } from "@/utils/session-status"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { childSessionOnPath, hasProjectPermissions, isSidebarSessionSelected } from "./helpers"
import { buildSessionMenuActions, sessionDeeplink } from "./menu-actions"
import type { RenameTriggerComponent } from "./inline-editor"

const LFCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export const ProjectIcon = (props: { project: LocalProject; class?: string; notify?: boolean }): JSX.Element => {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.permission, (item) => !permission.autoResponds(item, directory))
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))

  return (
    <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
      <div class="size-full rounded overflow-clip">
        <Avatar
          fallback={name()}
          src={
            props.project.id === LFCODE_PROJECT_ID
              ? "https://lfcode.ai/favicon.svg"
              : props.project.icon?.override || props.project.icon?.url
          }
          {...getAvatarColors(props.project.icon?.color)}
          class="size-full rounded"
          classList={{ "badge-mask": notify() }}
        />
      </div>
      <Show when={notify()}>
        <div
          classList={{
            "absolute top-px right-px size-1.5 rounded-full z-10": true,
            "bg-surface-warning-strong": hasPermissions(),
            "bg-icon-critical-base": !hasPermissions() && hasError(),
            "bg-text-interactive-base": !hasPermissions() && !hasError(),
          }}
        />
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  directoryStore?: Pick<State, "agent" | "message" | "permission" | "session" | "session_status">
  navList?: Accessor<Session[]>
  slug: string
  mobile?: boolean
  dense?: boolean
  showTooltip?: boolean
  showChild?: boolean
  level?: number
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  clearHoverProjectSoon: () => void
  onSelect?: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  renameSession: (session: Session, next: string) => Promise<void>
  archiveSession: (session: Session) => Promise<void>
  showDeleteSessionDialog: (session: Session) => void
  openEditor: (id: string, value: string, onSave: (next: string) => void | Promise<void>) => void
  RenameTrigger: RenameTriggerComponent
}

const SessionRow = (props: {
  session: Session
  slug: string
  mobile?: boolean
  dense?: boolean
  tint: Accessor<string | undefined>
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  clearHoverProjectSoon: () => void
  onSelect?: () => void
  sidebarOpened: Accessor<boolean>
  titleValue: Accessor<string>
  temporary: boolean
  temporaryLabel: string
  temporaryTooltip: string
  RenameTrigger: RenameTriggerComponent
  renameSession: (session: Session, next: string) => Promise<void>
  warmPress: () => void
  warmFocus: () => void
  warmHover: () => void
}): JSX.Element => {
  return (
    <A
      href={`/${props.slug}/session/${props.session.id}`}
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onPointerDown={props.warmPress}
      onFocus={props.warmFocus}
      onPointerEnter={props.warmHover}
      onClick={() => {
        props.onSelect?.()
        if (props.sidebarOpened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <Show when={props.isWorking() || props.hasPermissions() || props.hasError() || props.unseenCount() > 0}>
        <div
          class="shrink-0 size-6 flex items-center justify-center"
          style={{ color: props.tint() ?? "var(--icon-interactive-base)" }}
        >
          <Switch>
            <Match when={props.isWorking()}>
              <Spinner class="size-[15px]" />
            </Match>
            <Match when={props.hasPermissions()}>
              <div class="size-1.5 rounded-full bg-surface-warning-strong" />
            </Match>
            <Match when={props.hasError()}>
              <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
            </Match>
            <Match when={props.unseenCount() > 0}>
              <div class="size-1.5 rounded-full bg-text-interactive-base" />
            </Match>
          </Switch>
        </div>
      </Show>
      <props.RenameTrigger
        id={`session:${props.session.id}`}
        value={props.titleValue}
        onSave={(next) => props.renameSession(props.session, next)}
        class="text-14-regular text-text-strong min-w-0 flex-1 truncate"
        displayClass="text-14-regular text-text-strong min-w-0 flex-1 truncate"
        stopPropagation
      />
      <Show when={props.temporary}>
        <span
          class="shrink-0 rounded bg-surface-warning-strong/15 px-1 text-11-medium text-text-weak"
          title={props.temporaryTooltip}
        >
          {props.temporaryLabel}
        </span>
      </Show>
    </A>
  )
}

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useParams()
  const navigate = useNavigate()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const server = useServer()
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const sessionStore = createMemo(() => {
    if (props.directoryStore) return props.directoryStore
    return globalSync.child(props.session.directory)[0]
  })
  const hasPermissions = createMemo(() => {
    const store = sessionStore()
    return !!sessionPermissionRequest(store.session, store.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    return isSessionWorking(sessionStore().session_status[props.session.id])
  })

  const tint = createMemo(() => {
    const store = sessionStore()
    return messageAgentColor(store.message[props.session.id], store.agent)
  })
  const tooltip = createMemo(() => props.showTooltip ?? (props.mobile || !props.sidebarExpanded()))
  const currentChild = createMemo(() => {
    if (!props.showChild) return
    return childSessionOnPath(sessionStore().session, props.session.id, params.id)
  })
  const selected = createMemo(() => isSidebarSessionSelected(props.session.id, params.id))
  const editorID = createMemo(() => `session:${props.session.id}`)
  const pinned = createMemo(() => layout.sessions.isPinned(props.session.directory, props.session.id))
  const canOpenInExplorer = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal() === true)
  const canCopyDeeplink = createMemo(() => server.isLocal() === true)
  const titleValue = createMemo(() => sessionTitle(props.session.title) ?? "")
  const temporary = createMemo(() => "temporary" in props.session && props.session.temporary === true)
  const [menu, setMenu] = createStore({
    open: false,
    context: false,
    pendingRename: false,
  })
  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value).then(
      () => {
        showToast({ title: language.t("session.share.copy.copied") })
      },
      () => {
        showToast({ title: language.t("common.requestFailed") })
      },
    )
  }
  const forkSession = async () => {
    const result = await globalSDK
      .createClient({ directory: props.session.directory, throwOnError: true })
      .session.fork({ sessionID: props.session.id })
      .catch(() => undefined)
    if (!result?.data?.id) {
      showToast({ title: language.t("common.requestFailed") })
      return
    }
    const directory = result.data.directory ?? props.session.directory
    navigate(`/${base64Encode(directory)}/session/${result.data.id}`)
  }
  const menuActions = createMemo(() =>
    buildSessionMenuActions({
      t: language.t,
      pinned: pinned(),
      unread: unseenCount() > 0,
      canOpenInExplorer: canOpenInExplorer(),
      canCopyDeeplink: canCopyDeeplink(),
      onTogglePinned: () => layout.sessions.togglePinned(props.session.directory, props.session.id),
      onRename: () => {
        setMenu("pendingRename", true)
        setMenu("open", false)
      },
      onArchive: () => void props.archiveSession(props.session),
      onMarkUnread: () => notification.session.markUnread(props.session.id, props.session.directory),
      onOpenInExplorer: () => void platform.openPath?.(props.session.directory),
      onCopyWorkingDirectory: () => void copyText(props.session.directory),
      onCopySessionID: () => void copyText(props.session.id),
      onCopyDeeplink: () => void copyText(sessionDeeplink(props.session.directory, props.session.id)),
      onFork: () => void forkSession(),
      onDelete: () => props.showDeleteSessionDialog(props.session),
    }),
  )

  const warm = (span: number, priority: "high" | "low") => {
    const nav = props.navList?.()
    const list = nav?.some((item) => item.id === props.session.id && item.directory === props.session.directory)
      ? nav
      : props.list

    props.prefetchSession(props.session, priority)

    const idx = list.findIndex((item) => item.id === props.session.id && item.directory === props.session.directory)
    if (idx === -1) return

    for (let step = 1; step <= span; step++) {
      const next = list[idx + step]
      if (next) props.prefetchSession(next, step === 1 ? "high" : priority)

      const prev = list[idx - step]
      if (prev) props.prefetchSession(prev, step === 1 ? "high" : priority)
    }
  }

  const item = (
    <SessionRow
      session={props.session}
      slug={props.slug}
      mobile={props.mobile}
      dense={props.dense}
      tint={tint}
      isWorking={isWorking}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      clearHoverProjectSoon={props.clearHoverProjectSoon}
      onSelect={props.onSelect}
      sidebarOpened={layout.sidebar.opened}
      titleValue={titleValue}
      temporary={temporary()}
      temporaryLabel={language.t("session.temporary")}
      temporaryTooltip={language.t("session.temporary.tooltip")}
      RenameTrigger={props.RenameTrigger}
      renameSession={props.renameSession}
      warmPress={() => warm(1, "high")}
      warmFocus={() => props.prefetchSession(props.session, "high")}
      warmHover={() => warm(1, "low")}
    />
  )

  return (
    <>
      <ContextMenu onOpenChange={(open) => setMenu("context", open)}>
        <ContextMenu.Trigger as="div" class="w-full">
          <div
            data-session-id={props.session.id}
            data-component="sidebar-session-item"
            class="group/session relative w-full min-w-0 rounded-lg cursor-default pr-3 transition-colors duration-[var(--motion-micro-ms)] ease-[var(--motion-ease-out)] has-[.active]:bg-surface-base-active"
            classList={{
              "bg-surface-base-active shadow-xs-border-base": selected(),
              "bg-surface-raised-base-hover": !selected() && (menu.open || menu.context),
              "hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover":
                !selected(),
            }}
            style={{ "padding-left": `${8 + (props.level ?? 0) * 16}px` }}
          >
            <div class="flex min-w-0 items-center gap-1">
              <div class="min-w-0 flex-1">
                <Show
                  when={!tooltip()}
                  fallback={
                    <Tooltip
                      placement={props.mobile ? "bottom" : "right"}
                      value={titleValue()}
                      gutter={10}
                      class="min-w-0 w-full"
                    >
                      {item}
                    </Tooltip>
                  }
                >
                  {item}
                </Show>
              </div>

              <div
                class="shrink-0 overflow-hidden transition-[width,opacity] duration-[var(--motion-micro-ms)] ease-[var(--motion-ease-out)]"
                classList={{
                  "w-6 opacity-100 pointer-events-auto": !!props.mobile || selected() || menu.open || menu.context,
                  "w-0 opacity-0 pointer-events-none": !props.mobile && !selected() && !menu.open && !menu.context,
                  "group-hover/session:w-6 group-hover/session:opacity-100 group-hover/session:pointer-events-auto": true,
                  "group-focus-within/session:w-6 group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto": true,
                }}
              >
                <DropdownMenu modal={!props.sidebarHovering()} open={menu.open} onOpenChange={(open) => setMenu("open", open)}>
                  <Tooltip value={language.t("common.moreOptions")} placement="top">
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="size-6 rounded-md"
                      classList={{ "bg-surface-base-active": menu.open }}
                      aria-label={language.t("common.moreOptions")}
                    />
                  </Tooltip>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      onCloseAutoFocus={(event) => {
                        if (!menu.pendingRename) return
                        event.preventDefault()
                        setMenu("pendingRename", false)
                        props.openEditor(editorID(), titleValue(), (next) => props.renameSession(props.session, next))
                      }}
                    >
                      <For each={menuActions()}>
                        {(action) =>
                          action.kind === "separator" ? (
                            <DropdownMenu.Separator />
                          ) : (
                            <DropdownMenu.Item disabled={action.disabled} onSelect={action.onSelect}>
                              <DropdownMenu.ItemLabel>{action.label}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          )
                        }
                      </For>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            onCloseAutoFocus={(event) => {
              if (!menu.pendingRename) return
              event.preventDefault()
              setMenu("pendingRename", false)
              props.openEditor(editorID(), titleValue(), (next) => props.renameSession(props.session, next))
            }}
          >
            <For each={menuActions()}>
              {(action) =>
                action.kind === "separator" ? (
                  <ContextMenu.Separator />
                ) : (
                  <ContextMenu.Item disabled={action.disabled} onSelect={action.onSelect}>
                    <ContextMenu.ItemLabel>{action.label}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                )
              }
            </For>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
      <Show when={currentChild()}>
        {(child) => (
          <div class="w-full">
            <SessionItem {...props} session={child()} level={(props.level ?? 0) + 1} />
          </div>
        )}
      </Show>
    </>
  )
}

export const NewSessionItem = (props: {
  slug: string
  mobile?: boolean
  dense?: boolean
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
  onSelect?: () => void
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const label = language.t("command.session.new")
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  const item = (
    <A
      href={`/${props.slug}/session`}
      end
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onClick={() => {
        props.onSelect?.()
        if (layout.sidebar.opened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <div class="shrink-0 size-6 flex items-center justify-center">
        <Icon name="new-session" size="small" class="text-icon-weak" />
      </div>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{label}</span>
    </A>
  )

  return (
    <div
      data-component="sidebar-session-item"
      class="group/session relative w-full min-w-0 rounded-md cursor-default transition-colors duration-[var(--motion-micro-ms)] ease-[var(--motion-ease-out)] pl-2 pr-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
    >
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10} class="min-w-0 w-full">
            {item}
          </Tooltip>
        }
      >
        {item}
      </Show>
    </div>
  )
}

export const SessionSkeleton = (props: { count?: number }): JSX.Element => {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
  return (
    <div class="flex flex-col gap-1">
      <For each={items}>
        {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}
