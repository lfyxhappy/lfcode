import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { editor } from "monaco-editor"

type MonacoCodeEditorOpenHandler = (
  input: {
    resource?: { scheme?: string; toString(): string; fsPath?: string; path?: string }
    options?: {
      selection?: {
        startLineNumber: number
        startColumn: number
        endLineNumber?: number
        endColumn?: number
      }
    }
  },
  source: editor.ICodeEditor | null,
) => Promise<editor.ICodeEditor | null>

let installedOpenHandler: MonacoCodeEditorOpenHandler | undefined
const registerMonacoCodeEditorOpenHandler = mock((handler: MonacoCodeEditorOpenHandler) => {
  installedOpenHandler = handler
  return { dispose: () => {} }
})
let navigation: typeof import("./navigation")

beforeAll(async () => {
  mock.module("@lfcode-ai/ui/monaco-kernel", () => ({ registerMonacoCodeEditorOpenHandler }))
  navigation = await import("./navigation")
})

describe("queueCodeEditorNavigation", () => {
  test("stores the latest pending selection for a path until it is consumed", () => {
    navigation.queueCodeEditorNavigation({
      path: "C:\\repo\\src\\target.ts",
      selection: {
        startLineNumber: 2,
        startColumn: 3,
      },
    })
    navigation.queueCodeEditorNavigation({
      path: "C:\\repo\\src\\target.ts",
      selection: {
        startLineNumber: 5,
        startColumn: 7,
        endLineNumber: 5,
        endColumn: 11,
      },
    })

    expect(navigation.consumeCodeEditorNavigationRequest("C:\\repo\\src\\target.ts")).toEqual({
      selection: {
        startLineNumber: 5,
        startColumn: 7,
        endLineNumber: 5,
        endColumn: 11,
      },
    })
    expect(navigation.consumeCodeEditorNavigationRequest("C:\\repo\\src\\target.ts")).toBeUndefined()
  })
})

describe("applyCodeEditorNavigationSelection", () => {
  test("applies a range selection and centers it", () => {
    const calls: string[] = []
    navigation.applyCodeEditorNavigationSelection(
      {
        setPosition: () => {
          calls.push("setPosition")
        },
        setSelection: (range) => {
          calls.push(`setSelection:${JSON.stringify(range)}`)
        },
        revealPositionInCenter: () => {
          calls.push("revealPositionInCenter")
        },
        revealRangeInCenter: (range) => {
          calls.push(`revealRangeInCenter:${JSON.stringify(range)}`)
        },
        focus: () => {
          calls.push("focus")
        },
      },
      {
        startLineNumber: 8,
        startColumn: 4,
        endLineNumber: 9,
        endColumn: 6,
      },
    )

    expect(calls).toEqual([
      'setSelection:{"startLineNumber":8,"startColumn":4,"endLineNumber":9,"endColumn":6}',
      'revealRangeInCenter:{"startLineNumber":8,"startColumn":4,"endLineNumber":9,"endColumn":6}',
      "focus",
    ])
  })

  test("applies a cursor position when no end range is provided", () => {
    const calls: string[] = []
    navigation.applyCodeEditorNavigationSelection(
      {
        setPosition: (position) => {
          calls.push(`setPosition:${JSON.stringify(position)}`)
        },
        setSelection: () => {
          calls.push("setSelection")
        },
        revealPositionInCenter: (position) => {
          calls.push(`revealPositionInCenter:${JSON.stringify(position)}`)
        },
        revealRangeInCenter: () => {
          calls.push("revealRangeInCenter")
        },
        focus: () => {
          calls.push("focus")
        },
      },
      {
        startLineNumber: 12,
        startColumn: 2,
      },
    )

    expect(calls).toEqual([
      'setPosition:{"lineNumber":12,"column":2}',
      'revealPositionInCenter:{"lineNumber":12,"column":2}',
      "focus",
    ])
  })
})

describe("code editor navigation history", () => {
  test("steps back and forward across navigation targets", () => {
    navigation.resetCodeEditorNavigationHistory()
    navigation.pushCodeEditorNavigationHistory({
      from: {
        path: "C:\\repo\\src\\entry.ts",
        selection: {
          startLineNumber: 3,
          startColumn: 2,
        },
      },
      to: {
        path: "C:\\repo\\src\\target.ts",
        selection: {
          startLineNumber: 10,
          startColumn: 5,
        },
      },
    })

    const back = navigation.consumeCodeEditorNavigationHistory("back", {
      path: "C:\\repo\\src\\target.ts",
      selection: {
        startLineNumber: 10,
        startColumn: 5,
      },
    })

    expect(back).toEqual({
      path: "C:\\repo\\src\\entry.ts",
      selection: {
        startLineNumber: 3,
        startColumn: 2,
      },
    })

    const forward = navigation.consumeCodeEditorNavigationHistory("forward", {
      path: "C:\\repo\\src\\entry.ts",
      selection: {
        startLineNumber: 3,
        startColumn: 2,
      },
    })

    expect(forward).toEqual({
      path: "C:\\repo\\src\\target.ts",
      selection: {
        startLineNumber: 10,
        startColumn: 5,
      },
    })
  })
})

describe("registerCodeEditorOpenHandler", () => {
  test("routes a cross-file open request through the Monaco Kernel", async () => {
    const source = {
      getModel: () => ({
        uri: {
          toString: () => "file:///C:/repo/src/source.ts",
        },
      }),
    } as unknown as editor.ICodeEditor
    const open = mock(async (_input: { path: string }) => {})
    const cleanup = navigation.registerCodeEditorOpenHandler(source, open)
    const handler = installedOpenHandler

    expect(registerMonacoCodeEditorOpenHandler).toHaveBeenCalledTimes(1)
    if (!handler) throw new Error("Monaco Kernel did not install the code editor open handler")

    expect(
      await handler(
        {
          resource: {
            scheme: "file",
            toString: () => "file:///C:/repo/src/target.ts",
            fsPath: "C:\\repo\\src\\target.ts",
          },
          options: {
            selection: {
              startLineNumber: 4,
              startColumn: 2,
              endLineNumber: 4,
              endColumn: 8,
            },
          },
        },
        source,
      ),
    ).toBe(source)
    expect(open).toHaveBeenCalledWith({
      path: "C:\\repo\\src\\target.ts",
      selection: {
        startLineNumber: 4,
        startColumn: 2,
        endLineNumber: 4,
        endColumn: 8,
      },
    })

    cleanup()
    expect(
      await handler(
        {
          resource: {
            scheme: "file",
            toString: () => "file:///C:/repo/src/target.ts",
            fsPath: "C:\\repo\\src\\target.ts",
          },
        },
        source,
      ),
    ).toBeNull()
  })
})
