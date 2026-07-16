import { useFilteredList } from "@lfcode-ai/ui/hooks"
import { useSpring } from "@lfcode-ai/ui/motion-spring"
import { createEffect, on, Component, Show, onCleanup, createMemo, createSignal, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useFile } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isPromptEqual,
  Prompt,
  usePrompt,
  type PromptScope,
  ImageAttachmentPart,
  type SelectedTextAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { DockShellForm, DockTray } from "@lfcode-ai/ui/dock-surface"
import { Icon } from "@lfcode-ai/ui/icon"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { useProviders } from "@/hooks/use-providers"
import { useCommand } from "@/context/command"
import { Persist, persisted } from "@/utils/persist"
import { nextPromptFeatures } from "@/utils/prompt-features"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSessionLayout } from "@/pages/session/session-layout"
import { shouldFocusComposerFromPointer } from "@/pages/session/editable-surface"
import { createSessionTabs } from "@/pages/session/helpers"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./prompt-input/editor-dom"
import {
  clearPromptEditor,
  scheduleFocusPromptEditorEnd,
  scheduleRestorePromptEditor,
  setPromptEditorText,
} from "./prompt-input/editor-focus"
import { isNormalizedPromptEditor, parsePromptEditor, renderPromptEditor } from "./prompt-input/editor-parse"
import { getPromptCaretState, getPromptCurrentCursor, shouldBlurPromptOnEscape } from "./prompt-input/editor-selection"
import { createPromptInlineAttachmentNode } from "./prompt-input/editor-nodes"
import { createPromptAttachments } from "./prompt-input/attachments"
import { ACCEPTED_FILE_TYPES } from "./prompt-input/files"
import {
  canNavigateHistoryAtCursor,
  compactPromptHistoryEntries,
  navigatePromptHistory,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryEntry,
  type PromptHistoryStoredEntry,
  promptLength,
} from "./prompt-input/history"
import { collectPromptHistoryComments, restorePromptHistoryComments } from "./prompt-input/history-comments"
import { createPromptSubmit, type FollowupDraft, type FollowupMode } from "./prompt-input/submit"
import { PromptPopover, type AtOption, type AgentOption, type SlashCommand } from "./prompt-input/slash-popover"
import { buildPromptAtOptions } from "./prompt-input/at-options"
import { promptAgentNames, promptAgentOptions, promptSlashCommands } from "./prompt-input/command-options"
import {
  buildPromptInputCommandOptions,
  PROMPT_NORMAL_MODE_KEYBIND,
  PROMPT_SHELL_MODE_KEYBIND,
} from "./prompt-input/mode-commands"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { detectPromptPopover, pickActivePopoverItem } from "./prompt-input/popover-state"
import { promptSlashSelectionResult } from "./prompt-input/slash-selection"
import { isPromptInputBlank, promptInputText, shouldResetPromptInput } from "./prompt-input/state"
import { promptHistoryCursor, shouldResetPromptHistoryNavigation } from "./prompt-input/history-state"
import { PromptGoalBanner } from "./prompt-input/goal-banner"
import { PromptGoalDialog } from "./prompt-input/goal-dialog"
import { recentPromptPaths } from "./prompt-input/recent-paths"
import { PromptControlStrip } from "./prompt-input/control-strip"
import { PromptEditorSurface } from "./prompt-input/editor-surface"
import { createPromptGoalCommandRequest } from "./prompt-input/goal-command"
import {
  promptCommentCount,
  promptControlStyle,
  promptFeatureItems,
  promptMotion,
  promptVisibleContextItems,
  sessionHasUserPrompt,
} from "./prompt-input/view-state"
import { ImagePreview } from "@lfcode-ai/ui/image-preview"
import { useQueries } from "@tanstack/solid-query"
import { loadAgentsQuery, loadProvidersQuery } from "@/context/global-sync/bootstrap"
import { isSessionStreaming, isSessionWaiting } from "@/utils/session-status"
import { formatGoalElapsed, formatGoalTokens, goalElapsedMs, goalStatusText } from "./prompt-input/goal-helpers"
import { displayModelVariant } from "@/context/model-variant"

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
  suspendUntilReady?: boolean
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"] }
  onEditLoaded?: () => void
  followupMode?: () => FollowupMode | undefined
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  scope?: PromptScope
  dropRoot?: () => HTMLElement | undefined
}

const EXAMPLES = [
  "prompt.example.1",
  "prompt.example.2",
  "prompt.example.3",
  "prompt.example.4",
  "prompt.example.5",
  "prompt.example.6",
  "prompt.example.7",
  "prompt.example.8",
  "prompt.example.9",
  "prompt.example.10",
  "prompt.example.11",
  "prompt.example.12",
  "prompt.example.13",
  "prompt.example.14",
  "prompt.example.15",
  "prompt.example.16",
  "prompt.example.17",
  "prompt.example.18",
  "prompt.example.19",
  "prompt.example.20",
  "prompt.example.21",
  "prompt.example.22",
  "prompt.example.23",
  "prompt.example.24",
  "prompt.example.25",
] as const

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()

  const sync = useSync()
  const local = useLocal()
  const files = useFile()
  const promptContext = usePrompt()
  const layout = useLayout()
  const comments = useComments()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  const platform = usePlatform()
  const { params, tabs, view } = useSessionLayout()
  const prompt = {
    ready: () => promptContext.scope(props.scope).ready,
    current: () => promptContext.scope(props.scope).current(),
    cursor: () => promptContext.scope(props.scope).cursor(),
    dirty: () => promptContext.scope(props.scope).dirty(),
    context: {
      items: () => promptContext.scope(props.scope).context.items(),
      add: (item: Parameters<typeof promptContext.context.add>[0]) =>
        promptContext.scope(props.scope).context.add(item),
      remove: (key: string) => promptContext.scope(props.scope).context.remove(key),
      removeComment: (path: string, commentID: string) =>
        promptContext.scope(props.scope).context.removeComment(path, commentID),
      updateComment: (
        path: string,
        commentID: string,
        next: Parameters<typeof promptContext.context.updateComment>[2],
      ) => promptContext.scope(props.scope).context.updateComment(path, commentID, next),
      replaceComments: (items: Parameters<typeof promptContext.context.replaceComments>[0]) =>
        promptContext.scope(props.scope).context.replaceComments(items),
    },
    set: (next: Prompt, cursorPosition?: number) => promptContext.scope(props.scope).set(next, cursorPosition),
    reset: () => promptContext.scope(props.scope).reset(),
  }
  const sessionID = createMemo(() => props.scope?.id ?? params.id)
  const sessionDirectory = createMemo(() => props.scope?.dir ?? sdk.directory)
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let formRef: HTMLFormElement | undefined
  let composerRef!: HTMLDivElement
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement

  const mirror = { input: false }
  const inset = 24
  const space = `${inset}px`

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const cursor = getCursorPosition(editorRef)
    const length = promptLength(prompt.current().filter((part) => part.type !== "image"))
    if (cursor >= length) {
      container.scrollTop = container.scrollHeight
      return
    }

    const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - inset) {
      container.scrollTop = bottom - container.clientHeight + inset
    }
  }

  const queueScroll = (count = 2) => {
    requestAnimationFrame(() => {
      scrollCursorIntoView()
      if (count > 1) queueScroll(count - 1)
    })
  }

  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: files.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? files.tab(tab) : tab),
  }).activeFileTab

  const commentInReview = (path: string) => {
    const currentSessionID = sessionID()
    if (!currentSessionID) return false

    const diffs = sync.data.session_diff[currentSessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return

    const focus = { file: item.path, id: item.commentID }
    comments.setActive(focus)

    const queueCommentFocus = (attempts = 6) => {
      const schedule = (left: number) => {
        requestAnimationFrame(() => {
          comments.setFocus({ ...focus })
          if (left <= 0) return
          requestAnimationFrame(() => {
            const current = comments.focus()
            if (!current) return
            if (current.file !== focus.file || current.id !== focus.id) return
            schedule(left - 1)
          })
        })
      }

      schedule(attempts)
    }

    const wantsReview = item.commentOrigin === "review" || (item.commentOrigin !== "file" && commentInReview(item.path))
    if (wantsReview) {
      view().setReviewEnabled(true)
      if (!view().reviewPanel.opened()) view().reviewPanel.open()
      layout.fileTree.setTab("changes")
      tabs().setActive("review")
      queueCommentFocus()
      return
    }

    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    const tab = files.tab(item.path)
    void tabs().open(tab)
    tabs().setActive(tab)
    void Promise.resolve(files.load(item.path)).finally(() => queueCommentFocus())
  }

  const recent = createMemo(() => {
    return recentPromptPaths(tabs().all(), activeFileTab(), files.pathFromTab)
  })
  const info = createMemo(() => (sessionID() ? sync.session.get(sessionID()!) : undefined))
  const status = createMemo(
    () =>
      sync.data.session_status[sessionID() ?? ""] ?? {
        type: "idle",
      },
  )
  const streaming = createMemo(() => isSessionStreaming(status()))
  const waiting = createMemo(() => isSessionWaiting(status()))
  const sessionGoal = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.data.session_goal[id]
  })
  const goalState = createMemo(() => sessionGoal()?.state)
  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )
  const selectedTextAttachments = createMemo(() =>
    prompt.current().filter((part): part is SelectedTextAttachmentPart => part.type === "selected-text"),
  )
  const visiblePromptParts = createMemo(() =>
    prompt.current().filter((part) => part.type !== "image" && part.type !== "selected-text"),
  )

  const [store, setStore] = createStore<{
    popover: "at" | "agent" | "slash" | null
    historyIndex: number
    savedPrompt: PromptHistoryEntry | null
    placeholder: number
    draggingType: "image" | "@mention" | null
    mode: "normal" | "shell"
    applyingHistory: boolean
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null as PromptHistoryEntry | null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
  })
  const [goalDraft, setGoalDraft] = createSignal("")
  const [goalSaving, setGoalSaving] = createSignal(false)
  const [goalNow, setGoalNow] = createSignal(Date.now())

  const goalStatusLabel = createMemo(() => goalStatusText(goalState()?.status))
  const goalElapsedLabel = createMemo(() => formatGoalElapsed(goalElapsedMs(goalState(), goalNow())))

  const openGoalDialog = (mode: "create" | "edit") => {
    const current = goalState()
    setGoalDraft(mode === "edit" ? (current?.objective ?? current?.condition ?? "") : "")
    dialog.show(() => (
      <PromptGoalDialog
        mode={mode}
        value={goalDraft()}
        saving={goalSaving()}
        cancelLabel={language.t("common.cancel")}
        saveLabel={language.t("common.save")}
        onInput={setGoalDraft}
        onCancel={() => dialog.close()}
        onSave={() => {
          const request = createPromptGoalCommandRequest({
            sessionID: sessionID(),
            arguments: goalDraft().trim(),
            agent: local.agent.current(),
            model: local.model.current(),
            variant: local.model.variant.current(),
          })
          if (!request) return
          setGoalSaving(true)
          void sdk.client.session
            .command(request)
            .then(() => {
              dialog.close()
              restoreFocus()
            })
            .finally(() => setGoalSaving(false))
        }}
      />
    ))
  }

  const runGoalCommand = (commandName: string) => {
    const request = createPromptGoalCommandRequest({
      sessionID: sessionID(),
      arguments: commandName,
      agent: local.agent.current(),
      model: local.model.current(),
      variant: local.model.variant.current(),
    })
    if (!request) return
    void sdk.client.session.command(request)
  }

  const buttonsSpring = useSpring(() => (store.mode === "normal" ? 1 : 0), { visualDuration: 0.2, bounce: 0 })
  const buttons = createMemo(() => promptMotion(buttonsSpring()))
  const shell = createMemo(() => promptMotion(1 - buttonsSpring()))
  const control = createMemo(() => promptControlStyle(buttonsSpring()))

  const commentCount = createMemo(() => promptCommentCount(store.mode, prompt.context.items()))
  const blank = createMemo(() =>
    isPromptInputBlank({
      prompt: prompt.current(),
      imageCount: imageAttachments().length,
      commentCount: commentCount(),
      selectedTextCount: selectedTextAttachments().length,
    }),
  )
  const stopping = createMemo(() => streaming() && blank())
  const tip = () => {
    if (stopping()) {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.stop")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
        </div>
      )
    }

    return (
      <div class="flex items-center gap-2">
        <span>{language.t("prompt.action.send")}</span>
        <Icon name="enter" size="small" class="text-icon-base" />
      </div>
    )
  }

  const contextItems = createMemo(() => promptVisibleContextItems(store.mode, prompt.context.items()))

  const hasUserPrompt = createMemo(() => {
    const currentSessionID = sessionID()
    if (!currentSessionID) return false
    return sessionHasUserPrompt(sync.data.message[currentSessionID])
  })

  const [history, setHistory] = persisted(
    Persist.global("prompt-history", ["prompt-history.v1"]),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )
  const [shellHistory, setShellHistory] = persisted(
    Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )

  createEffect(
    on(
      () => history.entries,
      (entries) => {
        const next = compactPromptHistoryEntries(entries)
        if (next === entries) return
        setHistory("entries", next)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => shellHistory.entries,
      (entries) => {
        const next = compactPromptHistoryEntries(entries)
        if (next === entries) return
        setShellHistory("entries", next)
      },
      { defer: true },
    ),
  )

  const suggest = createMemo(() => !hasUserPrompt())

  const placeholder = createMemo(() =>
    promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? language.t(EXAMPLES[store.placeholder]) : "",
      suggest: suggest(),
      t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params as never),
    }),
  )

  const historyComments = () => {
    return collectPromptHistoryComments(prompt.context.items(), comments.all())
  }
  const requestSubmitPrompt = () => formRef?.requestSubmit()

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    const restored = restorePromptHistoryComments(items)
    comments.replace(restored.comments)
    prompt.context.replaceComments(restored.contextItems)
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = promptHistoryCursor(position, promptLength(p))
    setStore("applyingHistory", true)
    applyHistoryComments(entry.comments)
    prompt.set(p, length)
    scheduleRestorePromptEditor(editorRef, length, () => {
      setStore("applyingHistory", false)
      queueScroll()
    })
  }

  const getCaretState = () => {
    return getPromptCaretState(editorRef, promptLength(prompt.current()))
  }

  const escBlur = () => shouldBlurPromptOnEscape(platform.platform, platform.os)

  const pick = () => fileInputRef?.click()

  const setMode = (mode: "normal" | "shell") => {
    setStore("mode", mode)
    setStore("popover", null)
    editorRef?.focus()
  }

  const shellModeKey = PROMPT_SHELL_MODE_KEYBIND
  const normalModeKey = PROMPT_NORMAL_MODE_KEYBIND

  if (!props.scope) {
    command.register("prompt-input", () =>
      buildPromptInputCommandOptions({
        normalMode: store.mode === "normal",
        t: (key) => language.t(key as Parameters<typeof language.t>[0]),
        onAttach: pick,
        onShellMode: () => setMode("shell"),
        onNormalMode: () => setMode("normal"),
      }),
    )
  }

  const closePopover = () => setStore("popover", null)

  const resetHistoryNavigation = (force = false) => {
    if (
      !shouldResetPromptHistoryNavigation({
        force,
        historyIndex: store.historyIndex,
        applyingHistory: store.applyingHistory,
      })
    )
      return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
  }

  const clearEditor = () => clearPromptEditor(editorRef)

  const setEditorText = (text: string) => setPromptEditorText(editorRef, text)

  const focusEditorEnd = () => scheduleFocusPromptEditorEnd(editorRef)

  const focusComposerFromPointer = (event: PointerEvent) => {
    if (event.button !== 0 || !shouldFocusComposerFromPointer({ target: event.target, composer: composerRef })) return
    editorRef.focus({ preventScroll: true })
    setCursorPosition(editorRef, prompt.cursor() ?? promptLength(prompt.current()))
  }

  const currentCursor = () => {
    return getPromptCurrentCursor(editorRef)
  }

  const restoreFocus = () => {
    scheduleRestorePromptEditor(editorRef, prompt.cursor() ?? promptLength(prompt.current()), () => {
      queueScroll()
    })
  }

  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor()
    renderPromptEditor(editorRef, parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  createEffect(() => {
    sessionID()
    if (sessionID()) return
    if (!suggest()) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(() => {
    const state = goalState()
    if (state?.status !== "active" || !state.stats?.activeSince) return
    setGoalNow(Date.now())
    const interval = setInterval(() => {
      setGoalNow(Date.now())
    }, 30_000)
    onCleanup(() => clearInterval(interval))
  })

  const [composing, setComposing] = createSignal(false)
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229

  const handleBlur = () => {
    closePopover()
    setComposing(false)
  }

  const handleCompositionStart = () => {
    setComposing(true)
  }

  const handleCompositionEnd = () => {
    setComposing(false)
    requestAnimationFrame(() => {
      if (composing()) return
      reconcile(visiblePromptParts())
    })
  }

  const agentList = createMemo(() => promptAgentOptions(sync.data.agent))
  const agentNames = createMemo(() => promptAgentNames(local.agent.list()))

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
  }

  const atKey = (x: AtOption | undefined) => (x ? `file:${x.path}` : "")

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      return buildPromptAtOptions(recent(), query, await files.searchFilesAndDirectories(query))
    },
    key: atKey,
    filterKeys: ["display"],
    groupBy: (item) => (item.recent ? "recent" : "file"),
    sortGroupsBy: (a, b) => (a.category === "recent" ? 0 : 1) - (b.category === "recent" ? 0 : 1),
    onSelect: handleAtSelect,
  })

  const handleAgentSelect = (option: AgentOption | undefined) => {
    if (!option) return
    addPart({ type: "agent", name: option.name, content: "$" + option.name, start: 0, end: 0 })
  }

  const agentKey = (x: AgentOption | undefined) => (x ? `agent:${x.name}` : "")

  const {
    flat: agentFlat,
    active: agentActive,
    setActive: setAgentActive,
    onInput: agentOnInput,
    onKeyDown: agentOnKeyDown,
  } = useFilteredList<AgentOption>({
    items: () => agentList(),
    key: agentKey,
    filterKeys: ["display"],
    onSelect: handleAgentSelect,
  })

  const slashCommands = createMemo<SlashCommand[]>(() => promptSlashCommands(command.options, sync.data.command))

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    closePopover()
    const result = promptSlashSelectionResult(cmd, DEFAULT_PROMPT, imageAttachments())

    if (result.kind === "custom") {
      setEditorText(result.text)
      prompt.set(result.prompt, result.cursor)
      focusEditorEnd()
      return
    }

    clearEditor()
    prompt.set(result.prompt, 0)
    command.trigger(result.commandID, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title"],
    onSelect: handleSlashSelect,
  })

  // Auto-scroll active command into view when navigating with keyboard
  createEffect(() => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })
  const selectPopoverActive = () => {
    if (store.popover === "at") {
      const item = pickActivePopoverItem(atFlat(), atActive(), atKey)
      if (!item) return
      handleAtSelect(item)
      return
    }

    if (store.popover === "agent") {
      const item = pickActivePopoverItem(agentFlat(), agentActive(), agentKey)
      if (!item) return
      handleAgentSelect(item)
      return
    }

    if (store.popover === "slash") {
      const item = pickActivePopoverItem(slashFlat(), slashActive(), (entry) => entry.id)
      if (!item) return
      handleSlashSelect(item)
    }
  }

  const reconcile = (input: Prompt) => {
    if (mirror.input) {
      mirror.input = false
      if (isNormalizedPromptEditor(editorRef) && isPromptEqual(input, parsePromptEditor(editorRef))) return

      renderEditorWithCursor(input)
      return
    }

    const dom = parsePromptEditor(editorRef)
    if (isNormalizedPromptEditor(editorRef) && isPromptEqual(input, dom)) return

    renderEditorWithCursor(input)
  }

  createEffect(
    on(
      () => prompt.current(),
      (parts) => {
        if (composing()) return
        reconcile(parts.filter((part) => part.type !== "image" && part.type !== "selected-text"))
      },
    ),
  )

  const handleInput = () => {
    const rawParts = parsePromptEditor(editorRef)
    const images = imageAttachments()
    const selectedText = selectedTextAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text" ? rawParts[0].content : promptInputText(rawParts)
    const shouldReset = shouldResetPromptInput({
      prompt: rawParts,
      imageCount: images.length,
      selectedTextCount: selectedText.length,
    })

    if (shouldReset) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        mirror.input = true
        prompt.set(DEFAULT_PROMPT, 0)
      }
      queueScroll()
      return
    }

    const popover = detectPromptPopover({ mode: store.mode, rawText, cursorPosition })
    if (popover.popover === "agent") {
      agentOnInput(popover.query ?? "")
      setStore("popover", "agent")
    } else if (popover.popover === "at") {
      atOnInput(popover.query ?? "")
      setStore("popover", "at")
    } else if (popover.popover === "slash") {
      slashOnInput(popover.query ?? "")
      setStore("popover", "slash")
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    mirror.input = true
    prompt.set([...rawParts, ...selectedText, ...images], cursorPosition)
    queueScroll()
  }

  const addPart = (part: ContentPart) => {
    if (part.type === "image") return false

    const selection = window.getSelection()
    if (!selection) return false

    if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
      editorRef.focus()
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      setCursorPosition(editorRef, cursor)
    }

    if (selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return false

    if (
      part.type === "file" ||
      part.type === "agent" ||
      part.type === "selected-text" ||
      part.type === "web-reference"
    ) {
      const cursorPosition = getCursorPosition(editorRef)
      const rawText = prompt
        .current()
        .map((p) => ("content" in p ? p.content : ""))
        .join("")
      const textBeforeCursor = rawText.substring(0, cursorPosition)
      const triggerMatch =
        part.type === "agent"
          ? textBeforeCursor.match(/\$(\S*)$/)
          : part.type === "file"
            ? textBeforeCursor.match(/@(\S*)$/)
            : null
      const pill = createPromptInlineAttachmentNode(part)
      const gap = document.createTextNode(" ")

      if (triggerMatch) {
        const start = triggerMatch.index ?? cursorPosition - triggerMatch[0].length
        setRangeEdge(editorRef, range, "start", start)
        setRangeEdge(editorRef, range, "end", cursorPosition)
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    if (part.type === "text") {
      const fragment = createTextFragment(part.content)
      const last = fragment.lastChild
      range.deleteContents()
      range.insertNode(fragment)
      if (last) {
        if (last.nodeType === Node.TEXT_NODE) {
          const text = last.textContent ?? ""
          if (text === "\u200B") {
            range.setStart(last, 0)
          }
          if (text !== "\u200B") {
            range.setStart(last, text.length)
          }
        }
        if (last.nodeType !== Node.TEXT_NODE) {
          const isBreak = last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR"
          const next = last.nextSibling
          const emptyText = next?.nodeType === Node.TEXT_NODE && (next.textContent ?? "") === ""
          if (isBreak && (!next || emptyText)) {
            const placeholder = next && emptyText ? next : document.createTextNode("\u200B")
            if (!next) last.parentNode?.insertBefore(placeholder, null)
            placeholder.textContent = "\u200B"
            range.setStart(placeholder, 0)
          } else {
            range.setStartAfter(last)
          }
        }
      }
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    closePopover()
    return true
  }

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const next = prependHistoryEntry(currentHistory.entries, prompt, mode === "shell" ? [] : historyComments())
    if (next === currentHistory.entries) return
    setCurrentHistory("entries", next)
  }

  createEffect(
    on(
      () => props.edit?.id,
      (id) => {
        const edit = props.edit
        if (!id || !edit) return

        for (const item of prompt.context.items()) {
          prompt.context.remove(item.key)
        }

        for (const item of edit.context) {
          prompt.context.add({
            type: item.type,
            path: item.path,
            selection: item.selection,
            comment: item.comment,
            commentID: item.commentID,
            commentOrigin: item.commentOrigin,
            preview: item.preview,
          })
        }

        setStore("mode", "normal")
        setStore("popover", null)
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
        prompt.set(edit.prompt, promptLength(edit.prompt))
        requestAnimationFrame(() => {
          editorRef.focus()
          setCursorPosition(editorRef, promptLength(edit.prompt))
          queueScroll()
        })
        props.onEditLoaded?.()
      },
      { defer: true },
    ),
  )

  const navigateHistory = (direction: "up" | "down") => {
    const result = navigatePromptHistory({
      direction,
      entries: store.mode === "shell" ? shellHistory.entries : history.entries,
      historyIndex: store.historyIndex,
      currentPrompt: prompt.current(),
      currentComments: historyComments(),
      savedPrompt: store.savedPrompt,
    })
    if (!result.handled) return false
    setStore("historyIndex", result.historyIndex)
    setStore("savedPrompt", result.savedPrompt)
    applyHistoryPrompt(result.entry, result.cursor)
    return true
  }

  const { addAttachments, removeAttachment, handlePaste } = createPromptAttachments({
    scope: () => props.scope,
    root: () => props.dropRoot?.() ?? composerRef,
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
    currentPrompt: (scope) => promptContext.scope(scope).current(),
    currentCursor: (scope) => promptContext.scope(scope).cursor(),
    setPrompt: (next, cursorPosition, scope) => promptContext.set(next, cursorPosition, scope),
    readClipboardImage: platform.readClipboardImage,
    getPathForFile: platform.getPathForFile,
    readDroppedImage: platform.readDroppedImage,
    onNativeFileTransfer: platform.onNativeFileTransfer,
  })

  const promptFeatureMenuItems = createMemo(() =>
    promptFeatureItems(local.promptFeatures.current(), (key) => language.t(key as Parameters<typeof language.t>[0])),
  )
  const accepting = createMemo(() => {
    const id = sessionID()
    if (!id) return permission.isAutoAcceptingDirectory(sessionDirectory())
    return permission.isAutoAccepting(id, sessionDirectory())
  })

  const { abort, handleSubmit } = createPromptSubmit({
    info,
    imageAttachments,
    commentCount,
    selectedTextCount: () => selectedTextAttachments().length,
    autoAccept: () => accepting(),
    mode: () => store.mode,
    streaming,
    editor: () => editorRef,
    queueScroll,
    promptLength,
    addToHistory,
    resetHistoryNavigation: () => {
      resetHistoryNavigation(true)
    },
    setMode: (mode) => setStore("mode", mode),
    setPopover: (popover) => setStore("popover", popover),
    scope: () => props.scope,
    newSessionWorktree: () => props.newSessionWorktree,
    onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
    followupMode: props.followupMode,
    onQueue: props.onQueue,
    onAbort: props.onAbort,
    onSubmit: props.onSubmit,
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (store.mode !== "normal") return
      pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "!" && store.mode === "normal") {
      const cursorPosition = getCursorPosition(editorRef)
      if (cursorPosition === 0) {
        setStore("mode", "shell")
        setStore("popover", null)
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (store.mode === "shell") {
        setStore("mode", "normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (streaming()) {
        void abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (escBlur()) {
        editorRef.blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (store.mode === "shell") {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        setStore("mode", "normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "agent") {
          agentOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        return
      }
      if (streaming()) {
        void abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, store.historyIndex >= 0)) return
      if (navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      const ctrlEnter = event.ctrlKey && !event.metaKey && !event.altKey
      if (streaming() && blank()) {
        return
      }
      void handleSubmit(event, { invertFollowupMode: ctrlEnter })
    }
  }

  const [agentsQuery, globalProvidersQuery, providersQuery] = useQueries(() => ({
    queries: [loadAgentsQuery(sdk.directory), loadProvidersQuery(null), loadProvidersQuery(sdk.directory)],
  }))

  const agentsLoading = () => agentsQuery.isLoading
  const providersLoading = () => agentsLoading() || providersQuery.isLoading || globalProvidersQuery.isLoading
  const displayedVariant = createMemo(() =>
    displayModelVariant({
      variants: local.model.variant.list(),
      selected: local.model.variant.selected(),
      configured: local.model.variant.configured(),
    }),
  )
  const currentQuestionGuidanceLabel = createMemo(() =>
    language.t(`prompt.questionGuidance.${local.questionGuidance.current()}` as Parameters<typeof language.t>[0]),
  )
  const currentModelLabel = createMemo(() =>
    [
      local.model.current()?.name ?? "",
      displayedVariant() && displayedVariant() !== "default" ? displayedVariant() : undefined,
      currentQuestionGuidanceLabel(),
    ]
      .filter((value) => !!value)
      .join(" · "),
  )

  const [promptReady] = createResource(
    () => prompt.ready().promise,
    (p) => p,
  )

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-0">
      <Show when={props.suspendUntilReady !== false}>{(promptReady(), null)}</Show>
      <Show when={goalState()}>
        {(goal) => (
          <PromptGoalBanner
            objective={goal().objective}
            condition={goal().condition}
            statusLabel={goalStatusLabel()}
            tokensLabel={`${formatGoalTokens(goal())} tokens`}
            elapsedLabel={goalElapsedLabel()}
            editLabel={language.t("common.edit")}
            deleteLabel={language.t("common.delete")}
            paused={goal().status === "paused"}
            onEdit={() => openGoalDialog("edit")}
            onPause={() => runGoalCommand("pause")}
            onResume={() => runGoalCommand("resume")}
            onDelete={() => runGoalCommand("delete")}
          />
        )}
      </Show>
      <PromptPopover
        popover={store.popover}
        setSlashPopoverRef={(el) => (slashPopoverRef = el)}
        atFlat={atFlat()}
        atActive={atActive() ?? undefined}
        atKey={atKey}
        setAtActive={setAtActive}
        onAtSelect={handleAtSelect}
        agentFlat={agentFlat()}
        agentActive={agentActive() ?? undefined}
        agentKey={agentKey}
        setAgentActive={setAgentActive}
        onAgentSelect={handleAgentSelect}
        slashFlat={slashFlat()}
        slashActive={slashActive() ?? undefined}
        setSlashActive={setSlashActive}
        onSlashSelect={handleSlashSelect}
        commandKeybind={command.keybind}
        t={(key) => language.t(key as Parameters<typeof language.t>[0])}
      />
      <div
        ref={(el) => (composerRef = el)}
        data-prompt-composer="true"
        data-editable-surface="composer"
        onPointerDown={focusComposerFromPointer}
        onPaste={handlePaste}
        classList={{
          "group/prompt-input": true,
          "border-icon-info-active border-dashed": store.draggingType !== null,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <DockShellForm ref={(el) => (formRef = el)} onSubmit={handleSubmit}>
          <PromptEditorSurface
            dragType={store.draggingType}
            dragLabel={language.t(
              store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label",
            )}
            selectedTextItems={selectedTextAttachments()}
            onRemoveSelectedText={(item) => {
              const next = prompt.current().filter((part) => part !== item)
              prompt.set(next, prompt.cursor())
            }}
            contextItems={contextItems()}
            contextItemActive={(item) => {
              const active = comments.active()
              return !!item.commentID && item.commentID === active?.id && item.path === active?.file
            }}
            onOpenContextComment={openComment}
            onRemoveContextItem={(item) => {
              if (item.commentID) comments.remove(item.path, item.commentID)
              prompt.context.remove(item.key)
            }}
            t={(key) => language.t(key as Parameters<typeof language.t>[0])}
            imageAttachments={imageAttachments()}
            onOpenImage={(attachment) =>
              dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
            }
            onRemoveImage={removeAttachment}
            imageRemoveLabel={language.t("prompt.attachment.remove")}
            setScrollRef={(el) => (scrollRef = el)}
            scrollPaddingBottom={space}
            setEditorRef={(el) => {
              editorRef = el
              props.ref?.(el)
            }}
            editorLabel={placeholder()}
            autocapitalize={store.mode === "normal" ? "sentences" : "off"}
            autocorrect={store.mode === "normal" ? "on" : "off"}
            spellcheck={store.mode === "normal"}
            onInput={handleInput}
            onPaste={handlePaste}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            editorClassList={{
              "select-text": true,
              "w-full pl-3 pr-2 pt-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
              "[&_[data-type=file]]:text-syntax-property": true,
              "[&_[data-type=agent]]:text-syntax-type": true,
              "font-mono!": store.mode === "shell",
            }}
            editorStyle={{ "padding-bottom": space }}
            placeholder={placeholder()}
            placeholderClassList={{ "font-mono!": store.mode === "shell" }}
            placeholderStyle={{ "padding-bottom": space }}
            placeholderHidden={prompt.dirty()}
            actionBar={{
              waiting: waiting() && store.mode === "normal",
              waitingTitle: language.t("prompt.waiting.title"),
              waitingDescription: language.t("prompt.waiting.description"),
              waitingEndLabel: language.t("prompt.waiting.end"),
              onWaitingEnd: () => void abort({ pauseQueue: false, clearTodo: false }),
              inputRef: (el) => (fileInputRef = el),
              accept: ACCEPTED_FILE_TYPES.join(","),
              onFilesSelected: (files) => void addAttachments(Array.from(files)),
            }}
          />
        </DockShellForm>
        <Show when={store.mode === "normal" || store.mode === "shell"}>
          <DockTray attach="top" style={{ "z-index": 20 }}>
            <PromptControlStrip
              shellMode={store.mode === "shell"}
              shellLabel={language.t("prompt.mode.shell")}
              shellStyle={shell()}
              controlStyle={control()}
              agentsLoading={agentsLoading()}
              agentCycleTitle={language.t("command.agent.cycle")}
              agentCycleKeybind={command.keybind("agent.cycle")}
              agentNames={agentNames()}
              currentAgent={local.agent.current()?.name ?? ""}
              onAgentSelect={(value) => {
                local.agent.set(value)
                restoreFocus()
              }}
              providersLoading={providersLoading()}
              paidProviderCount={providers.paid().length}
              modelChooseTitle={language.t("command.model.choose")}
              modelChooseKeybind={command.keybind("model.choose")}
              model={local.model}
              currentModelProviderID={local.model.current()?.provider?.id}
              currentModelLabel={currentModelLabel()}
              selectModelTitle={language.t("dialog.model.select.title")}
              onSelectUnpaidModel={() => {
                void import("@/components/dialog-select-model-unpaid").then((x) => {
                  dialog.show(() => <x.DialogSelectModelUnpaid model={local.model} />)
                })
              }}
              onModelClose={restoreFocus}
              submitTooltip={tip()}
              submitTooltipInactive={!streaming() && blank()}
              submitDisabled={store.mode !== "normal" || (!streaming() && blank())}
              submitLabel={language.t("prompt.action.send")}
              stopLabel={language.t("prompt.action.stop")}
              stopping={stopping()}
              submitStyle={buttons()}
              moreDisabled={store.mode !== "normal"}
              moreTabIndex={store.mode === "normal" ? undefined : -1}
              moreLabel={language.t("prompt.more")}
              onSubmit={requestSubmitPrompt}
              hasGoal={!!goalState()}
              goalPaused={goalState()?.status === "paused"}
              features={promptFeatureMenuItems()}
              onGoalOpen={() => openGoalDialog(goalState() ? "edit" : "create")}
              onGoalPauseToggle={() => runGoalCommand(goalState()?.status === "paused" ? "resume" : "pause")}
              onGoalDelete={() => runGoalCommand("delete")}
              onFeatureChange={(feature, checked) => {
                local.promptFeatures.set(nextPromptFeatures(local.promptFeatures.current(), feature, checked))
                restoreFocus()
              }}
            />
          </DockTray>
        </Show>
      </div>
    </div>
  )
}
