import { describe, expect, test } from "bun:test"
import { buildSessionMenuActions } from "./menu-actions"

describe("session context menu actions", () => {
  test("keeps session management actions in the context menu", () => {
    const selected: string[] = []
    const actions = buildSessionMenuActions({
      t: (key) => key,
      pinned: false,
      unread: false,
      canOpenInExplorer: true,
      canCopyDeeplink: true,
      onTogglePinned: () => selected.push("pin"),
      onRename: () => selected.push("rename"),
      onArchive: () => selected.push("archive"),
      onMarkUnread: () => selected.push("unread"),
      onOpenInExplorer: () => selected.push("explorer"),
      onCopyWorkingDirectory: () => selected.push("directory"),
      onCopySessionID: () => selected.push("id"),
      onCopyDeeplink: () => selected.push("deeplink"),
      onFork: () => selected.push("fork"),
      onDelete: () => selected.push("delete"),
    })

    expect(actions.filter((action) => action.kind === "item").map((action) => action.key)).toEqual([
      "pin",
      "rename",
      "archive",
      "mark-unread",
      "open-explorer",
      "copy-working-directory",
      "copy-session-id",
      "copy-deeplink",
      "fork",
      "delete",
    ])

    actions.filter((action) => action.kind === "item").forEach((action) => action.onSelect())
    expect(selected).toEqual([
      "pin",
      "rename",
      "archive",
      "unread",
      "explorer",
      "directory",
      "id",
      "deeplink",
      "fork",
      "delete",
    ])
  })
})
