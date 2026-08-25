import { useFilteredList } from "@lfcode-ai/ui/hooks"
import { useSpring } from "@lfcode-ai/ui/motion-spring"
import { createEffect, on, Component, For, Show, onCleanup, createMemo, createSignal, createResource } from "solid-js"
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
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useComments } from "@/context/comments"
import { DockShellForm, DockTray } from "@lfcode-ai/ui/dock-surface"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton, type IconButtonProps } from "@lfcode-ai/ui/icon-button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { showToast } from "@lfcode-ai/ui/toast"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
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
import { startVisiblePolling } from "@/utils/visible-poll"
import { isSessionStreaming, isSessionWaiting } from "@/utils/session-status"
import { formatGoalElapsed, formatGoalTokens, goalElapsedMs, goalStatusText } from "./prompt-input/goal-helpers"
import { displayModelVariant } from "@/context/model-variant"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { requestScheduledAutomation } from "@/automation/scheduled-task"
import type { ExternalAgentPrompt } from "./prompt-input/external-agent"

export type ExternalAgentControl = {
  id: string
  group: "model" | "permissions"
  kind: "input" | "key"
  icon: IconButtonProps["icon"]
  label: string
  shortcut: string
  data: string
  selected?: boolean
  disabled?: boolean
  permissionMode?: "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions"
}

interface PromptInputProps {
  class?: string
  presentation?: "plugin-conversation" | "external-agent"
  placeholder?: string
  submitLabel?: string
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
  externalSubmit?: (input: ExternalAgentPrompt) => Promise<void>
  externalSubmitDisabled?: () => boolean
  externalSubmitDisabledMessage?: () => string | undefined
  externalImageUnsupported?: { title: string; description: string }
  externalAgentLabel?: string
  externalControls?: ExternalAgentControl[]
  externalControlSubmit?: (control: ExternalAgentControl) => Promise<void>
}

type TavernCharacter = {
  id: string
  name: string
  prompt: string
  firstMessage?: string
  alternateGreetings?: string[]
  avatar?: string
  tags?: string[]
  worldbookIDs: string[]
}
type TavernWorldbook = { id: string; name: string; content: string }
type TavernData = {
  characters: TavernCharacter[]
  worldbooks: TavernWorldbook[]
  sessions?: Record<string, { characterID: string; worldbookIDs: string[] }>
  settings?: { storyPrediction?: boolean }
} & Record<string, unknown>

function normalizeTavernData(value: unknown): TavernData {
  if (!value || typeof value !== "object") return { characters: [], worldbooks: [] }
  const data = value as Partial<TavernData>
  return {
    ...data,
    characters: Array.isArray(data.characters) ? data.characters : [],
    worldbooks: Array.isArray(data.worldbooks) ? data.worldbooks : [],
  }
}

function tavernWorldbookPrompt(worldbook: TavernWorldbook, context: string) {
  try {
    const parsed: unknown = JSON.parse(worldbook.content)
    if (!parsed || typeof parsed !== "object") return worldbook.content
    const entries = "entries" in parsed ? parsed.entries : undefined
    const list = Array.isArray(entries) ? entries : entries && typeof entries === "object" ? Object.values(entries) : []
    const matched = list
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .filter((entry) => entry.disable !== true && entry.enabled !== false)
      .filter((entry) => {
        if (entry.constant === true) return true
        const keys = [entry.key, entry.keysecondary, entry.keys, entry.secondary_keys]
          .flatMap((value) => (Array.isArray(value) ? value : []))
          .filter((value): value is string => typeof value === "string" && !!value.trim())
        return keys.some((key) => context.toLocaleLowerCase().includes(key.toLocaleLowerCase()))
      })
      .sort((a, b) => Number(b.order ?? b.insertion_order ?? 0) - Number(a.order ?? a.insertion_order ?? 0))
      .slice(0, 24)
      .map((entry) => (typeof entry.content === "string" ? entry.content : ""))
      .filter(Boolean)
    return matched.length ? matched.join("\n\n") : ""
  } catch {
    return worldbook.content
  }
}

async function tavernFileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let value = ""
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function tavernRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function tavernString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function tavernStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : undefined
}

function tavernCharacterPrompt(data: Record<string, unknown>) {
  return [
    data.description,
    data.personality,
    data.scenario,
    data.mes_example,
    data.system_prompt,
    data.post_history_instructions,
  ]
    .map(tavernString)
    .filter(Boolean)
    .join("\n\n")
}

function tavernStoryHint(character: TavernCharacter | undefined, prompt: string) {
  if (!character) return "先选择角色，再根据角色设定推进当前场景。"
  const premise = character.prompt.split(/[。！？\n]/).find((item) => item.trim())?.trim()
  const context = prompt.trim().replace(/\s+/g, " ").slice(0, 100)
  return [
    `建议让 ${character.name} 对当前信息作出有立场的回应。`,
    premise ? `可延续设定：${premise.slice(0, 72)}` : "可通过行动、提问或环境变化推动情节。",
    context ? `当前线索：${context}` : "发送一段行动或对白开始剧情。",
  ].join(" ")
}

async function tavernCharacterCard(file: File): Promise<Record<string, unknown> | undefined> {
  if (file.name.toLocaleLowerCase().endsWith(".json")) {
    try {
      return tavernRecord(JSON.parse(await file.text()))
    } catch {
      return
    }
  }
  if (!file.name.toLocaleLowerCase().endsWith(".png")) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return
    const type = new TextDecoder("latin1").decode(bytes.slice(offset + 4, offset + 8))
    const chunk = bytes.slice(offset + 8, offset + 8 + length)
    offset = end
    if (type !== "tEXt") continue
    const zero = chunk.indexOf(0)
    if (zero === -1 || new TextDecoder("latin1").decode(chunk.slice(0, zero)) !== "chara") continue
    try {
      return tavernRecord(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(new TextDecoder("latin1").decode(chunk.slice(zero + 1))), (char) => char.charCodeAt(0)))))
    } catch {
      return
    }
  }
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
  const server = useServer()

  const sync = useSync()
  const globalSync = useGlobalSync()
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
  const externalAgent = createMemo(() => !!props.externalSubmit)
  const tavernSession = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    const projectExtension = sync.project?.extension
    if (projectExtension?.pluginID !== "lfcode-tavern" || projectExtension.type !== "tavern") return false
    const extension = sync.session.get(id)?.extension
    return extension?.pluginID === "lfcode-tavern" && extension.type === "tavern"
  })
  const [tavernData, { mutate: setTavernData }] = createResource(
    () => (tavernSession() ? "lfcode-tavern" : undefined),
    async (pluginID) =>
      normalizeTavernData(
        (await sdk.client.plugin.dataGet({ pluginID }).catch(() => ({ data: { value: {} } }))).data?.value,
      ),
  )
  const [tavernCharacterID, setTavernCharacterID] = createSignal<string>()
  const [tavernWorldbookIDs, setTavernWorldbookIDs] = createSignal<string[]>([])
  const selectedTavernCharacter = createMemo(() => tavernData()?.characters.find((item) => item.id === tavernCharacterID()))
  const tavernSelection = createMemo(() => {
    const character = selectedTavernCharacter()
    if (!character) return
    const worldbooks = tavernData()?.worldbooks.filter((item) => tavernWorldbookIDs().includes(item.id)) ?? []
    const context = [character.name, character.prompt, ...prompt.current().map((item) => ("content" in item ? item.content : ""))].join("\n")
    return {
      projectID: sync.project?.id ?? "",
      roleName: character.name,
      system: [
        "你正在进行酒馆角色扮演。不得调用工具、访问文件、执行命令或描述系统内部能力。",
        `当前角色：${character.name}`,
        character.prompt ? `角色设定：${character.prompt}` : "",
        ...worldbooks.map((item) => {
          const content = tavernWorldbookPrompt(item, context)
          return content ? `世界书《${item.name}》：${content}` : ""
        }),
      ]
        .filter(Boolean)
        .join("\n\n"),
    }
  })

  createEffect(() => {
    const data = tavernData()
    if (!data) return
    const saved = sessionID() ? data.sessions?.[sessionID()!] : undefined
    if (saved) {
      if (tavernCharacterID() !== saved.characterID) setTavernCharacterID(saved.characterID)
      if (tavernWorldbookIDs().join(",") !== saved.worldbookIDs.join(",")) setTavernWorldbookIDs(saved.worldbookIDs)
      return
    }
    if (tavernCharacterID()) return
    const character = data.characters[0]
    if (!character) return
    setTavernCharacterID(character.id)
    setTavernWorldbookIDs(character.worldbookIDs)
  })

  const saveTavernData = async (next: TavernData) => {
    setTavernData(next)
    await sdk.client.plugin.dataSet({ pluginID: "lfcode-tavern", pluginData: { value: next } })
  }

  const persistTavernSelection = async (characterID: string | undefined, worldbookIDs: string[]) => {
    const id = sessionID()
    const current = tavernData()
    if (!id || !current || !characterID) return
    const saved = current.sessions?.[id]
    if (saved?.characterID === characterID && saved.worldbookIDs.join(",") === worldbookIDs.join(",")) return
    await saveTavernData({ ...current, sessions: { ...current.sessions, [id]: { characterID, worldbookIDs } } })
  }
  const tavernPrediction = createMemo(() => tavernStoryHint(selectedTavernCharacter(), promptInputText(prompt.current())))

  let tavernCharacterFileInput: HTMLInputElement | undefined
  let tavernWorldbookFileInput: HTMLInputElement | undefined
  const addTavernCharacter = () => tavernCharacterFileInput?.click()
  const addTavernWorldbook = () => tavernWorldbookFileInput?.click()

  const importTavernCharacter = async (file: File) => {
    const stored = await sdk.client.plugin.dataFilePut({
      pluginID: "lfcode-tavern",
      pluginDataFile: { kind: "characters", filename: file.name, base64: await tavernFileBase64(file) },
    })
    const card = await tavernCharacterCard(file)
    if (!card) throw new Error("无法读取角色卡：仅支持 SillyTavern JSON 或 PNG 角色卡")
    const data = tavernRecord(card.data) ?? card
    const name = tavernString(data.name) ?? file.name.replace(/\.[^.]+$/, "")
    const character = {
      id: crypto.randomUUID(),
      name,
      prompt: tavernCharacterPrompt(data),
      firstMessage: tavernString(data.first_mes),
      alternateGreetings: tavernStrings(data.alternate_greetings),
      avatar: stored.data?.path,
      worldbookIDs: [],
    }
    const current = tavernData() ?? { characters: [], worldbooks: [] }
    const next = { ...current, characters: [...current.characters.filter((item) => item.name !== character.name), character] }
    await saveTavernData(next)
    setTavernCharacterID(character.id)
    setTavernWorldbookIDs([])
  }

  const importTavernWorldbook = async (file: File) => {
    if (!file.name.toLocaleLowerCase().endsWith(".json")) throw new Error("世界书必须是 JSON 文件")
    const content = await file.text()
    JSON.parse(content)
    const stored = await sdk.client.plugin.dataFilePut({
      pluginID: "lfcode-tavern",
      pluginDataFile: { kind: "worldbooks", filename: file.name, base64: await tavernFileBase64(file) },
    })
    const worldbook = { id: crypto.randomUUID(), name: file.name.replace(/\.json$/i, ""), content, source: stored.data?.path }
    const current = tavernData() ?? { characters: [], worldbooks: [] }
    await saveTavernData({ ...current, worldbooks: [...current.worldbooks.filter((item) => item.name !== worldbook.name), worldbook] })
  }
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
  const [externalSubmitting, setExternalSubmitting] = createSignal(false)
  const [externalControlSending, setExternalControlSending] = createSignal<string>()
  const [goalDraft, setGoalDraft] = createSignal("")
  const [goalSaving, setGoalSaving] = createSignal(false)
  const [goalNow, setGoalNow] = createSignal(Date.now())

  const runExternalControl = async (control: ExternalAgentControl) => {
    if (!props.externalControlSubmit || props.externalSubmitDisabled?.() || externalControlSending()) return
    setExternalControlSending(control.id)
    try {
      await props.externalControlSubmit(control)
    } catch (cause) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: cause instanceof Error ? cause.message : language.t("common.requestFailed"),
      })
    } finally {
      setExternalControlSending(undefined)
      restoreFocus()
    }
  }

  const interruptExternalAgent = () =>
    runExternalControl({
      id: "interrupt",
      group: "permissions",
      kind: "key",
      icon: "stop",
      label: language.t("claudeCode.control.interrupt"),
      shortcut: "Ctrl+C",
      data: "\u0003",
    })

  const goalStatusLabel = createMemo(() => goalStatusText(goalState()?.status))
  const goalElapsedLabel = createMemo(() => formatGoalElapsed(goalElapsedMs(goalState(), goalNow())))

  const openGoalDialog = (mode: "create" | "edit") => {
    const current = goalState()
    setGoalDraft(mode === "edit" ? (current?.objective ?? current?.condition ?? "") : "")
    void import("./prompt-input/goal-dialog").then((mod) => {
      dialog.show(() => (
        <mod.PromptGoalDialog
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
    })
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
    props.placeholder ??
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

  if (!props.scope && !externalAgent()) {
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
    const stopPolling = startVisiblePolling(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500, { immediate: false })
    onCleanup(stopPolling)
  })

  createEffect(() => {
    const state = goalState()
    if (state?.status !== "active" || !state.stats?.activeSince) return
    setGoalNow(Date.now())
    const stopPolling = startVisiblePolling(() => {
      setGoalNow(Date.now())
    }, 30_000, { immediate: false })
    onCleanup(stopPolling)
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
    if (externalAgent() && popover.popover !== "at") {
      closePopover()
      resetHistoryNavigation()
      mirror.input = true
      prompt.set([...rawParts, ...selectedText, ...images], cursorPosition)
      queueScroll()
      return
    }
    if (popover.popover === "agent") {
      agentOnInput(popover.query ?? "")
      setStore("popover", "agent")
    } else if (popover.popover === "at") {
      atOnInput(popover.query ?? "")
      setStore("popover", "at")
    } else if (popover.popover === "slash") {
      if (!sync.data.command_ready) void globalSync.project.loadCommands(sessionDirectory())
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
    tavernMode: tavernSession,
    tavern: tavernSelection,
    externalSubmit: props.externalSubmit,
    externalSubmitDisabled: props.externalSubmitDisabled,
    externalSubmitDisabledMessage: props.externalSubmitDisabledMessage,
    externalImageUnsupported: props.externalImageUnsupported,
    setExternalSubmitting,
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

    if (!externalAgent() && event.key === "!" && store.mode === "normal") {
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
  const subagentDispatchReferences = createMemo(() => {
    const active = activeFileTab()
    const activePath = active ? files.pathFromTab(active) : undefined
    return [
      ...new Set([
        ...prompt.current().flatMap((part) => (part.type === "file" ? [part.path] : [])),
        ...prompt.context.items().flatMap((item) => (item.type === "file" ? [item.path] : [])),
        ...(activePath ? [activePath] : []),
      ]),
    ]
  })
  const subagentDispatchModels = createMemo(() =>
    local.model
      .list()
      .filter((model) => local.model.visible({ providerID: model.provider.id, modelID: model.id }))
      .map((model) => ({
        providerID: model.provider.id,
        modelID: model.id,
        label: `${model.provider.name} · ${model.name}`,
      })),
  )
  const openSubagentDispatch = () => {
    const id = sessionID()
    if (!id) {
      showToast({
        title: language.t("subagent.dispatch.sessionRequired"),
        description: language.t("subagent.dispatch.sessionRequired"),
      })
      return
    }
    if (!server.current?.http.url) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("subagent.dispatch.connectionMissing"),
      })
      return
    }
    const model = local.model.current()
    void import("./prompt-input/subagent-dispatch-panel").then((mod) => {
      dialog.show(() => (
        <mod.PromptSubagentDispatchPanel
          sessionID={id}
          connection={{
            base: server.current?.http.url,
            directory: sessionDirectory(),
            username: server.current?.http.username,
            password: server.current?.http.password,
          }}
          primaryAgent={local.agent.current()?.name}
          primaryModel={model ? { providerID: model.provider.id, modelID: model.id } : undefined}
          task={promptInputText(prompt.current())}
          contextRefs={subagentDispatchReferences()}
          declaredFiles={subagentDispatchReferences()}
          models={subagentDispatchModels()}
          onClose={() => {
            dialog.close()
            restoreFocus()
          }}
          onDispatched={() => prompt.reset()}
        />
      ))
    })
  }

  const openScheduledAutomation = () => {
    const id = sessionID()
    if (!id) return
    requestScheduledAutomation({
      target: { kind: "session", sessionID: id },
      sourceSessionID: id,
      message: promptInputText(prompt.current()),
    })
  }

  const [promptReady] = createResource(
    () => prompt.ready().promise,
    (p) => p,
  )

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-0">
      <Show when={props.suspendUntilReady !== false}>{(promptReady(), null)}</Show>
      <Show when={!externalAgent()}>
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
      </Show>
      <Show when={!tavernSession() && !externalAgent()}>
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
      </Show>
      <div
        ref={(el) => (composerRef = el)}
        data-prompt-composer="true"
        data-editable-surface="composer"
        onPointerDown={focusComposerFromPointer}
        onPaste={handlePaste}
        classList={{
          "group/prompt-input": true,
          "rounded-xl border border-border-base bg-surface-raised-base shadow-sm": tavernSession(),
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
        <Show when={tavernSession()}>
          <input
            ref={(el) => (tavernCharacterFileInput = el)}
            type="file"
            accept=".json,image/png"
            class="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (file) void importTavernCharacter(file).catch((error) => console.error("[tavern] character import failed", error))
            }}
          />
          <input
            ref={(el) => (tavernWorldbookFileInput = el)}
            type="file"
            accept="application/json,.json"
            class="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (file) void importTavernWorldbook(file).catch((error) => console.error("[tavern] worldbook import failed", error))
            }}
          />
          <DockTray attach="top" style={{ "z-index": 20, "background-color": "transparent", border: "0" }}>
            <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-13-medium text-text-weak">
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <ModelSelectorPopover
                  model={local.model}
                  triggerAs={Button}
                  triggerProps={{ variant: "ghost", size: "small", class: "max-w-44 truncate px-2 text-left" }}
                >
                  {currentModelLabel() || "选择模型 / 思考强度"}
                </ModelSelectorPopover>
                <select
                  class="max-w-32 rounded-md bg-transparent px-2 py-1 text-12-regular text-text-base outline-none hover:bg-surface-base-hover"
                  value={tavernCharacterID() ?? ""}
                  onChange={(event) => {
                    const character = tavernData()?.characters.find((item) => item.id === event.currentTarget.value)
                    setTavernCharacterID(character?.id)
                    setTavernWorldbookIDs(character?.worldbookIDs ?? [])
                    void persistTavernSelection(character?.id, character?.worldbookIDs ?? [])
                  }}
                  aria-label="选择角色"
                >
                  <option value="">选择角色</option>
                  <For each={tavernData()?.characters ?? []}>{(item) => <option value={item.id}>{item.name}</option>}</For>
                </select>
                <button type="button" class="rounded-md px-2 py-1 text-12-regular hover:bg-surface-base-hover" onClick={addTavernCharacter}>
                  新增角色
                </button>
                <select
                  class="max-w-40 rounded-md bg-transparent px-2 py-1 text-12-regular text-text-base outline-none hover:bg-surface-base-hover"
                  value=""
                  onChange={(event) => {
                    const id = event.currentTarget.value
                    if (!id) return
                    const next = tavernWorldbookIDs().includes(id) ? tavernWorldbookIDs().filter((item) => item !== id) : [...tavernWorldbookIDs(), id]
                    setTavernWorldbookIDs(next)
                    void persistTavernSelection(tavernCharacterID(), next)
                    event.currentTarget.value = ""
                  }}
                  aria-label="选择世界书"
                >
                  <option value="">世界书{tavernWorldbookIDs().length ? ` ${tavernWorldbookIDs().length}` : ""}</option>
                  <For each={tavernData()?.worldbooks ?? []}>{(item) => <option value={item.id}>{tavernWorldbookIDs().includes(item.id) ? "移除 " : "加入 "}{item.name}</option>}</For>
                </select>
                <button type="button" class="rounded-md px-2 py-1 text-12-regular hover:bg-surface-base-hover" onClick={addTavernWorldbook}>
                  新增世界书
                </button>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg bg-icon-info-base px-3 py-1.5 text-12-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!streaming() && blank()}
                  onClick={requestSubmitPrompt}
                >
                  {streaming() && blank() ? language.t("prompt.action.stop") : props.submitLabel ?? language.t("prompt.action.send")}
                </button>
              </div>
            </div>
          </DockTray>
          <Show when={tavernData()?.settings?.storyPrediction ?? true}>
            <div class="mx-3 mb-2 rounded-lg border border-border-base bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak">
              <span class="mr-2 text-12-medium text-text-base">剧情预测</span>{tavernPrediction()}
            </div>
          </Show>
        </Show>
        <Show when={externalAgent()}>
          <DockTray attach="top" style={{ "z-index": 20 }}>
            <div data-prompt-control-strip="external-agent" class="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1.5">
              <div class="flex min-w-0 items-center gap-1">
                <span class="min-w-0 truncate px-1.5 font-mono text-12-medium text-text-weak">{props.externalAgentLabel ?? "External agent"}</span>
                <For each={["model", "permissions"] as const}>
                  {(group) => {
                    const controls = () => (props.externalControls ?? []).filter((control) => control.group === group)
                    const selected = () => controls().find((control) => control.selected)
                    const label = () => selected()?.label ?? (group === "model" ? language.t("claudeCode.control.model") : language.t("claudeCode.control.permissions"))
                    const icon = () => (group === "model" ? "models" : "shield")
                    return (
                      <DropdownMenu gutter={6} placement="bottom-start">
                        <DropdownMenu.Trigger
                          as={Button}
                          type="button"
                          variant="ghost"
                          class="h-7 max-w-[min(42vw,220px)] min-w-0 px-2 text-12-medium text-text-weak hover:text-text-base"
                          disabled={!!props.externalSubmitDisabled?.() || !!externalControlSending()}
                          aria-label={label()}
                          data-action={`claude-code-${group}-menu`}
                          data-ui-control-group={group === "permissions" ? "claude-permission-mode" : "claude-model"}
                          data-ui-control-intent={group === "permissions" ? "mode-switch" : "single-selection"}
                          data-ui-control-presentation="dropdown"
                          data-ui-option-count={controls().length}
                        >
                          <Icon name={icon()} size="small" />
                          <span class="min-w-0 truncate">{label()}</span>
                          <Icon name="chevron-down" size="small" class="shrink-0" />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content class="min-w-[190px]">
                            <DropdownMenu.RadioGroup
                              value={selected()?.id ?? ""}
                              onChange={(value) => {
                                if (typeof value !== "string") return
                                const control = controls().find((item) => item.id === value)
                                if (control) void runExternalControl(control)
                              }}
                            >
                              <For each={controls()}>
                                {(control) => (
                                  <DropdownMenu.RadioItem
                                    value={control.id}
                                    disabled={control.disabled}
                                    data-action={`claude-code-control-${control.id}`}
                                  >
                                    <DropdownMenu.ItemLabel>{control.label}</DropdownMenu.ItemLabel>
                                    <DropdownMenu.ItemIndicator>
                                      <Icon name="check" size="small" />
                                    </DropdownMenu.ItemIndicator>
                                  </DropdownMenu.RadioItem>
                                )}
                              </For>
                            </DropdownMenu.RadioGroup>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    )
                  }}
                </For>
              </div>
              <Tooltip placement="top" value={blank() ? language.t("claudeCode.control.interrupt") : props.submitLabel ?? language.t("prompt.action.send")}>
                <IconButton
                  data-action="prompt-submit-external-agent"
                  type="button"
                  disabled={externalSubmitting() || !!props.externalSubmitDisabled?.()}
                  icon={blank() ? "stop" : "arrow-up"}
                  variant="primary"
                  class="size-7 rounded-full"
                  aria-label={blank() ? language.t("claudeCode.control.interrupt") : props.submitLabel ?? language.t("prompt.action.send")}
                  onClick={() => {
                    if (!blank()) {
                      requestSubmitPrompt()
                      return
                    }
                    void interruptExternalAgent()
                  }}
                />
              </Tooltip>
            </div>
          </DockTray>
        </Show>
        <Show when={!tavernSession() && !externalAgent() && (store.mode === "normal" || store.mode === "shell")}>
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
              submitLabel={props.submitLabel ?? language.t("prompt.action.send")}
              stopLabel={language.t("prompt.action.stop")}
              stopping={stopping()}
              submitStyle={buttons()}
              moreDisabled={store.mode !== "normal"}
              moreTabIndex={store.mode === "normal" ? undefined : -1}
              moreLabel={language.t("prompt.more")}
              scheduleAutomationLabel={language.t("settings.automation.create")}
              scheduleAutomationDisabled={!sessionID() || store.mode !== "normal"}
              onScheduleAutomation={openScheduledAutomation}
              subagentDispatchLabel={language.t("subagent.dispatch.open")}
              subagentDispatchDisabled={!sessionID() || store.mode !== "normal"}
              onSubagentDispatch={openSubagentDispatch}
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
