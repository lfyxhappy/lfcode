import { createEffect, createMemo, createResource, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { useNavigate } from "@solidjs/router"
import { ContextMenu } from "@lfcode-ai/ui/context-menu"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { useLayout, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { showToast } from "@lfcode-ai/ui/toast"
import { SessionItem, type SessionItemProps } from "./sidebar-items"
import { displayName, sortedRootSessions, workspaceKey } from "./helpers"
import { resolveProjectSidebarCtx, type ProjectSectionProps, type ProjectSidebarContext } from "./sidebar-project-context"
import { SessionSkeleton } from "./sidebar-items"
import { buildProjectMenuActions, type MenuAction } from "./menu-actions"

export const ProjectDragOverlay = (props: {
  projects: Accessor<LocalProject[]>
  activeProject: Accessor<string | undefined>
}): JSX.Element => {
  const project = createMemo(() => props.projects().find((p) => p.worktree === props.activeProject()))
  return (
    <Show when={project()}>
      {(p) => (
        <div class="flex items-center gap-2 rounded-lg bg-background-base px-2 py-1.5">
          <div class="flex size-5 shrink-0 items-center justify-center text-icon-weak">
            <Icon name="folder" size="small" />
          </div>
          <div class="text-14-medium text-text-strong truncate">{displayName(p())}</div>
        </div>
      )}
    </Show>
  )
}

export const ProjectSection = (props: ProjectSectionProps): JSX.Element => {
  const navigate = useNavigate()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const platform = usePlatform()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const ctx = resolveProjectSidebarCtx(props)
  const [state, setState] = createStore({
    menu: false,
  })
  const workspaces = createMemo(() => ctx.workspaceIds(props.project))
  const expanded = createMemo(() => ctx.isExpanded(props.project.worktree))
  const isCurrentProject = createMemo(() => ctx.currentProject()?.worktree === props.project.worktree)
  const projectStore = createMemo(() => globalSync.child(props.project.worktree, { bootstrap: false })[0])
  const projectSessions = createMemo(() =>
    sortedRootSessions(projectStore(), Date.now(), {
      pinned: (session) => layout.sessions.isPinned(session.directory, session.id),
      pinStamp: layout.sessions.stamp(),
    }),
  )
  const loading = createMemo(() => projectStore().status !== "complete" && projectSessions().length === 0)
  const projectName = createMemo(() => displayName(props.project))
  const projectEditorID = createMemo(() => ctx.projectEditorID(props.project))
  const pinned = createMemo(() => ctx.isProjectPinned(props.project))
  const workspacesEnabled = createMemo(() => ctx.workspacesEnabled(props.project))
  const activeSession = createMemo(() => {
    const sessionID = ctx.currentSessionID()
    if (!sessionID) return
    const currentDir = ctx.currentDir()
    if (!currentDir) return
    const store = globalSync.child(currentDir, { bootstrap: false })[0]
    return store.session?.find((session) => session.id === sessionID)
  })
  const activeSandboxSession = createMemo(() => {
    const session = activeSession()
    if (!session) return
    if (workspaceKey(session.directory) === workspaceKey(props.project.worktree)) return
    if (!props.project.sandboxes?.some((sandbox) => workspaceKey(sandbox) === workspaceKey(session.directory))) return
    return session
  })
  const sessions = createMemo(() => {
    const list = projectSessions()
    const active = activeSandboxSession()
    if (!active) return list
    if (list.some((session) => session.id === active.id && workspaceKey(session.directory) === workspaceKey(active.directory))) {
      return list
    }
    return [active, ...list]
  })
  const unseenCount = createMemo(() =>
    workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const tavernProject = createMemo(() => props.project.extension?.pluginID === "lfcode-tavern" && props.project.extension.type === "tavern")
  const [claudeCapability] = createResource(
    () => (platform.platform === "desktop" && server.isLocal() ? props.project.worktree : undefined),
    async (directory) => (await globalSDK.createClient({ directory, throwOnError: true }).claudeCode.capability()).data,
  )
  const canCreateClaudeCodeSession = createMemo(() => claudeCapability()?.available === true)
  const createClaudeCodeSession = async () => {
    try {
      const result = await globalSDK.createClient({ directory: props.project.worktree, throwOnError: true }).claudeCode.create()
      const sessionID = result.data?.session.id
      if (!sessionID) throw new Error("Claude Code session was not created")
      navigate(`/${base64Encode(props.project.worktree)}/session/${sessionID}`)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }
  const openTavern = (view: "new" | "characters" | "personas" | "presets" | "groups" | "worldbooks" | "history" | "trash" | "settings") =>
    navigate(`/${base64Encode(props.project.worktree)}/session?view=tavern-${view}`)
  const menuActions = createMemo(() =>
    tavernProject()
      ? ([
          { key: "tavern-new-conversation", kind: "item", label: "新建酒馆对话", onSelect: () => openTavern("new") },
          { key: "tavern-characters", kind: "item", label: "角色管理", onSelect: () => openTavern("characters") },
          { key: "tavern-personas", kind: "item", label: "Persona 身份", onSelect: () => openTavern("personas") },
          { key: "tavern-groups", kind: "item", label: "群组管理", onSelect: () => openTavern("groups") },
          { key: "tavern-worldbooks", kind: "item", label: "世界书管理", onSelect: () => openTavern("worldbooks") },
          { key: "tavern-presets", kind: "item", label: "对话预设", onSelect: () => openTavern("presets") },
          { key: "tavern-history", kind: "item", label: "聊天历史", onSelect: () => openTavern("history") },
          { key: "tavern-trash", kind: "item", label: "回收站", onSelect: () => openTavern("trash") },
          { key: "tavern-settings", kind: "item", label: "酒馆设置", onSelect: () => openTavern("settings") },
        ] satisfies MenuAction[])
      : buildProjectMenuActions({
      t: language.t,
      pinned: pinned(),
      canOpenInExplorer: ctx.canOpenProjectPath(),
      canCreateScheduledAutomation: ctx.canCreateScheduledAutomation(props.project),
      canCreateTemporarySession: ctx.canCreateTemporarySession(),
      canCreateClaudeCodeSession: canCreateClaudeCodeSession(),
      workspacesLabel: workspacesEnabled()
        ? language.t("sidebar.workspaces.disable")
        : language.t("sidebar.workspaces.enable"),
      clearNotificationsLabel: language.t("sidebar.project.clearNotifications"),
      clearNotificationsDisabled: unseenCount() === 0,
      onTogglePinned: () => ctx.toggleProjectPinned(props.project),
      onOpenInExplorer: () => ctx.openProjectInExplorer(props.project),
      onCreateScheduledAutomation: () => ctx.createScheduledAutomation(props.project),
      onCreateTemporarySession: () => void ctx.createTemporarySession(props.project),
      onCreateClaudeCodeSession: () => void createClaudeCodeSession(),
      onRename: () => ctx.startProjectRename(props.project),
      onToggleWorkspaces: () => ctx.toggleProjectWorkspaces(props.project),
      onArchiveChats: () => void ctx.archiveProjectSessions(props.project),
      onClearNotifications: () => ctx.clearProjectNotifications(props.project),
          onRemove: () => void ctx.closeProject(props.project.worktree),
        }),
  )

  createEffect(() => {
    if (!isCurrentProject() && (!expanded() || !ctx.projectExpansionActivated(props.project.worktree))) return
    globalSync.child(props.project.worktree, { bootstrap: true })
  })

  const openNewSession = (event: MouseEvent) => {
    event.stopPropagation()
    ctx.sessionProps.onSelect?.()
    navigate(`/${base64Encode(props.project.worktree)}/session`)
  }

  const tile = () => (
    <ContextMenu>
      <ContextMenu.Trigger as="div" class="w-full">
        <DropdownMenu
          modal={!ctx.sidebarHovering()}
          placement="bottom-end"
          onOpenChange={(value) => {
            setState("menu", value)
          }}
        >
          <div
            data-component="sidebar-project-item"
            classList={{
              "group/project flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-3 transition-colors duration-[var(--motion-micro-ms)] ease-[var(--motion-ease-out)]": true,
              "bg-surface-raised-base-hover": state.menu,
              "hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover": !state.menu,
            }}
            role="button"
            tabIndex={0}
            aria-expanded={expanded()}
            onClick={() => ctx.toggleExpanded(props.project.worktree)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              ctx.toggleExpanded(props.project.worktree)
            }}
          >
            <div class="flex min-w-0 flex-1 items-center gap-2 text-left">
              <div
                classList={{
                  "flex size-5 shrink-0 items-center justify-center text-icon-weak": true,
                  "text-icon-strong": pinned(),
                }}
              >
                <Icon name={expanded() ? "folder-active" : "folder"} size="small" />
              </div>
              <div class="min-w-0 flex-1">
                <ctx.RenameTrigger
                  id={projectEditorID()}
                  value={projectName}
                  onSave={(next) => ctx.renameProject(props.project, next)}
                  class="truncate text-14-medium text-text-strong"
                  displayClass="block min-w-0 truncate text-14-medium text-text-strong"
                  stopPropagation={false}
                />
              </div>
              <Show when={unseenCount() > 0}>
                <div class="shrink-0 rounded-full bg-surface-warning-strong px-1.5 py-0.5 text-11-medium text-text-strong">
                  {unseenCount()}
                </div>
              </Show>
            </div>
            <div class="flex shrink-0 items-center gap-0.5">
              <IconButton
                icon="new-session"
                variant="ghost"
                size="small"
                class="size-7 rounded-md"
                aria-label={language.t("command.session.new")}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={openNewSession}
              />
              <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <DropdownMenu.Trigger
                  as={IconButton}
                  icon="dot-grid"
                  variant="ghost"
                  size="small"
                  class="size-7 rounded-md"
                  classList={{ "bg-surface-base-active": state.menu }}
                  data-action="project-sidebar-menu"
                  data-project={base64Encode(props.project.worktree)}
                  aria-label={language.t("common.moreOptions")}
                />
              </div>
            </div>
          </div>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <For each={menuActions()}>
                {(action) =>
                  action.kind === "separator" ? (
                    <DropdownMenu.Separator />
                  ) : (
                    <DropdownMenu.Item
                      data-action={
                        action.key === "clear-notifications"
                          ? "project-clear-notifications"
                          : action.key === "new-scheduled-automation"
                            ? "project-sidebar-new-automation"
                          : action.key === "new-temporary-session"
                            ? "project-sidebar-new-temporary-session"
                            : action.key === "new-claude-code-session"
                              ? "project-sidebar-new-claude-code-session"
                            : undefined
                      }
                      data-project={base64Encode(props.project.worktree)}
                      disabled={action.disabled}
                      onSelect={action.onSelect}
                    >
                      <DropdownMenu.ItemLabel>{action.label}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  )
                }
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <For each={menuActions()}>
            {(action) =>
              action.kind === "separator" ? (
                <ContextMenu.Separator />
              ) : (
                <ContextMenu.Item
                  data-action={
                    action.key === "clear-notifications"
                      ? "project-clear-notifications"
                      : action.key === "new-scheduled-automation"
                        ? "project-sidebar-new-automation"
                        : action.key === "new-temporary-session"
                          ? "project-sidebar-new-temporary-session"
                          : action.key === "new-claude-code-session"
                            ? "project-sidebar-new-claude-code-session"
                        : undefined
                  }
                  data-project={base64Encode(props.project.worktree)}
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                >
                  <ContextMenu.ItemLabel>{action.label}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              )
            }
          </For>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )

  return (
    <div class="flex flex-col gap-1">
      {tile()}
      <Show when={expanded()}>
        <div class="flex flex-col gap-1 pl-10">
          <Show when={loading()}>
            <SessionSkeleton />
          </Show>
          <Show when={!loading() && sessions().length === 0}>
            <div class="px-2 py-1 text-13-regular text-text-weak">No chats</div>
          </Show>
          <div class="flex flex-col gap-0.5">
            <For each={sessions()}>
              {(session) => (
                <SessionItem
                  {...ctx.sessionProps}
                  session={session}
                  list={sessions()}
                  directoryStore={projectStore()}
                  slug={base64Encode(session.directory)}
                  dense
                  showTooltip
                  mobile={props.mobile}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
