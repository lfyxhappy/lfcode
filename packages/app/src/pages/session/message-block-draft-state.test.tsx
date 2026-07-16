import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { MessageBlockDraftState } from "./message-block-draft-state"

const toastCalls: Array<{ variant?: string; title?: string; description?: string }> = []
let dialogSelectFileOnOpenFile: ((path: string) => void) | undefined
const originalReact = Reflect.get(globalThis, "React")

mock.module("@lfcode-ai/ui/toast", () => ({
  showToast: (input: { variant?: string; title?: string; description?: string }) => {
    toastCalls.push(input)
  },
}))

mock.module("@/components/dialog-select-file", () => ({
  DialogSelectFile: (props: { onOpenFile: (path: string) => void }) => {
    dialogSelectFileOnOpenFile = props.onOpenFile
    return null
  },
}))

import { createMessageBlockDraftState } from "./message-block-draft-state"

const flush = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

function createCachedState(input?: Partial<MessageBlockDraftState>): MessageBlockDraftState {
  return {
    mode: "edit",
    draft: "cached draft",
    revision: 0,
    dirty: false,
    saving: false,
    baseChecksum: "checksum-1",
    bindingPath: ".lfcode/scratch/code/typescript/demo.ts",
    ...input,
  }
}

function createHarness(config?: {
  cacheEntry?: MessageBlockDraftState
  read?: (input: { path: string }) => Promise<{ data?: { exists?: boolean; content: string; checksum?: string } }>
  write?: (input: {
    path: string
    content: string
    expectedChecksum?: string
    createParents?: boolean
  }) => Promise<{ content: string; checksum?: string } | undefined>
  show?: (fn: () => unknown) => void
}) {
  const cache = new Map<string, MessageBlockDraftState>()
  if (config?.cacheEntry) {
    cache.set("block-1", config.cacheEntry)
  }
  const readCalls: string[] = []
  const writeCalls: Array<{
    path: string
    content: string
    expectedChecksum?: string
    createParents?: boolean
  }> = []
  const tabCalls: string[] = []
  const dialogCalls: Array<() => unknown> = []
  const result = createRoot((dispose) => {
    const draft = createMessageBlockDraftState({
      blockKey: "block-1",
      initialDraft: "initial draft",
      initialPath: ".lfcode/scratch/code/typescript/demo.ts",
      cache,
      sdk: {
        client: {
          file: {
            read: async (input) => {
              readCalls.push(input.path)
              return config?.read?.(input) ?? { data: { exists: true, content: "disk content", checksum: "checksum-disk" } }
            },
          },
        },
      },
      file: {
        write: async (input) => {
          writeCalls.push(input)
          return config?.write?.(input) ?? { content: input.content, checksum: "checksum-written" }
        },
        tab: (path) => {
          tabCalls.push(`tab:${path}`)
          return `file://${path}`
        },
      },
      dialog: {
        show: (fn) => {
          dialogCalls.push(fn)
          config?.show?.(fn)
        },
      },
      tabs: {
        open: (tab) => {
          tabCalls.push(`open:${tab}`)
        },
        setActive: (tab) => {
          tabCalls.push(`active:${tab}`)
        },
      },
      language: {
        t: (key) => key,
      },
      saveErrorTitle: "save failed",
    })

    return {
      dispose,
      draft,
    }
  })

  return {
    ...result,
    cache,
    readCalls,
    writeCalls,
    tabCalls,
    dialogCalls,
  }
}

describe("createMessageBlockDraftState", () => {
  beforeEach(() => {
    toastCalls.length = 0
    dialogSelectFileOnOpenFile = undefined
    Reflect.set(globalThis, "React", {
      createElement: (component: unknown, props: unknown) => {
        if (typeof component === "function") return (component as (input: unknown) => unknown)(props)
        return { component, props }
      },
    })
  })

  afterEach(() => {
    mock.restore()
    Reflect.set(globalThis, "React", originalReact)
  })

  test("hydrates the initial draft from disk when cache is empty", async () => {
    const harness = createHarness({
      read: async () => ({ data: { exists: true, content: "hydrated from disk", checksum: "checksum-hydrated" } }),
    })

    await flush()

    expect(harness.readCalls).toEqual([".lfcode/scratch/code/typescript/demo.ts"])
    expect(harness.draft.state.draft).toBe("hydrated from disk")
    expect(harness.draft.state.baseChecksum).toBe("checksum-hydrated")
    expect(harness.draft.state.dirty).toBe(false)
    harness.dispose()
  })

  test("keeps the fence content when the scratch file does not exist", async () => {
    const harness = createHarness({
      read: async () => ({ data: { exists: false, content: "", checksum: "checksum-empty" } }),
    })

    await flush()

    expect(harness.draft.state.draft).toBe("initial draft")
    expect(harness.draft.state.baseContent).toBe("initial draft")
    expect(harness.draft.state.baseChecksum).toBeUndefined()
    harness.dispose()
  })

  test("writes the current draft and updates checksum on save", async () => {
    const harness = createHarness({
      cacheEntry: createCachedState({
        draft: "edited draft",
        dirty: true,
        baseChecksum: "checksum-before",
      }),
      write: async (input) => ({ content: `${input.content} saved`, checksum: "checksum-after" }),
    })

    const saved = await harness.draft.save("manual")

    expect(saved).toBe(true)
    expect(harness.writeCalls).toEqual([
      {
        path: ".lfcode/scratch/code/typescript/demo.ts",
        content: "edited draft",
        expectedChecksum: "checksum-before",
        createParents: true,
      },
    ])
    expect(harness.draft.state.draft).toBe("edited draft saved")
    expect(harness.draft.state.baseChecksum).toBe("checksum-after")
    expect(harness.draft.state.dirty).toBe(false)
    expect(toastCalls).toHaveLength(0)
    harness.dispose()
  })

  test("opens the saved file in sidebar after saving", async () => {
    const harness = createHarness({
      cacheEntry: createCachedState({
        draft: "open me",
        dirty: true,
      }),
    })

    await harness.draft.openInSidebar()

    expect(harness.writeCalls).toHaveLength(1)
    expect(harness.tabCalls).toEqual([
      "tab:.lfcode/scratch/code/typescript/demo.ts",
      "open:file://.lfcode/scratch/code/typescript/demo.ts",
      "active:file://.lfcode/scratch/code/typescript/demo.ts",
    ])
    harness.dispose()
  })

  test("binds the draft to a newly selected file", async () => {
    const harness = createHarness({
      cacheEntry: createCachedState({
        draft: "bound draft",
        dirty: true,
      }),
      read: async (input) => {
        if (input.path === "src/app.ts") {
          return { data: { exists: true, content: "existing", checksum: "checksum-existing" } }
        }
        return { data: { exists: true, content: "disk content", checksum: "checksum-disk" } }
      },
      show: (fn) => {
        fn()
      },
    })

    harness.draft.bindFile()
    await flush()
    expect(harness.dialogCalls).toHaveLength(1)
    expect(dialogSelectFileOnOpenFile).toBeDefined()

    dialogSelectFileOnOpenFile?.("src/app.ts")
    await flush()

    expect(harness.writeCalls).toEqual([
      {
        path: "src/app.ts",
        content: "bound draft",
        expectedChecksum: "checksum-existing",
        createParents: true,
      },
    ])
    expect(harness.draft.state.bindingPath).toBe("src/app.ts")
    expect(harness.draft.state.dirty).toBe(false)
    harness.dispose()
  })

  test("records save errors and shows a toast", async () => {
    const harness = createHarness({
      cacheEntry: createCachedState({
        draft: "broken draft",
        dirty: true,
      }),
      write: async () => {
        throw new Error("disk offline")
      },
    })

    const saved = await harness.draft.save("manual")

    expect(saved).toBe(false)
    expect(harness.draft.state.saveError).toBe("disk offline")
    expect(harness.draft.state.saving).toBe(false)
    expect(toastCalls).toEqual([
      {
        variant: "error",
        title: "save failed",
        description: "disk offline",
      },
    ])
    harness.dispose()
  })
})
