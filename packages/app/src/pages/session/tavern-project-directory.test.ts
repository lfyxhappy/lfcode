import { describe, expect, test } from "bun:test"
import { isTavernManagedDirectory } from "./tavern-project-directory"

describe("isTavernManagedDirectory", () => {
  test("recognizes the Tavern plugin private managed worktree", () => {
    expect(isTavernManagedDirectory("C:\\Users\\name\\.lfcodepre\\plugins\\lfcode-tavern\\data\\projects\\tavern")).toBe(true)
  })

  test("does not match a Tavern plugin source directory or an ordinary project", () => {
    expect(isTavernManagedDirectory("C:\\Users\\name\\.lfcodepre\\plugins\\lfcode-tavern")).toBe(false)
    expect(isTavernManagedDirectory("C:\\work\\tavern")).toBe(false)
  })
})
