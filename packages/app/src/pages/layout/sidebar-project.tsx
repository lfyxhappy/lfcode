import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
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
import { SessionItem, type SessionItemProps } from "./sidebar-items"
import { displayName, sortedRootSessions, workspaceKey } from "./helpers"
import { resolveProjectSidebarCtx, type ProjectSectionProps, type ProjectSidebarContext } from "./sidebar-project-context"
import { SessionSkeleton } from "./sidebar-items"
import { buildProjectMenuActions } from "./menu-actions"

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
  const ctx = resolveProjectSidebarCtx(props)
  const [state, setState] = createStore({
    menu: false,
  })
  const workspaces = createMemo(() => ctx.workspaceIds(props.project))
  const expanded = createMemo(() => ctx.isExpanded(props.project.worktree))
  const selected = createMemo(() => ctx.currentProject()?.worktree === props.project.worktree)
  const projectStore = createMemo(() => globalSync.child(props.project.worktree, { bootstrap: false })[0])
  const projectSessions = createMemo(() =>
    sortedRootSessions(projectStore(), props.sortNow(), {
      pinned: (session) => layout.sessions.isPinned(session.directory, session.id),
      pinStamp: layout.sessions.stamp(),
    }),
  )
  const loading = createMemo(() => projectStore().status !== "complete" && projectSessions().length === 0)
  const projectName = createMemo(() => displayName(props.project))
  const projectEditorID = createMemo(() => ctx.projectEditorID(props.project))
  const editing = createMemo(() => ctx.editorOpen(projectEditorID()))
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
  const menuActions = createMemo(() =>
    buildProjectMenuActions({
      t: language.t,
      pinned: pinned(),
      canOpenInExplorer: ctx.canOpenProjectPath(),
      workspacesLabel: workspacesEnabled()
        ? language.t("sidebar.workspaces.disable")
        : language.t("sidebar.workspaces.enable"),
      clearNotificationsLabel: language.t("sidebar.project.clearNotifications"),
      clearNotificationsDisabled: unseenCount() === 0,
      onTogglePinned: () => ctx.toggleProjectPinned(props.project),
      onOpenInExplorer: () => ctx.openProjectInExplorer(props.project),
      onRename: () => ctx.startProjectRename(props.project),
      onToggleWorkspaces: () => ctx.toggleProjectWorkspaces(props.project),
      onArchiveChats: () => void ctx.archiveProjectSessions(props.project),
      onClearNotifications: () => ctx.clearProjectNotifications(props.project),
      onRemove: () => void ctx.closeProject(props.project.worktree),
    }),
  )

  createEffect(() => {
    if (!expanded() && !selected()) return
    globalSync.child(props.project.worktree, { bootstrap: true })
  })

  const openNewSession = (event: MouseEvent) => {
    event.stopPropagation()
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
              "group/project flex w-full min-w-0 items-center gap-1.5 rounded-xl px-2 py-1.5 transition-colors duration-[var(--motion-micro-ms)] ease-[var(--motion-ease-out)]": true,
              "bg-surface-base-active shadow-xs-border-base": selected() || expanded(),
              "hover:bg-surface-raised-base-hover": !selected() && !expanded(),
            }}
            role="button"
            tabIndex={0}
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
                  "flex size-6 shrink-0 items-center justify-center rounded-lg text-icon-weak": true,
                  "bg-surface-warning-strong/15 text-icon-strong": pinned(),
                  "bg-surface-raised-base": !pinned(),
                }}
              >
                <Icon name="folder" size="small" />
              </div>
              <div class="min-w-0 flex-1">
                <ctx.InlineEditor
                  id={projectEditorID()}
                  value={projectName}
                  onSave={(next) => void ctx.renameProject(props.project, next)}
                  class="truncate text-14-medium text-text-strong"
                  displayClass="truncate text-14-medium text-text-strong"
                  editing={editing()}
                  stopPropagation
                />
              </div>
              <Show when={unseenCount() > 0}>
                <div class="shrink-0 rounded-full bg-surface-warning-strong px-1.5 py-0.5 text-11-medium text-text-strong">
                  {unseenCount()}
                </div>
              </Show>
              <Icon name={expanded() ? "chevron-down" : "arrow-right"} size="small" class="shrink-0 text-icon-base" />
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
                      data-action={action.key === "clear-notifications" ? "project-clear-notifications" : undefined}
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
                  data-action={action.key === "clear-notifications" ? "project-clear-notifications" : undefined}
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
        <div class="flex flex-col gap-1 pl-4">
          <Show when={activeSandboxSession()}>
            {(session) => (
              <div class="rounded-md px-2 py-1 text-12-regular text-text-weak">
                active sandbox chat: {session().title || session().id}
              </div>
            )}
          </Show>
          <Show when={loading()}>
            <SessionSkeleton />
          </Show>
          <Show when={!loading() && sessions().length === 0}>
            <div class="px-2 py-1 text-12-regular text-text-weak">No chats</div>
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
