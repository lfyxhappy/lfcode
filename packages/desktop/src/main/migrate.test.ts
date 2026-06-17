import { describe, expect, test } from "bun:test"
import { mergeLegacyStoreValue, renameLegacyStore } from "./legacy-store"

describe("legacy electron store migration", () => {
  test("renames legacy store files into lfcode stores", () => {
    expect(renameLegacyStore("opencode.global.dat")).toBe("lfcode.global.dat")
    expect(renameLegacyStore("mimocode.workspace.foo.dat")).toBe("lfcode.workspace.foo.dat")
    expect(renameLegacyStore("lfcode.global.dat")).toBeUndefined()
  })

  test("merges server project lists by worktree", () => {
    const current = JSON.stringify({
      list: [],
      projects: {
        local: [{ worktree: "C:\\new", expanded: true }],
      },
      lastProject: { local: "C:\\new" },
    })
    const legacy = JSON.stringify({
      list: [],
      projects: {
        local: [
          { worktree: "C:\\old", expanded: true },
          { worktree: "C:\\new", expanded: false },
        ],
      },
      lastProject: { local: "C:\\old" },
    })

    expect(JSON.parse(mergeLegacyStoreValue("server", current, legacy) as string)).toEqual({
      list: [],
      projects: {
        local: [
          { worktree: "C:/old", expanded: true },
          { worktree: "C:/new", expanded: true },
        ],
      },
      lastProject: { local: "C:\\new" },
    })
  })

  test("merges server project lists across slash variants", () => {
    const current = JSON.stringify({
      list: [],
      projects: {
        local: [{ worktree: "C:/demo", expanded: true }],
      },
      lastProject: { local: "C:/demo" },
    })
    const legacy = JSON.stringify({
      list: [],
      projects: {
        local: [{ worktree: "C:\\demo", expanded: false }],
      },
      lastProject: { local: "C:\\demo" },
    })

    expect(JSON.parse(mergeLegacyStoreValue("server", current, legacy) as string)).toEqual({
      list: [],
      projects: {
        local: [{ worktree: "C:/demo", expanded: true }],
      },
      lastProject: { local: "C:/demo" },
    })
  })

  test("fills missing layout state without overwriting current values", () => {
    const current = JSON.stringify({
      sidebar: { opened: false, width: 344 },
      sessionTabs: {},
      sessionView: {},
    })
    const legacy = JSON.stringify({
      sidebar: { opened: true, width: 300 },
      sessionTabs: {
        abc: { active: "context", all: ["context"] },
      },
      sessionView: {
        abc: { scroll: { context: { x: 0, y: 10 } } },
      },
    })

    expect(JSON.parse(mergeLegacyStoreValue("layout", current, legacy) as string)).toEqual({
      sidebar: { opened: false, width: 344 },
      sessionTabs: {
        abc: { active: "context", all: ["context"] },
      },
      sessionView: {
        abc: { scroll: { context: { x: 0, y: 10 } } },
      },
    })
  })

  test("keeps current values for non-merged keys", () => {
    expect(mergeLegacyStoreValue("notification", "current", "legacy")).toBe("current")
    expect(mergeLegacyStoreValue("model", undefined, "legacy")).toBe("legacy")
  })
})
