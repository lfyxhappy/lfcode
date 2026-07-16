import { createRenderEffect, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@lfcode-ai/ui/toast"

export type MessageBlockDraftState = {
  mode: "preview" | "edit" | "diff"
  draft: string
  revision: number
  baseContent?: string
  dirty: boolean
  saving: boolean
  saveError?: string
  baseChecksum?: string
  bindingPath: string
}

export function createMessageBlockDraftState(input: {
  blockKey: string
  initialDraft: string
  initialPath: string
  cache: Map<string, MessageBlockDraftState>
  sdk: {
    client: {
      file: {
        read: (input: { path: string }) => Promise<{ data?: { exists?: boolean; content: string; checksum?: string } }>
      }
    }
  }
  file: {
    write: (input: {
      path: string
      content: string
      expectedChecksum?: string
      createParents?: boolean
    }) => Promise<{ content: string; checksum?: string } | undefined>
    tab: (path: string) => string
  }
  dialog: {
    show: (fn: () => JSX.Element) => void
  }
  tabs: {
    open: (tab: string) => Promise<void> | void
    setActive: (tab: string) => void
  }
  language: {
    t: (key: string) => string
  }
  saveErrorTitle: string
}) {
  const hasCachedState = input.cache.has(input.blockKey)
  const [hydrated, setHydrated] = createSignal(false)
  const cached = input.cache.get(input.blockKey)
  const [state, setState] = createStore<MessageBlockDraftState>(
    cached
      ? { ...cached, revision: cached.revision ?? 0 }
      : {
      mode: "preview",
      draft: input.initialDraft,
      revision: 0,
      baseContent: input.initialDraft,
      dirty: false,
      saving: false,
      bindingPath: input.initialPath,
        },
  )

  const describeError = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === "string" && error) return error
    return input.language.t("common.requestFailed")
  }

  createRenderEffect(() => {
    input.cache.set(input.blockKey, { ...state })
  })

  createRenderEffect(() => {
    if (hydrated()) return
    setHydrated(true)
    if (hasCachedState) return
    void input.sdk.client.file
      .read({ path: state.bindingPath })
      .then((result) => {
        const content = result.data
        if (content?.exists !== true) return
        setState({
          mode: state.mode,
          draft: content.content,
          revision: state.revision + 1,
          baseContent: content.content,
          dirty: false,
          saving: false,
          saveError: undefined,
          baseChecksum: content.checksum,
          bindingPath: state.bindingPath,
        })
      })
      .catch(() => {})
  })

  const writeDraft = async (config: {
    path: string
    expectedChecksum?: string
    reason?: "manual" | "sidebar" | "bind" | "run"
    suppressToast?: boolean
  }) => {
    if (state.saving) return true
    if (!state.dirty && state.baseChecksum && config.path === state.bindingPath) return true

    setState("saving", true)
    try {
      const content = await input.file.write({
        path: config.path,
        content: state.draft,
        expectedChecksum: config.expectedChecksum,
        createParents: true,
      })
      if (!content) throw new Error(input.language.t("common.requestFailed"))
      setState({
        mode: state.mode,
        draft: content.content,
        revision: state.revision + 1,
        baseContent: content.content,
        dirty: false,
        saving: false,
        saveError: undefined,
        baseChecksum: content.checksum,
        bindingPath: config.path,
      })
      return true
    } catch (error) {
      const message = describeError(error)
      setState("saving", false)
      setState("saveError", message)
      if (!config.suppressToast) {
        showToast({
          variant: "error",
          title: input.saveErrorTitle,
          description: message,
        })
      }
      return false
    }
  }

  const save = async (reason: "manual" | "sidebar" | "run" = "manual") => {
    return writeDraft({
      path: state.bindingPath,
      expectedChecksum: state.baseChecksum,
      reason,
      suppressToast: reason === "sidebar",
    })
  }

  const openInSidebar = async () => {
    const saved = await save("sidebar")
    if (!saved) return
    const tab = input.file.tab(state.bindingPath)
    void input.tabs.open(tab)
    input.tabs.setActive(tab)
  }

  const bindFileToPath = async (path: string) => {
    const existing = await input.sdk.client.file.read({ path }).catch(() => undefined)
    return writeDraft({
      path,
      expectedChecksum: existing?.data?.exists ? existing.data.checksum : undefined,
      reason: "bind",
    })
  }

  const bindFile = () => {
    void import("@/components/dialog-select-file").then((mod) => {
      input.dialog.show(() => (
        <mod.DialogSelectFile
          mode="files"
          onOpenFile={(path) => {
            void bindFileToPath(path)
          }}
        />
      ))
    })
  }

  return {
    state,
    setState,
    writeDraft,
    save,
    openInSidebar,
    bindFileToPath,
    bindFile,
    describeError,
  }
}
