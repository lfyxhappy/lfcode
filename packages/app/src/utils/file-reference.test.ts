import { describe, expect, test } from "bun:test"
import {
  getParentPath,
  inferFileReferenceKind,
  isLocalFileHref,
  isPathLike,
  looksLikeCommand,
  resolveFileReferencePath,
  stripTrailingPathPunctuation,
} from "./file-reference"

describe("file-reference", () => {
  test("recognizes local hrefs and excludes web urls", () => {
    expect(isLocalFileHref("C:\\repo\\src\\app.ts")).toBe(true)
    expect(isLocalFileHref("./packages/app/src/index.tsx")).toBe(true)
    expect(isLocalFileHref("https://example.com/app.ts")).toBe(false)
  })

  test("recognizes path-like text", () => {
    expect(isPathLike("packages/app/src/index.tsx")).toBe(true)
    expect(isPathLike("C:\\repo\\src\\app.ts")).toBe(true)
    expect(isPathLike("bun run test")).toBe(false)
  })

  test("strips trailing punctuation", () => {
    expect(stripTrailingPathPunctuation("packages/app/src/index.tsx,")).toBe("packages/app/src/index.tsx")
    expect(stripTrailingPathPunctuation("C:\\repo\\src\\app.ts)")).toBe("C:\\repo\\src\\app.ts")
  })

  test("does not treat commands as paths", () => {
    expect(looksLikeCommand("bun run test")).toBe(true)
    expect(looksLikeCommand("git diff")).toBe(true)
    expect(looksLikeCommand("./packages/app/src/index.tsx")).toBe(false)
  })

  test("resolves relative paths against session project root", () => {
    expect(resolveFileReferencePath("./packages/app/src/index.tsx", "C:\\repo")).toBe(
      "C:\\repo\\packages\\app\\src\\index.tsx",
    )
    expect(resolveFileReferencePath("packages/app/src/index.tsx", "C:\\repo")).toBe(
      "C:\\repo\\packages\\app\\src\\index.tsx",
    )
  })

  test("preserves absolute paths", () => {
    expect(resolveFileReferencePath("C:\\repo\\src\\app.ts")).toBe("C:\\repo\\src\\app.ts")
  })

  test("returns undefined for unresolved relative path without base dir", () => {
    expect(resolveFileReferencePath("./packages/app/src/index.tsx")).toBeUndefined()
  })

  test("infers file and parent folder", () => {
    expect(inferFileReferenceKind("packages/app/src/index.tsx")).toBe("file")
    expect(inferFileReferenceKind("packages/app/src/")).toBe("directory")
    expect(getParentPath("C:\\repo\\src\\app.ts")).toBe("C:\\repo\\src")
  })
})
