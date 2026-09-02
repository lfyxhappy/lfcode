import { describe, expect, test } from "bun:test"
import { normalizeBrowserToolURL } from "./app_browser_shared"

describe("normalizeBrowserToolURL", () => {
  test("preserves web and file URLs", () => {
    expect(normalizeBrowserToolURL("https://example.com", "C:/workspace")).toBe("https://example.com")
    expect(normalizeBrowserToolURL("file:///C:/workspace/demo.html", "C:/workspace")).toBe("file:///C:/workspace/demo.html")
  })

  test("converts absolute and workspace-relative HTML paths", () => {
    expect(normalizeBrowserToolURL("C:\\workspace\\demo.html", "C:\\workspace")).toBe("file:///C:/workspace/demo.html")
    expect(normalizeBrowserToolURL("dist/index.html?run=1", "C:\\workspace")).toBe("file:///C:/workspace/dist/index.html?run=1")
  })
})
