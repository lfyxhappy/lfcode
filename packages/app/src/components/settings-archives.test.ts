import { describe, expect, test } from "bun:test"
import { archivedSessions, removeSession, sessionProjectLabel } from "./settings-archives-helpers"
import type { GlobalSession } from "@lfcode-ai/sdk/v2/client"

const session = (input: {
  id: string
  archived?: number
  title?: string
  project?: GlobalSession["project"]
}): GlobalSession => ({
  id: input.id,
  slug: input.id,
  projectID: "proj",
  directory: "C:/repo",
  title: input.title ?? input.id,
  version: "test",
  time: {
    created: 1,
    updated: 2,
    archived: input.archived,
  },
  project: input.project ?? null,
})

describe("settings archives helpers", () => {
  test("keeps only archived sessions", () => {
    expect(archivedSessions([session({ id: "active" }), session({ id: "archived", archived: 3 })]).map((x) => x.id)).toEqual([
      "archived",
    ])
  })

  test("removes a session after restore or delete", () => {
    expect(removeSession([session({ id: "a" }), session({ id: "b" })], "a").map((x) => x.id)).toEqual(["b"])
  })

  test("uses project name before worktree and directory", () => {
    expect(sessionProjectLabel(session({ id: "named", project: { id: "p", name: "Named", worktree: "C:/work" } }))).toBe(
      "Named",
    )
    expect(sessionProjectLabel(session({ id: "worktree", project: { id: "p", worktree: "C:/work" } }))).toBe("C:/work")
    expect(sessionProjectLabel(session({ id: "directory", project: null }))).toBe("C:/repo")
  })
})
