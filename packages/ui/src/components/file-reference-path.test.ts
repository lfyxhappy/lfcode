import { describe, expect, test } from "bun:test"
import {
  getParentPath,
  getPlainTextPathMatch,
  inferFileReferenceKind,
  isAbsoluteFileReferencePath,
  isLocalFileHref,
  isPathLike,
  looksLikeCommand,
  resolveFileReferencePath,
  stripTrailingPathPunctuation,
} from "./file-reference-path"

describe("file-reference-path", () => {
  test("keeps normal local paths", () => {
    expect(isPathLike("C:\\repo\\src\\app.ts")).toBe(true)
    expect(isPathLike("./packages/app/src/index.tsx")).toBe(true)
    expect(isPathLike("../packages/app/src/index.tsx")).toBe(true)
    expect(isPathLike("packages/app/src/index.tsx")).toBe(true)
    expect(isPathLike("/usr/local/bin/node")).toBe(true)
    expect(isPathLike("/repo/README.md")).toBe(true)
  })

  test("recognizes both supported absolute path families", () => {
    expect(isAbsoluteFileReferencePath("C:\\repo\\src\\app.ts")).toBe(true)
    expect(isAbsoluteFileReferencePath("/workspace/src/app.ts")).toBe(true)
    expect(isAbsoluteFileReferencePath("src/app.ts")).toBe(false)
  })

  test("rejects short slash-heavy text", () => {
    expect(isPathLike("/n")).toBe(false)
    expect(isPathLike("1/2")).toBe(false)
    expect(isPathLike("2026/06/28")).toBe(false)
    expect(isPathLike("σ²/n")).toBe(false)
    expect(isPathLike("a/b")).toBe(false)
  })

  test("matches plain text paths only when structurally strong", () => {
    expect(getPlainTextPathMatch("see C:\\repo\\src\\app.ts, please")?.value).toBe("C:\\repo\\src\\app.ts")
    expect(getPlainTextPathMatch("link ./packages/app/src/index.tsx.")?.value).toBe("./packages/app/src/index.tsx")
    expect(getPlainTextPathMatch("path packages/app/src/index.tsx?")?.value).toBe("packages/app/src/index.tsx")
    expect(getPlainTextPathMatch("ratio 1/2")).toBeUndefined()
    expect(getPlainTextPathMatch("date 2026/06/28")).toBeUndefined()
    expect(getPlainTextPathMatch("math σ²/n")).toBeUndefined()
    expect(getPlainTextPathMatch("unix /tmp")).toBeUndefined()
  })

  test("preserves helper behavior", () => {
    expect(stripTrailingPathPunctuation("packages/app/src/index.tsx,")).toBe("packages/app/src/index.tsx")
    expect(looksLikeCommand("bun run test")).toBe(true)
    expect(isLocalFileHref("file:///C:/repo/src/app.ts")).toBe(true)
    expect(resolveFileReferencePath("packages/app/src/index.tsx", "C:\\repo")).toBe(
      "C:\\repo\\packages\\app\\src\\index.tsx",
    )
    expect(inferFileReferenceKind("packages/app/src/")).toBe("directory")
    expect(getParentPath("C:\\repo\\src\\app.ts")).toBe("C:\\repo\\src")
  })
})
