import { describe, expect, test } from "bun:test"
import type { Accessor } from "solid-js"
import type { LocalProject } from "@/context/layout"
import { resolveProjectSidebarCtx, type ProjectSidebarContext } from "./sidebar-project-context"

const project = {
  worktree: "/demo",
  expanded: true,
} as LocalProject

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

function buildCtx(): ProjectSidebarContext {
  return {
    currentDir: accessor("/demo"),
    currentSessionID: accessor("ses_1"),
    currentProject: accessor(project),
    sidebarOpened: accessor(true),
    sidebarHovering: accessor(false),
    navigateToProject: () => {},
    openSidebar: () => {},
    toggleExpanded: () => {},
    isExpanded: () => true,
    projectExpansionActivated: () => false,
    setExpanded: () => {},
    isProjectPinned: () => false,
    toggleProjectPinned: () => {},
    closeProject: () => {},
    startProjectRename: () => {},
    toggleProjectWorkspaces: () => {},
    workspacesEnabled: () => true,
    workspaceIds: () => ["/demo"],
    workspaceLabel: (directory) => directory,
    projectEditorID: () => "project:/demo",
    renameProject: async () => {},
    openProjectInExplorer: () => {},
    canCreateScheduledAutomation: () => true,
    createScheduledAutomation: () => {},
    canCreateTemporarySession: () => true,
    createTemporarySession: async () => {},
    archiveProjectSessions: async () => {},
    clearProjectNotifications: () => {},
    canOpenProjectPath: () => true,
    RenameTrigger: () => null,
    sessionProps: {
      navList: accessor([]),
      sidebarExpanded: accessor(true),
      sidebarHovering: accessor(false),
      clearHoverProjectSoon: () => {},
      prefetchSession: () => {},
      renameSession: async () => {},
      archiveSession: async () => {},
      showDeleteSessionDialog: () => {},
      openEditor: () => {},
      RenameTrigger: () => null,
    },
  }
}

describe("resolveProjectSidebarCtx", () => {
  test("prefers explicit ctx", () => {
    const ctx = buildCtx()
    expect(
      resolveProjectSidebarCtx({
        project,
        ctx,
      }),
    ).toBe(ctx)
  })

  test("rebuilds context from legacy flattened props", () => {
    const ctx = buildCtx()
    const resolved = resolveProjectSidebarCtx({
      project,
      ...ctx,
    })

    expect(resolved.workspaceIds(project)).toEqual(["/demo"])
    expect(resolved.currentDir()).toBe("/demo")
    expect(resolved.currentSessionID()).toBe("ses_1")
  })

  test("preserves the session selection callback", () => {
    let selected = false
    const ctx = buildCtx()
    ctx.sessionProps.onSelect = () => {
      selected = true
    }

    const resolved = resolveProjectSidebarCtx({
      project,
      ...ctx,
    })

    resolved.sessionProps.onSelect?.()
    expect(selected).toBe(true)
  })
})
