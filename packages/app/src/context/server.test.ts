import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "./server"
import { normalizeServerStore, normalizeServerUrl } from "./server"

describe("normalizeServerUrl", () => {
  test("trims protocol and trailing slash", () => {
    expect(normalizeServerUrl(" https://example.com/ ")).toBe("https://example.com")
  })
})

describe("normalizeServerStore", () => {
  test("removes the retired ImageMaker workspace from persisted sidebar state", () => {
    expect(
      normalizeServerStore({
        projects: {
          local: [
            { worktree: "C:\\Users\\liangfeng\\.lfcodepre\\plugins\\lfcode-imagemaker\\data\\projects\\imagemaker", expanded: true },
            { worktree: "C:\\work\\project", expanded: false },
          ],
        },
        lastProject: { local: "C:\\Users\\liangfeng\\.lfcodepre\\plugins\\lfcode-imagemaker\\data\\projects\\imagemaker" },
      }),
    ).toEqual({
      projects: { local: [{ worktree: "C:/work/project", expanded: false }] },
      lastProject: {},
    })
  })
})
