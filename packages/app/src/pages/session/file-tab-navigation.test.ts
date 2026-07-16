import { afterEach, describe, expect, test } from "bun:test"
import { consumeCodeEditorNavigationRequest } from "@/components/code-editor/core/navigation"
import { createLfcodeEditorPath } from "./file-tab-navigation"

describe("createLfcodeEditorPath", () => {
  afterEach(() => {
    consumeCodeEditorNavigationRequest("C:/repo/src/target.ts")
  })

  test("queues selection, loads file, opens tab, and activates it", async () => {
    const calls: string[] = []
    const openCodeEditorPath = createLfcodeEditorPath({
      normalizePath: (path) => {
        calls.push(`normalize:${path}`)
        return path.replace("/", "\\")
      },
      loadFile: async (path) => {
        calls.push(`load:${path}`)
      },
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: async (tab) => {
        calls.push(`open:${tab}`)
      },
      setActiveTab: (tab) => {
        calls.push(`active:${tab}`)
      },
    })

    await openCodeEditorPath({
      path: "C:/repo/src/target.ts",
      selection: {
        startLineNumber: 3,
        startColumn: 7,
        endLineNumber: 3,
        endColumn: 12,
      },
    })

    expect(calls).toEqual([
      "normalize:C:/repo/src/target.ts",
      "load:C:/repo/src/target.ts",
      "tab:C:/repo/src/target.ts",
      "open:file://C:/repo/src/target.ts",
      "active:file://C:/repo/src/target.ts",
    ])
    expect(consumeCodeEditorNavigationRequest("C:/repo/src/target.ts")).toEqual({
      selection: {
        startLineNumber: 3,
        startColumn: 7,
        endLineNumber: 3,
        endColumn: 12,
      },
    })
  })

  test("stops when normalized path is unavailable", async () => {
    const calls: string[] = []
    const openCodeEditorPath = createLfcodeEditorPath({
      normalizePath: () => undefined,
      loadFile: async (path) => {
        calls.push(`load:${path}`)
      },
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: async (tab) => {
        calls.push(`open:${tab}`)
      },
      setActiveTab: (tab) => {
        calls.push(`active:${tab}`)
      },
    })

    await openCodeEditorPath({
      path: "C:/repo/src/target.ts",
    })

    expect(calls).toEqual([])
    expect(consumeCodeEditorNavigationRequest("C:\\repo\\src\\target.ts")).toBeUndefined()
  })
})
