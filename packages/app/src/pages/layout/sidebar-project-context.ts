import type { Accessor } from "solid-js"
import type { LocalProject } from "@/context/layout"
import type { RenameTriggerComponent } from "./inline-editor"
import type { SessionItemProps } from "./sidebar-items"

export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  currentSessionID: Accessor<string | undefined>
  currentProject: Accessor<LocalProject | undefined>
  sidebarOpened: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  navigateToProject: (directory: string) => void
  openSidebar: () => void
  toggleExpanded: (directory: string) => void
  isExpanded: (directory: string) => boolean
  projectExpansionActivated: (directory: string) => boolean
  setExpanded: (directory: string, value: boolean) => void
  isProjectPinned: (project: LocalProject) => boolean
  toggleProjectPinned: (project: LocalProject) => void
  closeProject: (directory: string) => void
  startProjectRename: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  projectEditorID: (project: LocalProject) => string
  renameProject: (project: LocalProject, next: string) => Promise<void>
  openProjectInExplorer: (project: LocalProject) => void
  canCreateScheduledAutomation: (project: LocalProject) => boolean
  createScheduledAutomation: (project: LocalProject) => void
  canCreateTemporarySession: () => boolean
  createTemporarySession: (project: LocalProject) => Promise<void>
  archiveProjectSessions: (project: LocalProject) => Promise<void>
  clearProjectNotifications: (project: LocalProject) => void
  canOpenProjectPath: () => boolean
  RenameTrigger: RenameTriggerComponent
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense">
}

export type ProjectSectionProps = {
  project: LocalProject
  mobile?: boolean
  ctx?: ProjectSidebarContext
} & Partial<ProjectSidebarContext>

export function resolveProjectSidebarCtx(props: ProjectSectionProps): ProjectSidebarContext {
  if (props.ctx) return props.ctx
  if (
    props.currentDir &&
    props.currentSessionID &&
    props.currentProject &&
    props.sidebarOpened &&
    props.sidebarHovering &&
    props.navigateToProject &&
    props.openSidebar &&
    props.toggleExpanded &&
    props.isExpanded &&
    props.projectExpansionActivated &&
    props.setExpanded &&
    props.isProjectPinned &&
    props.toggleProjectPinned &&
    props.closeProject &&
    props.startProjectRename &&
    props.toggleProjectWorkspaces &&
    props.workspacesEnabled &&
    props.workspaceIds &&
    props.workspaceLabel &&
    props.projectEditorID &&
    props.renameProject &&
    props.openProjectInExplorer &&
    props.canCreateScheduledAutomation &&
    props.createScheduledAutomation &&
    props.canCreateTemporarySession &&
    props.createTemporarySession &&
    props.archiveProjectSessions &&
    props.clearProjectNotifications &&
    props.canOpenProjectPath &&
    props.RenameTrigger &&
    props.sessionProps
  ) {
    return {
      currentDir: props.currentDir,
      currentSessionID: props.currentSessionID,
      currentProject: props.currentProject,
      sidebarOpened: props.sidebarOpened,
      sidebarHovering: props.sidebarHovering,
      navigateToProject: props.navigateToProject,
      openSidebar: props.openSidebar,
      toggleExpanded: props.toggleExpanded,
      isExpanded: props.isExpanded,
      projectExpansionActivated: props.projectExpansionActivated,
      setExpanded: props.setExpanded,
      isProjectPinned: props.isProjectPinned,
      toggleProjectPinned: props.toggleProjectPinned,
      closeProject: props.closeProject,
      startProjectRename: props.startProjectRename,
      toggleProjectWorkspaces: props.toggleProjectWorkspaces,
      workspacesEnabled: props.workspacesEnabled,
      workspaceIds: props.workspaceIds,
      workspaceLabel: props.workspaceLabel,
      projectEditorID: props.projectEditorID,
      renameProject: props.renameProject,
      openProjectInExplorer: props.openProjectInExplorer,
      canCreateScheduledAutomation: props.canCreateScheduledAutomation,
      createScheduledAutomation: props.createScheduledAutomation,
      canCreateTemporarySession: props.canCreateTemporarySession,
      createTemporarySession: props.createTemporarySession,
      archiveProjectSessions: props.archiveProjectSessions,
      clearProjectNotifications: props.clearProjectNotifications,
      canOpenProjectPath: props.canOpenProjectPath,
      RenameTrigger: props.RenameTrigger,
      sessionProps: props.sessionProps,
    }
  }
  throw new Error("ProjectSection requires a sidebar context")
}
