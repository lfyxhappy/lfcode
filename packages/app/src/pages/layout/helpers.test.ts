import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@lfcode-ai/sdk/v2/client"
import {
  childSessionOnPath,
  descendantSessionIDs,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  isSidebarSessionSelected,
  latestRootSession,
  orderedWorkspaceDirs,
  projectActivityTime,
  projectRootForDirectory,
  sortedProjects,
  sidebarSessionRemovalTarget,
  sortedRootSessions,
  storedWorkspaceName,
  storedWorkspaceLabel,
  startupProjectRoot,
  visibleWorkspaceSessionDirs,
  workspaceKey,
} from "./helpers"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("lfcode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("lfcode://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("lfcode://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("lfcode://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("lfcode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("lfcode://open-project")).toBeUndefined()
    expect(parseDeepLink("lfcode://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "lfcode://open-project?directory=/a",
      "lfcode://other?directory=/b",
      "lfcode://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("lfcode://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("lfcode://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("lfcode://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("lfcode://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "lfcode://new-session?directory=/a",
      "lfcode://open-project?directory=/b",
      "lfcode://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __LFCODE__: {
        deepLinks: ["lfcode://open-project?directory=/a"],
      },
    } as unknown as Window & { __LFCODE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["lfcode://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(workspaceKey("/tmp/demo///")).toBe("/tmp/demo")
    expect(workspaceKey("C:\\tmp\\demo\\\\")).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(workspaceKey("/")).toBe("/")
    expect(workspaceKey("///")).toBe("/")
    expect(workspaceKey("C:\\")).toBe("C:/")
    expect(workspaceKey("C://")).toBe("C:/")
    expect(workspaceKey("C:///")).toBe("C:/")
  })

  test("keeps local first while preserving known order", () => {
    const result = effectiveWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("reads stored workspace names from normalized and branch fallbacks", () => {
    const store = {
      workspaceName: { "/root/feature": "Feature A" },
      workspaceBranchName: { project: { feature: "Feature Branch" } },
    }

    expect(storedWorkspaceName(store, "/root/feature/", "project", "feature")).toBe("Feature A")
    expect(storedWorkspaceName({ workspaceName: {}, workspaceBranchName: store.workspaceBranchName }, "/x", "project", "feature")).toBe(
      "Feature Branch",
    )
  })

  test("formats workspace labels with stored name, branch, and filename fallback", () => {
    const store = { workspaceName: {}, workspaceBranchName: {} }
    expect(storedWorkspaceLabel(store, "/tmp/app", "feat/test")).toBe("feat/test")
    expect(storedWorkspaceLabel(store, "/tmp/app")).toBe("app")
  })

  test("orders workspace dirs and inserts active pending extras near root", () => {
    const project = { worktree: "/root", sandboxes: ["/b", "/c"] }
    const result = orderedWorkspaceDirs({
      project,
      activeProjectWorktree: "/root",
      currentDir: "/pending",
      persisted: ["/root", "/c", "/b"],
      isPending: (directory) => directory === "/pending",
    })

    expect(result).toEqual(["/root", "/pending", "/c", "/b"])
  })

  test("keeps non-pending active extra workspace at the end", () => {
    const result = orderedWorkspaceDirs({
      project: { worktree: "/root", sandboxes: ["/b"] },
      activeProjectWorktree: "/root",
      currentDir: "/detached",
      persisted: ["/root", "/b"],
    })

    expect(result).toEqual(["/root", "/b", "/detached"])
  })

  test("filters visible workspace session dirs by expansion and active directory", () => {
    const result = visibleWorkspaceSessionDirs({
      project: { worktree: "/root" },
      workspacesEnabled: true,
      currentDir: "/b",
      orderedDirs: ["/root", "/b", "/c"],
      expanded: { "/c": true },
    })

    expect(result).toEqual(["/root", "/b", "/c"])
  })

  test("falls back to project root when workspace mode is disabled", () => {
    expect(
      visibleWorkspaceSessionDirs({
        project: { worktree: "/root" },
        workspacesEnabled: false,
        currentDir: "/b",
        orderedDirs: ["/root", "/b"],
        expanded: {},
      }),
    ).toEqual(["/root"])
  })

  test("resolves project root from live projects, persisted order, and project metadata", () => {
    expect(
      projectRootForDirectory({
        directory: "/root/sandbox",
        projects: [{ id: "p1", worktree: "/root", sandboxes: ["/root/sandbox"] }],
        workspaceOrder: {},
        projectMeta: [],
      }),
    ).toBe("/root")

    expect(
      projectRootForDirectory({
        directory: "/known",
        projects: [],
        workspaceOrder: { "/root": ["/known"] },
        projectMeta: [],
      }),
    ).toBe("/root")

    expect(
      projectRootForDirectory({
        directory: "/meta-child",
        projects: [],
        workspaceOrder: {},
        childProjectID: "p2",
        projectMeta: [{ id: "p2", worktree: "/meta-root" }],
      }),
    ).toBe("/meta-root")
  })

  test("falls back to original directory when no project root mapping exists", () => {
    expect(
      projectRootForDirectory({
        directory: "/orphan",
        projects: [],
        workspaceOrder: {},
        projectMeta: [],
      }),
    ).toBe("/orphan")
  })

  test("chooses the next sidebar route after session removal", () => {
    expect(
      sidebarSessionRemovalTarget({
        session: session({ id: "child", directory: "/root", parentID: "parent" }),
        removed: new Set(["child"]),
        activeID: "child",
      }),
    ).toEqual({ directory: "/root", sessionID: "parent" })

    expect(
      sidebarSessionRemovalTarget({
        session: session({ id: "root", directory: "/root" }),
        removed: new Set(["root"]),
        activeID: "root",
        nextRootSessionID: "next",
      }),
    ).toEqual({ directory: "/root", sessionID: "next" })

    expect(
      sidebarSessionRemovalTarget({
        session: session({ id: "root", directory: "/root" }),
        removed: new Set(["root"]),
        activeID: "root",
      }),
    ).toEqual({ directory: "/root" })
  })

  test("finds the latest root session across workspaces", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 1, archived: undefined } })],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("prefers the latest real user activity over generic session updates", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [
            session({
              id: "updated-only",
              directory: "/root",
              time: { created: 1, updated: 50, lastUser: 10, archived: undefined },
            }),
            session({
              id: "latest-user",
              directory: "/root",
              time: { created: 2, updated: 20, lastUser: 40, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("latest-user")
  })

  test("reuses cached root-session sort results between timer ticks", () => {
    const store = {
      path: { directory: "/root" },
      session: [
        session({
          id: "newer",
          directory: "/root",
          time: { created: 30, updated: 30, archived: undefined },
        }),
        session({
          id: "older",
          directory: "/root",
          time: { created: 10, updated: 10, archived: undefined },
        }),
      ],
    }

    const first = sortedRootSessions(store, 30_000)
    const second = sortedRootSessions(store, 120_000)

    expect(second).toBe(first)
    expect(second.map((item: Session) => item.id)).toEqual(["newer", "older"])
  })

  test("invalidates cached root-session ordering when session activity changes", () => {
    const store = {
      path: { directory: "/root" },
      session: [
        session({
          id: "first",
          directory: "/root",
          time: { created: 10, updated: 10, archived: undefined },
        }),
        session({
          id: "second",
          directory: "/root",
          time: { created: 20, updated: 20, archived: undefined },
        }),
      ],
    }

    const before = sortedRootSessions(store, 120_000)
    store.session[0] = session({
      id: "first",
      directory: "/root",
      time: { created: 10, updated: 40, lastUser: 40, archived: undefined },
    })
    const after = sortedRootSessions(store, 120_000)

    expect(after).not.toBe(before)
    expect(after.map((item: Session) => item.id)).toEqual(["first", "second"])
  })

  test("sorts pinned root sessions ahead of activity ordering", () => {
    const store = {
      path: { directory: "/root" },
      session: [
        session({
          id: "older-pinned",
          directory: "/root",
          time: { created: 10, updated: 10, archived: undefined },
        }),
        session({
          id: "newer",
          directory: "/root",
          time: { created: 30, updated: 30, archived: undefined },
        }),
      ],
    }

    const result = sortedRootSessions(store, 120_000, {
      pinned: (item) => item.id === "older-pinned",
      pinStamp: "older-pinned",
    })

    expect(result.map((item: Session) => item.id)).toEqual(["older-pinned", "newer"])
  })

  test("prefers the last project at startup when it is still listed", () => {
    expect(startupProjectRoot("/last", [{ worktree: "/current" }, { worktree: "/last" }])).toBe("/last")
  })

  test("falls back to the first project when the last project is stale", () => {
    expect(startupProjectRoot("/last", [{ worktree: "/current" }])).toBe("/current")
  })

  test("falls back to the first project when there is no last project", () => {
    expect(startupProjectRoot(undefined, [{ worktree: "/current" }, { worktree: "/other" }])).toBe("/current")
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }, { id: "perm-hidden" }],
        child: [{ id: "perm-child" }],
      },
      (item) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }],
      },
      () => false,
    )

    expect(result).toBe(false)
  })

  test("ignores archived and child sessions when finding latest root session", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: 10 },
            }),
            session({
              id: "child",
              directory: "/workspace",
              parentID: "parent",
              time: { created: 20, updated: 20, archived: undefined },
            }),
            session({
              id: "side-chat",
              directory: "/workspace",
              contextFrom: "root",
              time: { created: 40, updated: 40, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/workspace",
              time: { created: 30, updated: 30, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("finds the direct child on the active session path", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
    ]

    expect(childSessionOnPath(list, "root", "leaf")?.id).toBe("child")
    expect(childSessionOnPath(list, "child", "leaf")?.id).toBe("leaf")
    expect(childSessionOnPath(list, "root", "root")).toBeUndefined()
    expect(childSessionOnPath(list, "root", "other")).toBeUndefined()
  })

  test("does not expose side-chat context sessions as sidebar children", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "side", directory: "/workspace", parentID: "root", contextFrom: "root" }),
    ]

    expect(childSessionOnPath(list, "root", "side")).toBeUndefined()
  })

  test("collects descendant ids for sidebar session removal", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
      session({ id: "sibling", directory: "/workspace", parentID: "other" }),
    ]

    expect(Array.from(descendantSessionIDs(list, "root")).sort()).toEqual(["child", "leaf", "root"])
  })

  test("matches sidebar selected state by exact session id only", () => {
    expect(isSidebarSessionSelected("root", "root")).toBe(true)
    expect(isSidebarSessionSelected("root", "child")).toBe(false)
    expect(isSidebarSessionSelected("root")).toBe(false)
  })

  test("ignores sidebar removal routing when active session is unaffected", () => {
    expect(
      sidebarSessionRemovalTarget({
        session: session({ id: "root", directory: "/root" }),
        removed: new Set(["root"]),
        activeID: "other",
      }),
    ).toBeUndefined()
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
  })

  test("falls back safely when project metadata has no activity time", () => {
    expect(projectActivityTime({})).toBe(0)
    expect(projectActivityTime({ time: { created: 10, lastUser: 20 } })).toBe(20)
  })

  test("sorts projects by real user activity", () => {
    const result = sortedProjects([
      { worktree: "/old", time: { created: 10, lastUser: 15 } },
      { worktree: "/updated", time: { created: 20, lastUser: 12 } },
      { worktree: "/fresh", time: { created: 30, lastUser: 40 } },
    ])

    expect(result.map((item) => item.worktree)).toEqual(["/fresh", "/old", "/updated"])
  })

  test("sorts pinned projects ahead of activity ordering", () => {
    const result = sortedProjects(
      [
        { worktree: "/old", time: { created: 10, lastUser: 15 } },
        { worktree: "/fresh", time: { created: 30, lastUser: 40 } },
      ],
      {
        pinned: (item) => item.worktree === "/old",
      },
    )

    expect(result.map((item) => item.worktree)).toEqual(["/old", "/fresh"])
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
