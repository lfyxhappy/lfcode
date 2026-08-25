import { batch, createEffect, createMemo, createSignal, lazy, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Button } from "@lfcode-ai/ui/button"
import type { FileSearchHandle } from "@lfcode-ai/ui/file"
import { useFileComponent } from "@lfcode-ai/ui/context/file"
import { Icon, type IconProps } from "@lfcode-ai/ui/icon"
import { cloneSelectedLineRange, previewSelectedLines } from "@lfcode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@lfcode-ai/ui/line-comment-annotations"
import { canUseCodeDiffView } from "@lfcode-ai/ui/code-diff-shared"
import { sampledChecksum } from "@lfcode-ai/shared/util/encode"
import { encodeFilePath } from "@/context/file/path"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { ScrollView } from "@lfcode-ai/ui/scroll-view"
import { showToast } from "@lfcode-ai/ui/toast"
import { CodeEditorCommandStrip } from "@/components/code-editor/core/command-strip"
import DropdownMenu from "@/components/code-editor/core/dropdown-menu"
import type { CodeEditorCommandHandle } from "@/components/code-editor/core/command-handle"
import { getCodeEditorDocumentGuard } from "@/components/code-editor/core/document-guard"
import { getCodeEditorLanguage } from "@/components/code-editor/core/language"
import { CodeEditorPhase0Editor } from "@/components/code-editor/core/phase0-editor"
import { isCodeEditorPhase0Enabled, isCodeEditorPhase0Path } from "@/components/code-editor/core/phase0"
import { hasCodeEditorNavigationRequest } from "@/components/code-editor/core/navigation"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { useTerminal } from "@/context/terminal"
import { isCppEditablePath, isCppRunnablePath } from "@/pages/session/cpp-file"
import {
  isMissingCppCompilerError,
  promptInstallManagedCppCompiler,
  runCppFileInTerminal,
} from "@/pages/session/cpp-terminal-run"
import { isFileChecksumConflict } from "@/pages/session/file-write-state"
import { getSessionHandoff } from "@/pages/session/handoff"
import { createLfcodeEditorPath } from "@/pages/session/file-tab-navigation"
import { isPythonRunnablePath } from "@/pages/session/python-file"
import {
  isMissingManagedPythonError,
  promptInstallManagedPythonRuntime,
  runPythonFileInTerminal,
} from "@/pages/session/python-terminal-run"
import { useSessionLayout } from "@/pages/session/session-layout"
import { browserTab, createBrowserTabID, createSessionTabs } from "@/pages/session/helpers"

const CodeDiffView = lazy(() => import("@lfcode-ai/ui/code-diff-view").then((mod) => ({ default: mod.CodeDiffView })))

type FileEditorMode = "preview" | "edit" | "diff"

type FileEditorState = {
  mode: FileEditorMode
  draft: string
  revision: number
  dirty: boolean
  saving: boolean
  saveReason: "auto" | "manual" | "run" | undefined
  saveError: string | undefined
  baseChecksum: string | undefined
}

type FileEditorStateCache = Omit<FileEditorState, "draft"> & { draft?: string }

const fileEditorStates = new Map<string, FileEditorStateCache>()
const fileEditorSaveFlights = new Map<string, Promise<boolean>>()

function createFileEditorState(input: Partial<FileEditorState> = {}): FileEditorState {
  return {
    mode: "preview",
    draft: "",
    revision: 0,
    dirty: false,
    saving: false,
    saveReason: undefined,
    saveError: undefined,
    baseChecksum: undefined,
    ...input,
  }
}

function fileEditorStateKey(sessionKey: string, path: string) {
  return `${sessionKey}\n${path}`
}

function readFileEditorState(key: string, source: string, checksum: string | undefined) {
  const cached = fileEditorStates.get(key)
  if (!cached) return
  if (cached.dirty || cached.saving) return createFileEditorState({ ...cached, draft: cached.draft ?? source })
  return createFileEditorState({
    ...cached,
    draft: source,
    dirty: false,
    saving: false,
    saveReason: undefined,
    baseChecksum: checksum,
  })
}

function cacheFileEditorState(key: string, state: FileEditorState) {
  fileEditorStates.set(key, {
    ...state,
    draft: state.dirty || state.saving ? state.draft : undefined,
  })
}

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function FileTabContent(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const prompt = usePrompt()
  const sdk = useSDK()
  const terminal = useTerminal()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const openLfcodeEditorPath = createLfcodeEditorPath({
    normalizePath: file.normalize,
    loadFile: file.load,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActiveTab: tabs().setActive,
  })
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const editorLanguage = createMemo(() => getCodeEditorLanguage(path()))
  const supportedCodePath = createMemo(() => isCodeEditorPhase0Path(path()))
  const phase0Guard = createMemo(() => getCodeEditorDocumentGuard(contents()))
  const editablePhase0 = createMemo(() => isCodeEditorPhase0Enabled() && supportedCodePath())
  const phase0BlockedBySize = createMemo(
    () => isCodeEditorPhase0Enabled() && supportedCodePath() && phase0Guard().tooLarge,
  )
  const editableCpp = createMemo(() => isCppEditablePath(path()))
  const editableCode = createMemo(() => editablePhase0())
  const runnableCpp = createMemo(() => isCppRunnablePath(path()))
  const runnablePython = createMemo(() => isPythonRunnablePath(path()))
  const previewableInBrowser = createMemo(() => {
    const value = path()?.toLowerCase() ?? ""
    return value.endsWith(".html") || value.endsWith(".htm") || value.endsWith(".svg")
  })
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })
  const editorStateKey = createMemo(() => {
    const nextPath = path()
    if (!nextPath) return
    return fileEditorStateKey(sessionKey(), file.normalize(nextPath))
  })
  const [editor, setEditor] = createStore<FileEditorState>(createFileEditorState())
  const replaceEditor = (next: FileEditorState) => {
    setEditor(next)
    const key = editorStateKey()
    if (!key) return
    cacheFileEditorState(key, next)
  }
  const updateEditor = (next: Partial<FileEditorState>) => {
    const state = createFileEditorState({ ...editor, ...next })
    replaceEditor(state)
  }
  const syncEditorFromCache = (key: string) => {
    const next = readFileEditorState(key, contents(), state()?.content?.checksum)
    if (!next) return
    setEditor(next)
  }
  const [commandHandle, setCommandHandle] = createSignal<CodeEditorCommandHandle>()
  const [codeDiffUnavailable, setCodeDiffUnavailable] = createSignal(false)
  const saveConflict = createMemo(() => isFileChecksumConflict(editor.saveError))
  const diffMode = createMemo(() => editor.mode === "diff")
  const diffUseCodeView = createMemo(
    () =>
      !codeDiffUnavailable() &&
      canUseCodeDiffView({
        path: path(),
        before: contents(),
        after: editor.draft,
      }),
  )
  const externalChanged = createMemo(() => {
    const checksum = state()?.content?.checksum
    return Boolean(
      editableCode() && editor.dirty && checksum && editor.baseChecksum && checksum !== editor.baseChecksum,
    )
  })
  const fileLabels = createMemo(() =>
    editableCpp()
      ? {
          diff: language.t("session.cppFile.diff"),
          preview: language.t("session.cppFile.preview"),
          saved: language.t("session.cppFile.saved"),
          unsaved: language.t("session.cppFile.unsaved"),
          reload: language.t("session.cppFile.reload"),
          reloadFailed: language.t("session.cppFile.reloadFailed"),
          externalChanged: language.t("session.cppFile.externalChanged"),
          conflict: language.t("session.cppFile.conflict"),
        }
      : {
          diff: language.t("session.codeFile.diff"),
          preview: language.t("session.codeFile.preview"),
          saved: language.t("session.codeFile.saved"),
          unsaved: language.t("session.codeFile.unsaved"),
          reload: language.t("session.codeFile.reload"),
          reloadFailed: language.t("session.codeFile.reloadFailed"),
          externalChanged: language.t("session.codeFile.externalChanged"),
          conflict: language.t("session.codeFile.conflict"),
        },
  )
  const primaryCapabilityAction = createMemo<{
    icon: IconProps["name"]
    label: string
    automationID: string
    run: () => void
  } | null>(() => {
    if (!state()?.loaded) return null
    if (runnableCpp()) {
      return {
        icon: "terminal",
        label: language.t("session.cppFile.run"),
        automationID: "code-file-run-cpp",
        run: () => void runCurrentCppFile(),
      }
    }
    if (runnablePython()) {
      return {
        icon: "terminal",
        label: language.t("session.codeFile.run"),
        automationID: "code-file-run-python",
        run: () => void runCurrentPythonFile(),
      }
    }
    if (previewableInBrowser()) {
      return {
        icon: "window-cursor",
        label: language.t("session.codeFile.previewBrowser"),
        automationID: "code-file-preview-browser",
        run: () => void previewCurrentFileInBrowser(),
      }
    }
    return null
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const clearSaveTimer = () => {
    if (saveTimer === undefined) return
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  const describeError = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === "string" && error) return error
    return language.t("common.requestFailed")
  }

  const saveEditor = async (reason: "auto" | "manual" | "run" = "manual"): Promise<boolean> => {
    clearSaveTimer()
    const key = editorStateKey()
    if (!editableCode() || !path() || !key || !editor.dirty) return true
    const pending = fileEditorSaveFlights.get(key)
    if (pending) {
      const saved = await pending
      return saved ? saveEditor(reason) : false
    }

    const snapshot = {
      key,
      path: path()!,
      draft: editor.draft,
      checksum: editor.baseChecksum,
    }
    const operation = (async () => {
      const pendingState = createFileEditorState({ ...editor, saving: true, saveReason: reason })
      cacheFileEditorState(snapshot.key, pendingState)
      if (editorStateKey() === snapshot.key) setEditor(pendingState)
      try {
        const content = await file.write({
          path: snapshot.path,
          content: snapshot.draft,
          expectedChecksum: snapshot.checksum,
        })
        if (!content) throw new Error(language.t("common.requestFailed"))
        const current = readFileEditorState(snapshot.key, snapshot.draft, snapshot.checksum) ?? pendingState
        const next =
          current.draft === snapshot.draft
            ? createFileEditorState({
                ...current,
                draft: content.content,
                revision: current.revision + 1,
                dirty: false,
                saving: false,
                saveReason: undefined,
                saveError: undefined,
                baseChecksum: content.checksum,
              })
            : createFileEditorState({
                ...current,
                revision: current.revision + 1,
                saving: false,
                saveReason: undefined,
                saveError: undefined,
                baseChecksum: content.checksum,
              })
        cacheFileEditorState(snapshot.key, next)
        if (editorStateKey() === snapshot.key) setEditor(next)
        return true
      } catch (error) {
        const message = describeError(error)
        const current = readFileEditorState(snapshot.key, snapshot.draft, snapshot.checksum) ?? pendingState
        const next = createFileEditorState({
          ...current,
          saving: false,
          saveReason: undefined,
          saveError: message,
        })
        cacheFileEditorState(snapshot.key, next)
        if (editorStateKey() === snapshot.key) setEditor(next)
        if (reason !== "auto") {
          showToast({
            variant: "error",
            title: language.t("common.save"),
            description: message,
          })
        }
        return false
      }
    })()
    fileEditorSaveFlights.set(snapshot.key, operation)
    try {
      return await operation
    } finally {
      if (fileEditorSaveFlights.get(snapshot.key) === operation) fileEditorSaveFlights.delete(snapshot.key)
    }
  }

  const saveThroughCommandHandle = async (reason: "auto" | "manual" | "run" = "manual") => {
    if (reason === "auto") return saveEditor("auto")
    if (editor.mode === "edit" && editablePhase0() && commandHandle()) {
      await commandHandle()!.save()
      return true
    }
    return saveEditor(reason)
  }

  const runCurrentCppFile = async () => {
    if (!runnableCpp() || !path()) return
    const saved = await saveThroughCommandHandle("run")
    if (!saved) return

    try {
      await runCppFileInTerminal({
        sdk,
        terminal,
        openPanel: () => view().terminal.open(),
        path: path()!,
      })
    } catch (error) {
      if (isMissingCppCompilerError(error)) {
        promptInstallManagedCppCompiler({
          globalSDK,
          language,
          onInstalled: () => runCurrentCppFile(),
        })
        return
      }
      showToast({
        variant: "error",
        title: language.t("session.cppFile.runFailed"),
        description: describeError(error),
      })
    }
  }

  const runCurrentPythonFile = async () => {
    if (!runnablePython() || !path()) return
    const saved = await saveThroughCommandHandle("run")
    if (!saved) return

    try {
      await runPythonFileInTerminal({
        sdk,
        globalSDK,
        terminal,
        openPanel: () => view().terminal.open(),
        path: path()!,
      })
    } catch (error) {
      if (isMissingManagedPythonError(error)) {
        promptInstallManagedPythonRuntime({
          globalSDK,
          language,
          onInstalled: () => runCurrentPythonFile(),
        })
        return
      }
      showToast({
        variant: "error",
        title: language.t("session.codeFile.runFailed"),
        description: describeError(error),
      })
    }
  }

  const previewCurrentFileInBrowser = async () => {
    if (!previewableInBrowser() || !path()) return
    const saved = await saveThroughCommandHandle("manual")
    if (!saved) return

    try {
      const absolutePath = toAbsoluteSessionPath(sdk.directory, path()!)
      const id = createBrowserTabID()
      batch(() => {
        view().browser.open(id, `file://${encodeFilePath(absolutePath)}`)
        view().reviewPanel.open()
        tabs().setActive(browserTab(id))
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("session.codeFile.previewBrowserFailed"),
        description: describeError(error),
      })
    }
  }

  const reloadEditorFromDisk = async () => {
    clearSaveTimer()
    if (!path()) return

    try {
      await file.load(path()!, { force: true })
      const content = file.get(path()!)?.content
      if (!content) throw new Error(language.t("common.requestFailed"))
      replaceEditor(
        createFileEditorState({
          ...editor,
          draft: content.content,
          revision: editor.revision + 1,
          dirty: false,
          saving: false,
          saveReason: undefined,
          saveError: undefined,
          baseChecksum: content.checksum,
        }),
      )
    } catch (error) {
      showToast({
        variant: "error",
        title: fileLabels().reloadFailed,
        description: describeError(error),
      })
    }
  }

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      if (editor.mode === "edit" && commandHandle()) {
        void commandHandle()?.openFind()
        return
      }
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      [path, () => state()?.content?.checksum, contents, editableCode],
      ([nextPath, checksum, source, editable], previous) => {
        if (!editable || !nextPath) {
          setEditor(createFileEditorState())
          return
        }

        const pathChanged = previous?.[0] !== nextPath
        const key = fileEditorStateKey(sessionKey(), file.normalize(nextPath))
        if (pathChanged) {
          const cached = readFileEditorState(key, source, checksum)
          if (cached) {
            setEditor(cached)
            return
          }
          replaceEditor(
            createFileEditorState({
              mode: hasCodeEditorNavigationRequest(nextPath) ? "edit" : "preview",
              draft: source,
              baseChecksum: checksum,
            }),
          )
          return
        }

        if (editor.dirty || editor.saving) {
          if (editor.baseChecksum !== checksum) return
          return
        }
        replaceEditor(
          createFileEditorState({
            ...editor,
            draft: source,
            revision: editor.revision + 1,
            baseChecksum: checksum,
          }),
        )
      },
    ),
  )

  createEffect(() => {
    const key = editorStateKey()
    if (!key || !editor.saving) return
    const pending = fileEditorSaveFlights.get(key)
    if (!pending) return
    void pending.finally(() => syncEditorFromCache(key))
  })

  createEffect(() => {
    editor.draft
    if (!editableCode() || !editor.dirty || editor.saving) {
      clearSaveTimer()
      return
    }

    clearSaveTimer()
    saveTimer = setTimeout(() => {
      void saveThroughCommandHandle("auto")
    }, 1_200)
  })

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  createEffect(() => {
    const nextPath = path()
    if (!nextPath) return
    if (activeFileTab() !== props.tab) return
    if (!editableCode()) return
    if (editor.mode === "edit") return
    if (!hasCodeEditorNavigationRequest(nextPath)) return
    updateEditor({ mode: "edit" })
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderHoverUtility={commentsUi.renderHoverUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  onCleanup(() => {
    clearSaveTimer()
  })

  const toolbarButtonClass = "size-8 min-w-8 rounded-lg p-0"
  const toolbarIconClass = "size-4"
  const toolbarMenuContentClass =
    "min-w-[220px] rounded-lg border border-border-weak-base bg-background-panel p-1.5 shadow-md"
  const toolbarMenuItemClass = "rounded-lg"
  const renderToolbarMenuLabel = (input: { icon: IconProps["name"]; label: string }) => (
    <div class="flex items-center gap-2.5">
      <Icon name={input.icon} class="size-3.5 shrink-0 text-icon-weak-base" />
      <DropdownMenu.ItemLabel>{input.label}</DropdownMenu.ItemLabel>
    </div>
  )
  const currentModeIcon = () => (editor.mode === "edit" ? "edit" : diffMode() ? "code" : "eye")
  const currentModeLabel = () =>
    editor.mode === "edit" ? language.t("common.edit") : diffMode() ? fileLabels().diff : fileLabels().preview
  const showReloadAction = () => externalChanged() || saveConflict()
  const showOverflowAction = () => showReloadAction()
  const showSaveAction = () => editor.dirty || editor.saving
  const showSavingStatus = () => editor.saving && editor.saveReason !== "auto"

  return (
    <Tabs.Content
      value={props.tab}
      data-key={props.tab}
      data-automation-id="session-file-tab-panel"
      data-file-path={path() ?? ""}
      data-file-loaded={state()?.loaded ? "true" : "false"}
      data-file-loading={state()?.loading ? "true" : "false"}
      data-file-error={state()?.error ? "true" : "false"}
      data-editor-mode={editor.mode}
      data-editor-language={editorLanguage() ?? ""}
      class="mt-3 relative h-full"
    >
      <div class="flex h-full min-h-0 flex-col">
        <Show when={editableCode()}>
          <div class="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-background-base px-3 py-2">
            <div class="sr-only">
              <button type="button" data-automation-id="code-file-edit" onClick={() => updateEditor({ mode: "edit" })}>
                {language.t("common.edit")}
              </button>
              <button
                type="button"
                data-automation-id="code-file-preview"
                onClick={() => updateEditor({ mode: "preview" })}
              >
                {fileLabels().preview}
              </button>
              <button type="button" data-automation-id="code-file-diff" onClick={() => updateEditor({ mode: "diff" })}>
                {fileLabels().diff}
              </button>
              <Show when={primaryCapabilityAction()}>
                {(action) => (
                  <button type="button" data-automation-id={action().automationID} onClick={action().run}>
                    {action().label}
                  </button>
                )}
              </Show>
            </div>
            <div class="min-w-0 flex items-center gap-2 text-12-regular text-text-weak">
              <Show when={!externalChanged() && !saveConflict() && showSavingStatus()}>
                <span class="truncate">{language.t("common.saving")}</span>
              </Show>
              <Show when={!externalChanged() && !saveConflict() && !editor.saving && editor.dirty}>
                <span
                  class="size-2 shrink-0 rounded-full bg-status-warning"
                  title={fileLabels().unsaved}
                  aria-label={fileLabels().unsaved}
                />
              </Show>
              <Show when={externalChanged()}>
                <span class="truncate text-status-warning">{fileLabels().externalChanged}</span>
              </Show>
              <Show when={!externalChanged() && saveConflict()}>
                <span class="truncate text-text-danger">{fileLabels().conflict}</span>
              </Show>
              <Show when={!externalChanged() && !saveConflict() && editor.saveError}>
                {(message) => <span class="truncate text-text-danger">{message()}</span>}
              </Show>
            </div>

            <div class="shrink-0 flex items-center gap-1.5">
              <Show when={editor.mode === "edit"}>
                <CodeEditorCommandStrip handle={commandHandle()} compact />
              </Show>
              <DropdownMenu gutter={6} placement="bottom-end">
                <DropdownMenu.Trigger
                  as={Button}
                  type="button"
                  size="small"
                  variant="ghost"
                  class={toolbarButtonClass}
                  title={currentModeLabel()}
                  aria-label={currentModeLabel()}
                  data-automation-id="cpp-file-mode-menu"
                >
                  <Icon name={currentModeIcon()} class={toolbarIconClass} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="min-w-[220px] rounded-lg border border-border-weak-base bg-background-panel p-1.5 shadow-md">
                    <DropdownMenu.Item class="rounded-lg" onSelect={() => updateEditor({ mode: "edit" })}>
                      {renderToolbarMenuLabel({ icon: "edit", label: language.t("common.edit") })}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item class="rounded-lg" onSelect={() => updateEditor({ mode: "preview" })}>
                      {renderToolbarMenuLabel({ icon: "eye", label: fileLabels().preview })}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item class="rounded-lg" onSelect={() => updateEditor({ mode: "diff" })}>
                      {renderToolbarMenuLabel({ icon: "code", label: fileLabels().diff })}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
              <Show when={primaryCapabilityAction()}>
                {(action) => (
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    class={toolbarButtonClass}
                    title={action().label}
                    aria-label={action().label}
                    data-automation-id={action().automationID}
                    onClick={action().run}
                  >
                    <Icon name={action().icon} class={toolbarIconClass} />
                  </Button>
                )}
              </Show>
              <Show when={showSaveAction()}>
                <Button
                  type="button"
                  data-automation-id="cpp-file-save"
                  size="small"
                  variant="ghost"
                  class={toolbarButtonClass}
                  title={language.t("common.save")}
                  aria-label={language.t("common.save")}
                  disabled={!editor.dirty || editor.saving}
                  onClick={() => void saveThroughCommandHandle("manual")}
                >
                  <Icon name="check" class={toolbarIconClass} />
                </Button>
              </Show>
              <Show when={showOverflowAction()}>
                <DropdownMenu gutter={6} placement="bottom-end">
                  <DropdownMenu.Trigger
                    as={Button}
                    type="button"
                    size="small"
                    variant="ghost"
                    class={toolbarButtonClass}
                    title={language.t("common.moreOptions")}
                    aria-label={language.t("common.moreOptions")}
                    data-automation-id="cpp-file-more-actions"
                  >
                    <Icon name="dot-grid" class={toolbarIconClass} />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class={toolbarMenuContentClass}>
                      <Show when={showReloadAction()}>
                        <DropdownMenu.Item
                          class={toolbarMenuItemClass}
                          data-automation-id="cpp-file-reload"
                          onSelect={() => void reloadEditorFromDisk()}
                        >
                          {renderToolbarMenuLabel({ icon: "reset", label: fileLabels().reload })}
                        </DropdownMenu.Item>
                      </Show>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={phase0BlockedBySize()}>
          <div class="mb-3 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-12-regular text-status-warning">
            {language.t("session.codeFile.largeEditorWarning", {
              lines: phase0Guard().lineCount,
              chars: phase0Guard().charCount,
            })}
          </div>
        </Show>

        <Show
          when={editableCode() && editor.mode === "edit" && state()?.loaded}
          fallback={
            <Switch>
              <Match when={editableCode() && diffMode() && state()?.loaded}>
                <div class="flex min-h-0 flex-1 flex-col">
                  <Show
                    when={diffUseCodeView()}
                    fallback={
                      <Dynamic
                        component={fileComponent}
                        mode="diff"
                        before={{
                          name: path() ?? "",
                          contents: contents(),
                        }}
                        after={{
                          name: path() ?? "",
                          contents: editor.draft,
                        }}
                        class="min-h-0 flex-1"
                      />
                    }
                  >
                    <CodeDiffView
                      path={path()}
                      before={contents()}
                      after={editor.draft}
                      diffStyle="split"
                      heightClass="h-full"
                      onUnavailable={() => setCodeDiffUnavailable(true)}
                    />
                  </Show>
                </div>
              </Match>
              <Match when={true}>
                <ScrollView
                  class="h-full min-h-0 flex-1"
                  viewportRef={scrollSync.setViewport}
                  onScroll={scrollSync.handleScroll as any}
                >
                  <Switch>
                    <Match when={state()?.loaded}>{renderFile(contents())}</Match>
                    <Match when={state()?.loading}>
                      <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
                    </Match>
                    <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
                  </Switch>
                </ScrollView>
              </Match>
            </Switch>
          }
        >
          <CodeEditorPhase0Editor
            path={path()!}
            value={editor.draft}
            revision={editor.revision}
            dirty={editor.dirty}
            language={editorLanguage()}
            onOpenPath={openLfcodeEditorPath}
            onCommandHandle={setCommandHandle}
            onSave={() => saveEditor("manual")}
            onInput={(value) => {
              updateEditor({ draft: value, dirty: true, saveError: undefined })
            }}
          />
        </Show>
      </div>
    </Tabs.Content>
  )
}

function toAbsoluteSessionPath(directory: string, path: string) {
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path)) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path.replace(/^[\\/]+/, "")}`
}
