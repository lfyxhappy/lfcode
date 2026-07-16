import type { Accessor } from "solid-js"
import type { LocalProject } from "@/context/layout"
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
  archiveProjectSessions: (project: LocalProject) => Promise<void>
  clearProjectNotifications: (project: LocalProject) => void
  canOpenProjectPath: () => boolean
  editorOpen: (id: string) => boolean
  InlineEditor: SessionItemProps["InlineEditor"]
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense">
}

export type ProjectSectionProps = {
  project: LocalProject
  mobile?: boolean
  sortNow: Accessor<number>
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
    props.archiveProjectSessions &&
    props.clearProjectNotifications &&
    props.canOpenProjectPath &&
    props.editorOpen &&
    props.InlineEditor &&
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
      archiveProjectSessions: props.archiveProjectSessions,
      clearProjectNotifications: props.clearProjectNotifications,
      canOpenProjectPath: props.canOpenProjectPath,
      editorOpen: props.editorOpen,
      InlineEditor: props.InlineEditor,
      sessionProps: props.sessionProps,
    }
  }
  throw new Error("ProjectSection requires a sidebar context")
}
