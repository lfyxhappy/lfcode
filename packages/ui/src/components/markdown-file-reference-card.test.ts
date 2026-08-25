import { describe, expect, test } from "bun:test"
import { getFileReferenceCategory, isCardableFileReference } from "./markdown-file-reference-card"

describe("markdown file-reference cards", () => {
  test("only admits existing absolute files and directories", () => {
    expect(isCardableFileReference("C:\\Downloads\\build.zip", { exists: true, kind: "file" })).toBe(true)
    expect(isCardableFileReference("C:\\Downloads", { exists: true, kind: "directory" })).toBe(true)
    expect(isCardableFileReference("C:\\Downloads\\missing.zip", { exists: false, kind: "unknown" })).toBe(false)
    expect(isCardableFileReference("packages/app/src/index.tsx", { exists: true, kind: "file" })).toBe(false)
  })

  test("selects a stable background category from the real reference type and extension", () => {
    expect(getFileReferenceCategory("C:\\workspace", "directory")).toBe("directory")
    expect(getFileReferenceCategory("C:\\Downloads\\build.zip", "file")).toBe("archive")
    expect(getFileReferenceCategory("C:\\docs\\proposal.pdf", "file")).toBe("document")
    expect(getFileReferenceCategory("C:\\assets\\hero.webp", "file")).toBe("image")
    expect(getFileReferenceCategory("C:\\src\\app.tsx", "file")).toBe("code")
  })
})
