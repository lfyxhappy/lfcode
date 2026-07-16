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
    archiveProjectSessions: async () => {},
    clearProjectNotifications: () => {},
    canOpenProjectPath: () => true,
    editorOpen: () => false,
    InlineEditor: () => null,
    sessionProps: {
      navList: accessor([]),
      sidebarExpanded: accessor(true),
      sidebarHovering: accessor(false),
      clearHoverProjectSoon: () => {},
      prefetchSession: () => {},
      renameSession: async () => {},
      archiveSession: async () => {},
      showDeleteSessionDialog: () => {},
      editorOpen: () => false,
      openEditor: () => {},
      InlineEditor: () => null,
    },
  }
}

describe("resolveProjectSidebarCtx", () => {
  test("prefers explicit ctx", () => {
    const ctx = buildCtx()
    expect(
      resolveProjectSidebarCtx({
        project,
        sortNow: accessor(0),
        ctx,
      }),
    ).toBe(ctx)
  })

  test("rebuilds context from legacy flattened props", () => {
    const ctx = buildCtx()
    const resolved = resolveProjectSidebarCtx({
      project,
      sortNow: accessor(0),
      ...ctx,
    })

    expect(resolved.workspaceIds(project)).toEqual(["/demo"])
    expect(resolved.currentDir()).toBe("/demo")
    expect(resolved.currentSessionID()).toBe("ses_1")
  })
})
