import { describe, expect, test } from "bun:test"
import { desktopLanProjects, desktopLanSessions } from "./lan-project-visibility"

describe("LAN project visibility", () => {
  const projects = [
    { id: "prj_a", worktree: "C:\\work\\alpha", name: "Alpha", sandboxes: ["C:\\work\\alpha-sandbox"] },
    { id: "prj_b", worktree: "C:\\work\\beta", name: "Beta", sandboxes: [] },
  ]

  test("uses only the desktop open-project list and maps sandbox entries to their root", () => {
    const state = JSON.stringify({
      projects: {
        local: [
          { worktree: "C:\\work\\alpha-sandbox", expanded: false },
          { worktree: "C:\\work\\alpha", expanded: true },
          { worktree: "/", expanded: true },
          { worktree: "C:\\work\\missing", expanded: true },
        ],
      },
    })

    expect(desktopLanProjects(projects, state).map((project) => project.id)).toEqual(["prj_a"])
  })

  test("fails closed when the desktop open-project state is missing or invalid", () => {
    expect(desktopLanProjects(projects, undefined)).toEqual([])
    expect(desktopLanProjects(projects, "not json")).toEqual([])
    expect(desktopLanProjects(projects, { projects: { local: [] } })).toEqual([])
  })

  test("keeps only active root sessions in the desktop project directory", () => {
    const sessions = [
      { id: "ses_active", directory: "C:\\work\\alpha", time: { created: 1 } },
      { id: "ses_archived", directory: "C:\\work\\alpha", time: { created: 2, archived: 3 } },
      { id: "ses_child", directory: "C:\\work\\alpha", parentID: "ses_active", time: { created: 3 } },
      { id: "ses_context", directory: "C:\\work\\alpha", contextFrom: "ses_active", time: { created: 4 } },
      { id: "ses_other", directory: "C:\\work\\beta", time: { created: 5 } },
    ]

    expect(desktopLanSessions(sessions, "C:\\work\\alpha").map((session) => (session as { id: string }).id)).toEqual(["ses_active"])
  })
})
