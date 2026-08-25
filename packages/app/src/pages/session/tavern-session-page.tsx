import type { AssistantMessage, FilePart, Part, TextPart, UserMessage } from "@lfcode-ai/sdk/v2"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { MarkedProvider } from "@lfcode-ai/ui/context/marked"
import { ImagePreview } from "@lfcode-ai/ui/image-preview"
import { ThumbnailImage } from "@lfcode-ai/ui/image-thumbnail"
import { resolveInlineImageUrl } from "@lfcode-ai/ui/inline-image-cache"
import { ScrollView } from "@lfcode-ai/ui/scroll-view"
import { useNavigate } from "@solidjs/router"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLocal } from "@/context/local"
import { type ImageAttachmentPart, type Prompt } from "@/context/prompt"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { PromptImageAttachments } from "@/components/prompt-input/image-attachments"
import { sendFollowupDraft } from "@/components/prompt-input/submit"
import { formatServerError } from "@/utils/server-errors"
import { isSessionStreaming } from "@/utils/session-status"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { TavernManager } from "./tavern-manager"
import { type TavernPluginAvailability } from "./tavern-plugin-availability"
import { TavernRichText } from "./tavern-rich-text"
import { SessionHistoryRail } from "./session-history-rail"
import {
  defaultRoadwaySettings,
  normalizeRoadwaySettings,
  type TavernRoadwayResult,
  type TavernRoadwaySettings,
} from "./tavern-roadway"
import {
  isTavernVisibleUserMessage,
  nextTavernGroupSpeaker,
  normalizeTavernSpeakerMode,
  parseTavernAutoSpeaker,
  resolveTavernConversation,
  tavernAutoSpeakerPrompt,
  tavernGroupTurnOrder,
  tavernMessageText,
  tavernVisibleTranscript,
  type TavernConversationData,
  type TavernSessionBinding,
} from "./tavern-conversation"
import { tavernCanSend, tavernImageAttachments, tavernNativeImageAttachment } from "./tavern-media"
import {
  normalizeTavernSpeechSettings,
  speakTavernText,
  stopTavernSpeech,
  tavernSpeechText,
  type TavernSpeechSettings,
} from "./tavern-tts"
import { normalizeTavernViewSettings } from "./tavern-view"
import {
  normalizeTavernAvatarPath,
  normalizeTavernVisualAssets,
  normalizeTavernVisualSettings,
  type TavernVisualSettings,
} from "./tavern-visual"
import { appendTavernSwipe, removeTavernSwipe, resolveTavernSwipe } from "./tavern-swipe"
import {
  applyTavernInputMacros,
  normalizeTavernVariableName,
  normalizeTavernVariables,
  runTavernSlash,
} from "./tavern-macros"
import { findTavernQuickReply, insertTavernQuickReply, type TavernQuickReplySet } from "./tavern-quick-replies"
import {
  normalizeTavernStorySummarySettings,
  sanitizeTavernStorySummary,
  shouldAutoSummarizeTavernStory,
  tavernStorySummaryPrompt,
  type TavernStorySummary,
} from "./tavern-story-summary"
import {
  normalizeTavernMemorySettings,
  tavernMemoryProjectID,
  type TavernMemoryRecall,
} from "./tavern-memory"
import { normalizeTavernAuthorNote } from "./tavern-author-note"
import { buildTavernRequestContext } from "./tavern-request"

export type TavernManagerView =
  | "new"
  | "characters"
  | "personas"
  | "presets"
  | "groups"
  | "worldbooks"
  | "history"
  | "trash"
  | "settings"

type TavernData = TavernConversationData & {
  worldbooks: { id: string; name: string; content: string }[]
  settings?: {
    html?: boolean
    storyPrediction?: boolean
    immersive?: boolean
    dualView?: boolean
    visual?: TavernVisualSettings
    roadway?: TavernRoadwaySettings
    tts?: TavernSpeechSettings
    storySummary?: { auto?: boolean; everyTurns?: number }
    memory?: { recall?: boolean; limit?: number }
  }
  roadway?: { results?: Record<string, TavernRoadwayResult> }
}

type ImageMakerItem = { id: string; mime: string; file: string; url: string }

export function TavernSessionPage(props: {
  sessionID?: string
  directory: string
  projectID: string
  managerView?: TavernManagerView
  pluginAvailability: TavernPluginAvailability
  onRetryPluginStatus: () => void
}) {
  return (
    <MarkedProvider>
      <TavernSessionPageContent {...props} />
    </MarkedProvider>
  )
}

function TavernSessionPageContent(props: {
  sessionID?: string
  directory: string
  projectID: string
  managerView?: TavernManagerView
  pluginAvailability: TavernPluginAvailability
  onRetryPluginStatus: () => void
}) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const platform = usePlatform()
  const dialog = useDialog()
  const [draft, setDraft] = createSignal("")
  const [attachments, setAttachments] = createSignal<ImageAttachmentPart[]>([])
  const [draggingMedia, setDraggingMedia] = createSignal(false)
  const [sendError, setSendError] = createSignal<string>()
  const [commandNotice, setCommandNotice] = createSignal<string>()
  const [branchBusy, setBranchBusy] = createSignal<string>()
  const [swipeBusy, setSwipeBusy] = createSignal<string>()
  const [messageDeleteBusy, setMessageDeleteBusy] = createSignal<string>()
  const [confirmDeleteMessageID, setConfirmDeleteMessageID] = createSignal<string>()
  const [continuationBusy, setContinuationBusy] = createSignal(false)
  const [deleteSessionBusy, setDeleteSessionBusy] = createSignal(false)
  const [confirmDeleteSession, setConfirmDeleteSession] = createSignal(false)
  const [renameOpen, setRenameOpen] = createSignal(false)
  const [renameDraft, setRenameDraft] = createSignal("")
  const [renameBusy, setRenameBusy] = createSignal(false)
  const [roadwayError, setRoadwayError] = createSignal<string>()
  const [roadwayBusy, setRoadwayBusy] = createSignal<string>()
  const [imageMakerOpen, setImageMakerOpen] = createSignal(false)
  const [imageMakerPrompt, setImageMakerPrompt] = createSignal("")
  const [imageMakerNegativePrompt, setImageMakerNegativePrompt] = createSignal("")
  const [imageMakerSize, setImageMakerSize] = createSignal("1024x1024")
  const [imageMakerBusy, setImageMakerBusy] = createSignal(false)
  const [variablesOpen, setVariablesOpen] = createSignal(false)
  const [authorNoteOpen, setAuthorNoteOpen] = createSignal(false)
  const [authorNoteDraft, setAuthorNoteDraft] = createSignal("")
  const [storySummaryOpen, setStorySummaryOpen] = createSignal(false)
  const [storySummaryBusy, setStorySummaryBusy] = createSignal(false)
  const [memoryOpen, setMemoryOpen] = createSignal(false)
  const [memoryText, setMemoryText] = createSignal("")
  const [memoryLayer, setMemoryLayer] = createSignal<"project" | "conversation">("conversation")
  const [memoryBusy, setMemoryBusy] = createSignal(false)
  const [memoryItems, setMemoryItems] = createSignal<
    Array<{ id: string; layer: "project" | "conversation"; content: string; indexed: boolean }>
  >([])
  const [variableName, setVariableName] = createSignal("")
  const [variableValue, setVariableValue] = createSignal("")
  const [messageViewport, setMessageViewport] = createSignal<HTMLDivElement>()
  const automaticRoadway = new Set<string>()
  const automaticSpeech = new Set<string>()
  const automaticStorySummaries = new Set<string>()
  let attachmentInput: HTMLInputElement | undefined
  let externalSpeech: HTMLAudioElement | undefined
  let roadwayObservationReady = false
  let speechObservationReady = false
  let storySummaryObservationReady = false
  const [data, { mutate, refetch }] = createResource(
    () => (props.pluginAvailability.kind === "ready" ? props.sessionID : undefined),
    async () => {
      const result = await sdk.client.plugin.dataGet({ pluginID: "lfcode-tavern" })
      const value = result.data?.value
      if (!value || typeof value !== "object") return emptyTavernData()
      const input = value as Partial<TavernData>
      return {
        ...input,
        characters: input.characters ?? [],
        worldbooks: input.worldbooks ?? [],
        sessions: input.sessions ?? {},
        settings: {
          ...input.settings,
          roadway: normalizeRoadwaySettings(input.settings?.roadway),
          tts: normalizeTavernSpeechSettings(input.settings?.tts),
          visual: normalizeTavernVisualSettings(input.settings?.visual),
        },
        roadway: { ...input.roadway, results: input.roadway?.results ?? {} },
      } satisfies TavernData
    },
  )
  const [quickReplySets] = createResource(
    () => props.sessionID,
    async (): Promise<TavernQuickReplySet[]> => {
      const result = await sdk.client.plugin
        .action({ pluginID: "lfcode-tavern", action: "quickRepliesList", pluginActionInput: { input: {} } })
        .catch(() => ({ data: undefined }))
      const value = result.data?.value
      return Array.isArray(value) ? (value as TavernQuickReplySet[]) : []
    },
  )
  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const [children, { refetch: refetchChildren }] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      if (!sessionID) return []
      const result = await sdk.client.session.children({ sessionID })
      return result.data ?? []
    },
  )
  const messages = createMemo(() => (props.sessionID ? sync.data.message[props.sessionID] : undefined))
  const status = createMemo(() => (props.sessionID ? sync.data.session_status[props.sessionID] : undefined))
  const streaming = createMemo(() => isSessionStreaming(status() ?? { type: "idle" }))
  const binding = createMemo(() => (props.sessionID ? data()?.sessions[props.sessionID] : undefined))
  const conversation = createMemo(() => (data() ? resolveTavernConversation(data()!, binding()) : undefined))
  const character = createMemo(() => conversation()?.speaker)
  const worldbookIDs = createMemo(() => binding()?.worldbookIDs ?? [])
  const greetings = createMemo(() =>
    [character()?.firstMessage, ...(character()?.alternateGreetings ?? [])].filter((item): item is string => !!item),
  )
  const greetingIndex = createMemo(() => Math.min(binding()?.greetingIndex ?? 0, Math.max(0, greetings().length - 1)))
  const greeting = createMemo(() => greetings()[greetingIndex()])
  const model = createMemo(() => local.model.current())
  const agent = createMemo(() => local.agent.current())
  const title = createMemo(() => session()?.title ?? character()?.name ?? "酒馆对话")
  const railTurnIDs = createMemo(() =>
    (messages() ?? [])
      .filter(
        (message): message is UserMessage =>
          message.role === "user" && isTavernVisibleUserMessage(message, sync.data.part[message.id] ?? []),
      )
      .map((message) => message.id),
  )
  const root = () => `/${base64Encode(props.directory)}/session`
  const managerHref = (view: TavernManagerView) => `${root()}?view=tavern-${view}`

  const roadwaySettings = createMemo(() => normalizeRoadwaySettings(data()?.settings?.roadway))
  const roadwayResults = createMemo(() => data()?.roadway?.results ?? {})
  const speechSettings = createMemo(() => normalizeTavernSpeechSettings(data()?.settings?.tts))
  const storySummarySettings = createMemo(() => normalizeTavernStorySummarySettings(data()?.settings?.storySummary))
  const storySummary = createMemo(() => binding()?.storySummary)
  const memorySettings = createMemo(() => normalizeTavernMemorySettings(data()?.settings?.memory))
  const viewSettings = createMemo(() => normalizeTavernViewSettings(data()?.settings))
  const variables = createMemo(() => normalizeTavernVariables(binding()?.variables))
  const authorNote = createMemo(() => normalizeTavernAuthorNote(binding()?.authorNote))
  const speakerMode = createMemo(() => normalizeTavernSpeakerMode(binding()?.speakerMode))
  const quickReplies = createMemo(() => quickReplySets() ?? [])
  const memoryProjectID = createMemo(() => tavernMemoryProjectID(binding()))
  const immersive = createMemo(() => viewSettings().immersive)
  const dualView = createMemo(() => viewSettings().dualView && !immersive())
  const expressions = createMemo(() => normalizeTavernVisualAssets(character()?.expressions))
  const expression = createMemo(() => expressions().find((item) => item.id === binding()?.expressionID))
  const avatarPath = createMemo(() => normalizeTavernAvatarPath(character()?.avatar))
  const visualPaths = createMemo(() =>
    [data()?.settings?.visual?.background?.path, expression()?.path, avatarPath()].filter((item): item is string => !!item),
  )
  const [visualAssets] = createResource(
    () => visualPaths().join("|"),
    async () => {
      const paths = visualPaths()
      if (paths.length === 0) return {} as Record<string, string>
      const result = await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "visualAssetRead",
        pluginActionInput: { input: { paths } },
      })
      const value = result.data?.value
      return value && typeof value === "object" ? (value as Record<string, string>) : {}
    },
  )
  const backgroundImage = createMemo(() => {
    const path = data()?.settings?.visual?.background?.path
    return path ? visualAssets()?.[path] : undefined
  })
  const expressionImage = createMemo(() => {
    const path = expression()?.path
    return path ? visualAssets()?.[path] : undefined
  })
  const avatarImage = createMemo(() => {
    const path = avatarPath()
    return path ? visualAssets()?.[path] : undefined
  })

  const saveData = async (nextData: TavernData) => {
    mutate(() => nextData)
    await sdk.client.plugin.dataSet({ pluginID: "lfcode-tavern", pluginData: { value: nextData } })
  }

  const loadMemory = async () => {
    const projectID = memoryProjectID()
    if (!projectID || !props.sessionID) return
    const result = await sdk.client.plugin
      .action({
        pluginID: "lfcode-tavern",
        action: "memoryList",
        pluginActionInput: { input: { projectID, conversationID: props.sessionID } },
      })
      .catch(() => ({ data: undefined }))
    const value = result.data?.value
    setMemoryItems(
      Array.isArray(value)
        ? (value as Array<{ id: string; layer: "project" | "conversation"; content: string; indexed: boolean }>)
        : [],
    )
  }

  const saveMemory = async () => {
    const projectID = memoryProjectID()
    const content = memoryText().trim()
    if (!projectID || !props.sessionID || !content || memoryBusy()) return
    setMemoryBusy(true)
    setSendError()
    try {
      await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "memoryWrite",
        pluginActionInput: {
          input: { projectID, conversationID: props.sessionID, layer: memoryLayer(), content, source: "manual" },
        },
      })
      setMemoryText("")
      await loadMemory()
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "保存长期记忆失败"))
    } finally {
      setMemoryBusy(false)
    }
  }

  const deleteMemory = async (id: string) => {
    const projectID = memoryProjectID()
    if (!projectID || !props.sessionID) return
    await sdk.client.plugin
      .action({
        pluginID: "lfcode-tavern",
        action: "memoryDelete",
        pluginActionInput: { input: { id, projectID, conversationID: props.sessionID } },
      })
      .catch((cause) => setSendError(formatServerError(cause, (key) => key, "删除长期记忆失败")))
    await loadMemory()
  }

  const reindexMemory = async () => {
    const projectID = memoryProjectID()
    if (!projectID || !props.sessionID || memoryBusy()) return
    setMemoryBusy(true)
    setSendError()
    try {
      await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "memoryReindex",
        pluginActionInput: { input: { projectID, conversationID: props.sessionID } },
      })
      await loadMemory()
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "索引长期记忆失败"))
    } finally {
      setMemoryBusy(false)
    }
  }

  const recallMemory = async (query: string): Promise<TavernMemoryRecall[]> => {
    const projectID = memoryProjectID()
    if (!memorySettings().recall || !projectID || !props.sessionID) return []
    const result = await sdk.client.plugin
      .action({
        pluginID: "lfcode-tavern",
        action: "memoryRecall",
        pluginActionInput: {
          input: { projectID, conversationID: props.sessionID, query, limit: memorySettings().limit },
        },
      })
      .catch(() => ({ data: undefined }))
    const value = result.data?.value as { status?: string; results?: unknown } | undefined
    return value?.status === "ok" && Array.isArray(value.results) ? (value.results as TavernMemoryRecall[]) : []
  }

  const speak = async (text: string) => {
    const settings = speechSettings()
    if (settings.provider === "system") {
      speakTavernText(text, settings)
      return
    }
    const clean = tavernSpeechText(text)
    if (!settings.enabled || !clean) return
    try {
      const result = await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "ttsSynthesize",
        pluginActionInput: { input: { text: clean, provider: settings.provider } },
      })
      const value = result.data?.value as { dataUrl?: string; dataUrls?: string[] } | undefined
      const dataUrls = value?.dataUrls ?? (value?.dataUrl ? [value.dataUrl] : [])
      if (dataUrls.length === 0) throw new Error("TTS 未返回音频")
      externalSpeech?.pause()
      externalSpeech = new Audio(dataUrls[0])
      externalSpeech.volume = settings.volume
      let index = 0
      externalSpeech.onended = () => {
        index += 1
        const next = dataUrls[index]
        if (!next || !externalSpeech) return
        externalSpeech.src = next
        void externalSpeech.play()
      }
      await externalSpeech.play()
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "朗读角色回复失败"))
    }
  }

  const updateViewSettings = async (next: Partial<ReturnType<typeof viewSettings>>) => {
    const current = data()
    if (!current) return
    await saveData({ ...current, settings: { ...current.settings, ...next } })
  }

  createEffect(() => {
    if (!props.sessionID || typeof window === "undefined") return
    const key = `lfcode-tavern-draft:${props.sessionID}`
    const pending = window.sessionStorage.getItem(key)
    if (pending === null) return
    window.sessionStorage.removeItem(key)
    setDraft(pending)
  })

  createEffect(() => {
    const items = messages()
    if (!items) return
    const assistants = items.filter((item): item is AssistantMessage => item.role === "assistant")
    if (!speechObservationReady) {
      assistants.forEach((item) => automaticSpeech.add(item.id))
      speechObservationReady = true
      return
    }
    if (
      speechSettings().provider !== "system" ||
      !speechSettings().enabled ||
      !speechSettings().autoPlay ||
      streaming()
    )
      return
    const latest = assistants.at(-1)
    if (!latest || automaticSpeech.has(latest.id)) return
    automaticSpeech.add(latest.id)
    void speak(tavernMessageText(sync.data.part[latest.id] ?? []))
  })

  const forkSession = async (input: {
    messageID?: string
    includeMessage?: boolean
    draft?: string
    navigate?: boolean
  }) => {
    const sessionID = props.sessionID
    const current = data()
    if (!sessionID || !current) throw new Error("酒馆会话尚未加载完成")
    setBranchBusy(input.messageID ?? "session")
    try {
      const result = await sdk.client.session.fork({
        sessionID,
        messageID: input.messageID,
        includeMessage: input.includeMessage,
      })
      if (!result.data) throw new Error("创建分支失败")
      const sourceBinding = current.sessions[sessionID]
      if (sourceBinding) {
        await saveData({
          ...current,
          sessions: { ...current.sessions, [result.data.id]: { ...sourceBinding } },
        })
      }
      if (input.draft !== undefined && typeof window !== "undefined") {
        window.sessionStorage.setItem(`lfcode-tavern-draft:${result.data.id}`, input.draft)
      }
      void refetchChildren()
      if (input.navigate !== false) navigate(`${root()}/${result.data.id}`)
      return result.data.id
    } finally {
      setBranchBusy()
    }
  }

  const forkFromMessage = async (message: UserMessage | AssistantMessage) => {
    setSendError()
    try {
      await forkSession({ messageID: message.id, includeMessage: true })
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "创建酒馆分支失败"))
    }
  }

  const editFromMessage = async (message: UserMessage, text: string) => {
    setSendError()
    try {
      await forkSession({ messageID: message.id, draft: text })
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "创建编辑分支失败"))
    }
  }

  const deleteSession = async () => {
    const sessionID = props.sessionID
    const current = data()
    if (!sessionID || !current || deleteSessionBusy()) return
    if (!confirmDeleteSession()) {
      setConfirmDeleteSession(true)
      return
    }
    setDeleteSessionBusy(true)
    setSendError()
    try {
      const collectDescendants = async (id: string): Promise<string[]> => {
        const result = await sdk.client.session.children({ sessionID: id })
        const children = await Promise.all((result.data ?? []).map((child) => collectDescendants(child.id)))
        return [id, ...children.flat()]
      }
      const removedIDs = await collectDescendants(sessionID)
      await sdk.client.session.delete({ sessionID, directory: props.directory })
      const sessions = { ...current.sessions }
      removedIDs.forEach((id) => delete sessions[id])
      await saveData({ ...current, sessions })
      navigate(root())
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "永久删除酒馆会话失败"))
    } finally {
      setDeleteSessionBusy(false)
      setConfirmDeleteSession(false)
    }
  }

  const saveSessionTitle = async () => {
    const sessionID = props.sessionID
    const next = renameDraft().trim().slice(0, 120)
    if (!sessionID || !next || renameBusy()) return
    setRenameBusy(true)
    setSendError()
    try {
      await sdk.client.session.update({ sessionID, title: next })
      setRenameOpen(false)
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "重命名酒馆会话失败"))
    } finally {
      setRenameBusy(false)
    }
  }

  const regenerateFromMessage = async (message: AssistantMessage) => {
    setSendError()
    try {
      const forkedID = await forkSession({ messageID: message.id })
      if (!forkedID) return
      await sdk.client.session.regenerate({ sessionID: forkedID })
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "重新生成酒馆回复失败"))
    }
  }

  const generateSwipeFromMessage = async (message: AssistantMessage) => {
    const source = sync.data.part[message.id]?.find((part): part is TextPart => part.type === "text" && !part.synthetic)
    if (!source || swipeBusy()) return
    setSendError()
    setSwipeBusy(message.id)
    try {
      const forkedID = await forkSession({ messageID: message.id, navigate: false })
      if (!forkedID) return
      const generated = await sdk.client.session.regenerate({ sessionID: forkedID })
      const text = generated.data?.parts
        .find((part): part is TextPart => part.type === "text" && !part.synthetic)
        ?.text?.trim()
      if (!text) throw new Error("Swipe 生成没有返回角色文本")
      const current =
        sync.data.part[message.id]?.find(
          (part): part is TextPart => part.id === source.id && part.type === "text" && !part.synthetic,
        ) ?? source
      const swipe = appendTavernSwipe({ sourceText: current.text, metadata: current.metadata, text })
      await sdk.client.part.update({
        sessionID: props.sessionID!,
        messageID: message.id,
        partID: source.id,
        part: { ...current, text, metadata: { ...current.metadata, tavern: swipe } },
      })
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "生成 Swipe 失败"))
    } finally {
      setSwipeBusy()
    }
  }

  const roadwayModel = () => {
    const configured = roadwaySettings().modelSource === "custom" ? roadwaySettings().model : undefined
    return configured ?? (model() ? { providerID: model()!.provider.id, modelID: model()!.id } : undefined)
  }

  const generateRoadway = async (targetMessageID?: string) => {
    const activeSessionID = props.sessionID
    const activeModel = roadwayModel()
    const target = targetMessageID ?? [...(messages() ?? [])].reverse().find((item) => item.role === "assistant")?.id
    if (!activeSessionID || !activeModel || !target || !roadwaySettings().enabled) return
    setRoadwayBusy(target)
    setRoadwayError()
    try {
      const result = await sdk.client.session.roadway({
        sessionID: activeSessionID,
        providerID: activeModel.providerID,
        modelID: activeModel.modelID,
        mode: "suggest",
        prompt: roadwaySettings().prompt,
        extractionStrategy: roadwaySettings().extractionStrategy,
        maxContextMessages: roadwaySettings().maxContextMessages,
        maxOutputTokens: roadwaySettings().maxOutputTokens,
        messageRole: roadwaySettings().messageRole,
      })
      if (!result.data) throw new Error("Roadway 没有返回结果")
      const current = data() ?? emptyTavernData()
      await saveData({
        ...current,
        roadway: {
          ...current.roadway,
          results: {
            ...current.roadway?.results,
            [target]: {
              targetMessageID: target,
              text: result.data.text,
              options: result.data.options,
              expanded: roadwaySettings().autoOpen,
              createdAt: Date.now(),
            },
          },
        },
      })
    } catch (cause) {
      setRoadwayError(formatServerError(cause, (key) => key, "Roadway 生成失败"))
    } finally {
      setRoadwayBusy()
    }
  }

  const generateStorySummary = async (automatic = false) => {
    const activeSessionID = props.sessionID
    const activeModel = model()
    if (!activeSessionID || !activeModel || storySummaryBusy()) return
    setStorySummaryBusy(true)
    setSendError()
    try {
      const result = await sdk.client.session.roadway({
        sessionID: activeSessionID,
        providerID: activeModel.provider.id,
        modelID: activeModel.id,
        mode: "summary",
        prompt: tavernStorySummaryPrompt,
        extractionStrategy: "none",
        maxContextMessages: 200,
        maxOutputTokens: 1200,
        messageRole: "system",
      })
      const text = sanitizeTavernStorySummary(result.data?.text ?? "")
      if (!text) throw new Error("剧情摘要没有返回内容")
      await updateBinding({
        storySummary: {
          text,
          updatedAt: Date.now(),
          sourceMessageCount: messages()?.length ?? 0,
        },
      })
      if (!automatic) setStorySummaryOpen(true)
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "生成剧情摘要失败"))
    } finally {
      setStorySummaryBusy(false)
    }
  }

  const saveStorySummary = async (text: string) => {
    const summary = sanitizeTavernStorySummary(text)
    if (!summary) {
      await updateBinding({ storySummary: undefined })
      return
    }
    await updateBinding({
      storySummary: {
        text: summary,
        updatedAt: Date.now(),
        sourceMessageCount: storySummary()?.sourceMessageCount ?? messages()?.length ?? 0,
      },
    })
  }

  const updateStorySummarySettings = async (next: Partial<ReturnType<typeof storySummarySettings>>) => {
    const current = data()
    if (!current) return
    await saveData({
      ...current,
      settings: { ...current.settings, storySummary: { ...storySummarySettings(), ...next } },
    })
  }

  const useRoadwayOption = (option: string) => {
    setDraft(option)
    if (roadwaySettings().autoSubmitUseAction) void submit(option)
  }

  const updateRoadwayResult = async (targetMessageID: string, patch: Partial<TavernRoadwayResult>) => {
    const current = data()
    const existing = current?.roadway?.results?.[targetMessageID]
    if (!current || !existing) return
    await saveData({
      ...current,
      roadway: {
        ...current.roadway,
        results: {
          ...current.roadway?.results,
          [targetMessageID]: { ...existing, ...patch },
        },
      },
    })
  }

  const updateRoadwayOption = async (targetMessageID: string, index: number, text: string) => {
    const existing = roadwayResults()[targetMessageID]
    if (!existing) return
    if (!existing.options?.length) {
      await updateRoadwayResult(targetMessageID, { text })
      return
    }
    await updateRoadwayResult(targetMessageID, {
      options: existing.options.map((option, optionIndex) => (optionIndex === index ? text : option)),
    })
  }

  const impersonateRoadwayOption = async (option: string) => {
    const activeSessionID = props.sessionID
    const activeModel = roadwayModel()
    if (!activeSessionID || !activeModel) return
    setRoadwayBusy("impersonate:" + option)
    setRoadwayError()
    try {
      const result = await sdk.client.session.roadway({
        sessionID: activeSessionID,
        providerID: activeModel.providerID,
        modelID: activeModel.modelID,
        mode: "impersonate",
        prompt: roadwaySettings().impersonatePrompt,
        extractionStrategy: "none",
        maxContextMessages: roadwaySettings().maxContextMessages,
        maxOutputTokens: roadwaySettings().maxOutputTokens,
        messageRole: roadwaySettings().messageRole,
        selectedOption: option,
      })
      if (!result.data?.text) throw new Error("代入没有返回内容")
      setDraft(result.data.text)
    } catch (cause) {
      setRoadwayError(formatServerError(cause, (key) => key, "Roadway 代入失败"))
    } finally {
      setRoadwayBusy()
    }
  }

  const updateBinding = async (next: Partial<TavernSessionBinding>) => {
    const sessionID = props.sessionID
    const current = data()
    if (!sessionID || !current) return
    const currentBinding = current.sessions[sessionID]
    const characterID = currentBinding?.characterID ?? conversation()?.speaker?.id
    if (!characterID) return
    const selectedCharacter = current.characters.find((item) => item.id === characterID)
    const nextData: TavernData = {
      ...current,
      sessions: {
        ...current.sessions,
        [sessionID]: {
          ...currentBinding,
          characterID,
          ...next,
          worldbookIDs: next.worldbookIDs ?? currentBinding?.worldbookIDs ?? selectedCharacter?.worldbookIDs ?? [],
        },
      },
    }
    mutate(nextData)
    await sdk.client.plugin.dataSet({ pluginID: "lfcode-tavern", pluginData: { value: nextData } })
  }

  const saveAuthorNote = async () => {
    const next = normalizeTavernAuthorNote({ content: authorNoteDraft() })
    await updateBinding({ authorNote: next })
    setAuthorNoteDraft(next?.content ?? "")
    setCommandNotice(next ? "已保存作者注释" : "已清除作者注释")
  }

  const selectGreeting = async (index: number) => {
    const selected = greetings()[index]
    if (!selected) return
    await updateBinding({ greetingIndex: index })
    const first = messages()?.find((item) => item.role === "assistant")
    const part =
      first && sync.data.part[first.id]?.find((item): item is TextPart => item.type === "text" && !item.synthetic)
    if (!first || !part || !props.sessionID) return
    await sdk.client.part.update({
      sessionID: props.sessionID,
      messageID: first.id,
      partID: part.id,
      part: { ...part, text: selected },
    })
  }

  const selectSwipe = async (
    message: UserMessage | AssistantMessage,
    part: TextPart,
    swipes: string[],
    swipeID: number,
  ) => {
    if (!props.sessionID || !swipes[swipeID]) return
    await sdk.client.part.update({
      sessionID: props.sessionID,
      messageID: message.id,
      partID: part.id,
      part: {
        ...part,
        text: swipes[swipeID],
        metadata: { ...part.metadata, tavern: { swipes, swipeID } },
      },
    })
  }

  const deleteSwipe = async (message: UserMessage | AssistantMessage, part: TextPart) => {
    if (!props.sessionID || swipeBusy()) return
    const swipe = removeTavernSwipe(part.metadata)
    if (!swipe) return
    setSwipeBusy(message.id)
    try {
      const metadata = { ...part.metadata }
      delete metadata.tavern
      await sdk.client.part.update({
        sessionID: props.sessionID,
        messageID: message.id,
        partID: part.id,
        part: {
          ...part,
          text: swipe.text,
          metadata:
            swipe.swipes.length > 1
              ? { ...metadata, tavern: { swipes: swipe.swipes, swipeID: swipe.swipeID } }
              : metadata,
        },
      })
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "删除 Swipe 候选失败"))
    } finally {
      setSwipeBusy()
    }
  }

  const deleteMessage = async (message: UserMessage | AssistantMessage) => {
    if (!props.sessionID || streaming() || messageDeleteBusy()) return
    if (confirmDeleteMessageID() !== message.id) {
      setConfirmDeleteMessageID(message.id)
      return
    }
    setMessageDeleteBusy(message.id)
    setSendError()
    try {
      await sdk.client.session.deleteMessage({
        sessionID: props.sessionID,
        messageID: message.id,
        directory: props.directory,
      })
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "删除酒馆消息失败"))
    } finally {
      setMessageDeleteBusy()
      setConfirmDeleteMessageID()
    }
  }

  const saveVariable = async () => {
    const name = normalizeTavernVariableName(variableName())
    if (!name) {
      setSendError("变量名不能为空，且不能包含空格、冒号或花括号")
      return
    }
    await updateBinding({ variables: { ...variables(), [name]: variableValue().slice(0, 4_000) } })
    setVariableName("")
    setVariableValue("")
    setSendError()
    setCommandNotice(`已设置变量 ${name}`)
  }

  const useQuickReply = (value: string) => {
    const reply = findTavernQuickReply(quickReplies(), value)
    if (!reply) return
    setDraft((current) => insertTavernQuickReply(current, reply))
  }

  const submit = async (value = draft()) => {
    const input = value.trim()
    const media = attachments()
    const activeSession = session()
    const activeModel = model()
    const activeAgent = agent()
    const activeConversation = conversation()
    const activeData = data()
    const activeBinding = binding()
    if (!input && media.length === 0) return
    const slash = media.length === 0 ? runTavernSlash(input, variables()) : { handled: false as const }
    if (slash.handled) {
      if ("error" in slash) {
        setSendError(slash.error)
        return
      }
      await updateBinding({ variables: slash.variables })
      setDraft("")
      setCommandNotice(slash.notice)
      if (slash.openVariables) setVariablesOpen(true)
      return
    }
    const expanded = applyTavernInputMacros(input, {
      characterName: character()?.name,
      userName: conversation()?.persona?.name,
      variables: variables(),
    })
    const text = expanded.text.trim()
    if (!tavernCanSend(text, media) || !activeSession || !activeModel || !activeAgent) {
      if (JSON.stringify(expanded.variables) !== JSON.stringify(variables())) {
        await updateBinding({ variables: expanded.variables })
        setDraft(text)
        setCommandNotice("已更新会话变量")
      }
      return
    }

    setSendError()
    const prompt: Prompt = [{ type: "text", content: text, start: 0, end: text.length }, ...media]
    setDraft("")
    setAttachments([])
    try {
      await updateBinding({ variables: expanded.variables })
      const recalledMemory = await recallMemory(text)
      const autoSpeakerID = await selectAutoSpeaker({
        sessionID: activeSession.id,
        model: activeModel,
        conversation: activeConversation,
        text,
      })
      const selectedConversation =
        autoSpeakerID && activeData && activeBinding
          ? resolveTavernConversation(activeData, { ...activeBinding, speakerID: autoSpeakerID })
          : activeConversation
      const requestContext = buildTavernRequestContext({
        conversation: selectedConversation,
        variables: expanded.variables,
        worldbooks: activeData?.worldbooks ?? [],
        worldbookIDs: worldbookIDs(),
        storySummary: storySummary(),
        authorNote: authorNote(),
        memory: recalledMemory,
        openingMessage: messages()?.length === 0 ? greeting() : undefined,
        transcript: [
          ...tavernVisibleTranscript(messages() ?? [], (messageID) => sync.data.part[messageID] ?? []),
          { role: "user" as const, text },
        ],
      })
      await sendFollowupDraft({
        client: sdk.client,
        globalSync,
        sync,
        optimisticBusy: true,
        draft: {
          sessionID: activeSession.id,
          sessionDirectory: props.directory,
          prompt,
          context: [],
          agent: activeAgent.name,
          model: { providerID: activeModel.provider.id, modelID: activeModel.id },
          variant: local.model.variant.current(),
          system: requestContext.system,
          tavernContext: requestContext.tavernContext,
        },
      })
      const nextSpeakerID = activeConversation?.group
        ? (autoSpeakerID ??
          nextTavernGroupSpeaker({
            members: activeConversation.members,
            currentSpeakerID: activeConversation.speaker?.id,
            mode: speakerMode(),
            memberWeights: activeConversation.group.memberWeights,
          }))
        : undefined
      if (nextSpeakerID && nextSpeakerID !== activeConversation?.speaker?.id)
        await updateBinding({ speakerID: nextSpeakerID })
    } catch (cause) {
      setDraft(text)
      setAttachments(media)
      setSendError(formatServerError(cause, (key) => key, "酒馆消息发送失败"))
    }
  }

  const selectAutoSpeaker = async (input: {
    sessionID: string
    model: NonNullable<ReturnType<typeof model>>
    conversation: ReturnType<typeof conversation>
    text: string
  }) => {
    if (speakerMode() !== "auto" || !input.conversation?.group || input.conversation.members.length < 2) return
    try {
      const result = await sdk.client.session.roadway({
        sessionID: input.sessionID,
        providerID: input.model.provider.id,
        modelID: input.model.id,
        mode: "summary",
        prompt: tavernAutoSpeakerPrompt({ members: input.conversation.members, text: input.text }),
        extractionStrategy: "none",
        maxContextMessages: 40,
        maxOutputTokens: 32,
        messageRole: "system",
      })
      return parseTavernAutoSpeaker(result.data?.text ?? "", input.conversation.members)
    } catch {
      setCommandNotice("模型未能选择发言角色，本轮沿用当前角色")
    }
  }

  const continueGroupTurn = async (speakerIDs: string[]) => {
    const activeSession = session()
    const activeModel = model()
    const activeAgent = agent()
    const current = data()
    const currentBinding = binding()
    if (!activeSession || !activeModel || !activeAgent || !current || !currentBinding || continuationBusy()) return
    setContinuationBusy(true)
    setSendError()
    try {
      for (const speakerID of speakerIDs) {
        const speaker = current.characters.find((item) => item.id === speakerID)
        if (!speaker) continue
        const conversation = resolveTavernConversation(current, { ...currentBinding, speakerID })
        const requestContext = buildTavernRequestContext({
          conversation,
          variables: variables(),
          worldbooks: current.worldbooks,
          worldbookIDs: currentBinding.worldbookIDs,
          storySummary: currentBinding.storySummary,
          authorNote: normalizeTavernAuthorNote(currentBinding.authorNote),
          memory: [],
          transcript: tavernVisibleTranscript(messages() ?? [], (messageID) => sync.data.part[messageID] ?? []),
        })
        await sdk.client.session.tavernContinuation({
          sessionID: activeSession.id,
          agent: activeAgent.name,
          model: { providerID: activeModel.provider.id, modelID: activeModel.id },
          variant: local.model.variant.current(),
          system: requestContext.system,
          tavernContext: requestContext.tavernContext,
          nudge: `现在由${speaker.name}继续本轮群组对话。只输出该角色的自然回应，不代替玩家发言。`,
        })
        await updateBinding({ speakerID })
      }
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "群组角色发言失败"))
    } finally {
      setContinuationBusy(false)
    }
  }

  const addAttachments = async (files: File[]) => {
    const next = await tavernImageAttachments(files)
    if (next.length === 0 && files.length > 0) {
      setSendError("酒馆消息只支持 PNG、JPEG、GIF 和 WebP 图片")
      return
    }
    setSendError()
    setAttachments((current) => [...current, ...next])
  }

  const chooseAttachments = async () => {
    if (!platform.openAttachmentPickerDialog || !platform.readDroppedImage) {
      attachmentInput?.click()
      return
    }
    const selected = await platform.openAttachmentPickerDialog({ multiple: true, title: "选择酒馆图片" })
    const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []
    const images = (await Promise.all(paths.map((path) => platform.readDroppedImage!(path)))).flatMap((image) =>
      image ? [tavernNativeImageAttachment(image)] : [],
    )
    if (images.length === 0 && paths.length > 0) {
      setSendError("酒馆消息只支持 PNG、JPEG、GIF 和 WebP 图片")
      return
    }
    setSendError()
    setAttachments((current) => [...current, ...images])
  }

  const handleComposerPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length > 0) {
      event.preventDefault()
      void addAttachments(files)
      return
    }
    if (event.clipboardData?.getData("text/plain")) return
    if (!platform.readClipboardImage) return
    event.preventDefault()
    void platform.readClipboardImage().then((image) => image && addAttachments([image]))
  }

  const generateImage = async () => {
    const prompt = imageMakerPrompt().trim()
    if (!prompt) return
    const [width, height] = imageMakerSize().split("x").map(Number)
    if (!width || !height) return
    setImageMakerBusy(true)
    setSendError()
    try {
      const result = await sdk.client.plugin.action({
        pluginID: "lfcode-imagemaker",
        action: "generateImmediate",
        pluginActionInput: {
          input: {
            prompt,
            negativePrompt: imageMakerNegativePrompt().trim() || undefined,
            width,
            height,
          },
        },
      })
      const item = (result.data?.value as { item?: ImageMakerItem } | undefined)?.item
      if (!item?.url || !item.mime.startsWith("image/")) throw new Error("ImageMaker 没有返回可用图片")
      setAttachments((current) => [
        ...current,
        tavernNativeImageAttachment({
          filename: item.file.split("/").at(-1) || `imagemaker-${item.id}.png`,
          mime: item.mime,
          dataUrl: item.url,
        }),
      ])
      setImageMakerPrompt("")
      setImageMakerNegativePrompt("")
      setImageMakerOpen(false)
    } catch (cause) {
      setSendError(formatServerError(cause, (key) => key, "ImageMaker 绘图失败；请在插件页确认已启用并配置 API"))
    } finally {
      setImageMakerBusy(false)
    }
  }

  createEffect(() => {
    const items = messages()
    const settings = roadwaySettings()
    if (!items) return
    const assistants = items.filter((item): item is AssistantMessage => item.role === "assistant")
    if (!roadwayObservationReady) {
      assistants.forEach((item) => automaticRoadway.add(item.id))
      roadwayObservationReady = true
      return
    }
    if (!settings.enabled || !settings.autoTrigger || streaming() || assistants.length < 2) return
    const latest = assistants.at(-1)
    if (!latest || automaticRoadway.has(latest.id) || roadwayResults()[latest.id]) return
    automaticRoadway.add(latest.id)
    void generateRoadway(latest.id)
  })

  createEffect(() => {
    const items = messages()
    if (!items) return
    const assistants = items.filter((item): item is AssistantMessage => item.role === "assistant")
    if (!storySummaryObservationReady) {
      assistants.forEach((item) => automaticStorySummaries.add(item.id))
      storySummaryObservationReady = true
      return
    }
    const latest = assistants.at(-1)
    if (!latest || automaticStorySummaries.has(latest.id)) return
    if (
      !shouldAutoSummarizeTavernStory({
        settings: storySummarySettings(),
        summary: storySummary(),
        messageCount: items.length,
        streaming: streaming(),
      })
    )
      return
    automaticStorySummaries.add(latest.id)
    void generateStorySummary(true)
  })

  const openManager = (view: TavernManagerView) => navigate(managerHref(view))

  const selectMessageTurn = (messageID: string) => {
    document.getElementById(`tavern-message-${messageID}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <Show
      when={props.pluginAvailability.kind === "ready"}
      fallback={<TavernPluginRecovery availability={props.pluginAvailability} onRetry={props.onRetryPluginStatus} />}
    >
      <div
        class="size-full min-h-0 overflow-hidden bg-background-base"
        data-tavern-session-page
        data-automation-id="tavern-session-page"
      >
        <main class="relative flex size-full min-w-0 flex-col bg-background-stronger">
          <Show when={backgroundImage()}>
            {(source) => (
              <div
                class="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
                aria-hidden="true"
                style={{ "background-image": `url("${source()}")` }}
              />
            )}
          </Show>
          <header class="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border-base px-5">
            <div class="flex min-w-0 items-center gap-3">
              <Show when={props.sessionID}>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                  onClick={() => navigate(root())}
                >
                  酒馆
                </button>
              </Show>
              <Show when={!props.sessionID}>
                <div class="flex items-center gap-2 text-15-medium text-text-strong">
                  <Icon name="brain" size="small" /> 酒馆
                </div>
              </Show>
              <Show when={!immersive()}>
                <nav class="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="酒馆导航">
                  <TavernNav
                    label="新建对话"
                    icon="plus"
                    active={props.managerView === "new"}
                    automationID="tavern-new-conversation"
                    onClick={() => openManager("new")}
                  />
                  <TavernNav
                    label="角色"
                    icon="user"
                    active={props.managerView === "characters"}
                    automationID="tavern-characters"
                    onClick={() => openManager("characters")}
                  />
                  <TavernNav
                    label="身份"
                    icon="contact"
                    active={props.managerView === "personas"}
                    automationID="tavern-personas"
                    onClick={() => openManager("personas")}
                  />
                  <TavernNav
                    label="群组"
                    icon="users"
                    active={props.managerView === "groups"}
                    automationID="tavern-groups"
                    onClick={() => openManager("groups")}
                  />
                  <TavernNav
                    label="世界书"
                    icon="book-open"
                    active={props.managerView === "worldbooks"}
                    automationID="tavern-worldbooks"
                    onClick={() => openManager("worldbooks")}
                  />
                  <TavernNav
                    label="预设"
                    icon="sliders-horizontal"
                    active={props.managerView === "presets"}
                    automationID="tavern-presets"
                    onClick={() => openManager("presets")}
                  />
                  <TavernNav
                    label="历史"
                    icon="history"
                    active={props.managerView === "history"}
                    automationID="tavern-history"
                    onClick={() => openManager("history")}
                  />
                  <TavernNav
                    label="回收站"
                    icon="trash"
                    active={props.managerView === "trash"}
                    automationID="tavern-trash"
                    onClick={() => openManager("trash")}
                  />
                  <TavernNav
                    label="设置"
                    icon="settings"
                    active={props.managerView === "settings"}
                    automationID="tavern-settings"
                    onClick={() => openManager("settings")}
                  />
                </nav>
              </Show>
            </div>
            <Show when={props.sessionID && !props.managerView}>
              <div class="flex shrink-0 items-center gap-2 text-11-regular text-text-weak">
                <Show when={avatarImage()}>
                  {(source) => (
                    <img
                      class="size-7 rounded-md border border-border-base object-cover"
                      data-automation-id="tavern-character-avatar"
                      src={source()}
                      alt={`${character()?.name ?? "酒馆角色"}头像`}
                    />
                  )}
                </Show>
                <Show when={expressions().length > 0}>
                  <div class="flex items-center gap-1.5">
                    <Show when={expressionImage()}>
                      {(source) => (
                        <img
                          class="size-7 rounded-md border border-border-base object-cover"
                          src={source()}
                          alt={expression()?.label ?? "当前角色表情"}
                        />
                      )}
                    </Show>
                    <select
                      class="max-w-28 rounded-md border border-border-base bg-background-base px-1.5 py-1 text-11-regular text-text-base"
                      data-automation-id="tavern-expression-select"
                      aria-label="选择当前角色表情"
                      value={binding()?.expressionID ?? ""}
                      onChange={(event) => void updateBinding({ expressionID: event.currentTarget.value || undefined })}
                    >
                      <option value="">默认表情</option>
                      <For each={expressions()}>{(item) => <option value={item.id}>{item.label}</option>}</For>
                    </select>
                  </div>
                </Show>
                <Show when={session()?.parentID}>
                  {(parentID) => (
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                      aria-label="返回父分支"
                      onClick={() => navigate(`${root()}/${parentID()}`)}
                    >
                      父分支
                    </button>
                  )}
                </Show>
                <Show when={(children() ?? []).length > 0}>
                  <For each={children() ?? []}>
                    {(child) => (
                      <button
                        type="button"
                        class="max-w-28 truncate rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                        aria-label={`打开分支 ${child.title}`}
                        onClick={() => navigate(`${root()}/${child.id}`)}
                      >
                        {child.title}
                      </button>
                    )}
                  </For>
                </Show>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                  aria-label="重命名当前酒馆会话"
                  onClick={() => {
                    setRenameDraft(title())
                    setRenameOpen(true)
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-icon-critical-base"
                  disabled={deleteSessionBusy()}
                  aria-label="永久删除当前酒馆会话"
                  title="永久删除当前酒馆会话"
                  onClick={() => void deleteSession()}
                >
                  {deleteSessionBusy() ? "删除中…" : confirmDeleteSession() ? "确认删除" : "删除"}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                  data-automation-id="tavern-variables"
                  onClick={() => setVariablesOpen((current) => !current)}
                >
                  变量{Object.keys(variables()).length ? ` ${Object.keys(variables()).length}` : ""}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                  data-automation-id="tavern-author-note"
                  onClick={() => {
                    setAuthorNoteDraft(authorNote()?.content ?? "")
                    setAuthorNoteOpen((current) => !current)
                  }}
                >
                  注释{authorNote() ? "" : "（空）"}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                  data-automation-id="tavern-story-summary"
                  onClick={() => setStorySummaryOpen((current) => !current)}
                >
                  摘要{storySummary() ? "" : "（空）"}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                  data-automation-id="tavern-memory"
                  onClick={() => {
                    setMemoryOpen((current) => !current)
                    void loadMemory()
                  }}
                >
                  记忆
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                  data-automation-id="tavern-toggle-immersive"
                  onClick={() => void updateViewSettings({ immersive: !immersive() })}
                >
                  {immersive() ? "退出沉浸" : "沉浸"}
                </button>
                <Show when={!immersive()}>
                  <button
                    type="button"
                    class="rounded-md px-2 py-1 hover:bg-surface-base-hover hover:text-text-base"
                    data-automation-id="tavern-toggle-dual-view"
                    onClick={() => void updateViewSettings({ dualView: !dualView() })}
                  >
                    {dualView() ? "关闭双视图" : "双视图"}
                  </button>
                </Show>
                <span class="rounded-full border border-border-base px-2 py-1">{model()?.name ?? "未选择模型"}</span>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 hover:bg-surface-base-hover"
                  onClick={() => void refetch()}
                >
                  刷新
                </button>
              </div>
            </Show>
          </header>
          <Show
            when={props.managerView}
            fallback={
              <Show when={props.sessionID} fallback={<TavernEmpty onNew={() => openManager("new")} />}>
                <Show when={!immersive()}>
                  <div class="shrink-0 border-b border-border-base px-5 py-3">
                    <div class="flex min-w-0 items-center justify-between gap-3">
                      <div class="min-w-0">
                        <Show
                          when={renameOpen()}
                          fallback={<h1 class="truncate text-15-medium text-text-strong">{title()}</h1>}
                        >
                          <div class="flex min-w-0 items-center gap-2">
                            <input
                              class="min-w-0 flex-1 rounded-md border border-border-base bg-background-base px-2 py-1 text-14-regular text-text-strong outline-none"
                              aria-label="酒馆会话名称"
                              value={renameDraft()}
                              onInput={(event) => setRenameDraft(event.currentTarget.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setRenameOpen(false)
                                if (event.key !== "Enter" || event.isComposing) return
                                event.preventDefault()
                                void saveSessionTitle()
                              }}
                            />
                            <button
                              type="button"
                              class="shrink-0 rounded-md px-2 py-1 text-12-medium hover:bg-surface-base-hover"
                              disabled={renameBusy() || !renameDraft().trim()}
                              onClick={() => void saveSessionTitle()}
                            >
                              {renameBusy() ? "保存中…" : "保存"}
                            </button>
                            <button
                              type="button"
                              class="shrink-0 rounded-md px-2 py-1 text-12-medium hover:bg-surface-base-hover"
                              disabled={renameBusy()}
                              onClick={() => setRenameOpen(false)}
                            >
                              取消
                            </button>
                          </div>
                        </Show>
                        <p class="mt-0.5 truncate text-11-regular text-text-weak">
                          {character()?.prompt || "酒馆角色对话"}
                        </p>
                      </div>
                      <Show when={greetings().length > 1}>
                        <div
                          class="flex shrink-0 items-center gap-1 rounded-lg border border-border-base bg-surface-raised-base p-1 shadow-sm"
                          aria-label="切换开场场景"
                          data-automation-id="tavern-greeting-switcher"
                        >
                          <span class="px-2 text-12-medium text-text-weak">开场场景</span>
                          <button
                            type="button"
                            class="rounded-md px-2 py-1 text-12-medium text-text-base hover:bg-surface-base-hover"
                            aria-label="上一条开局场景"
                            onClick={() =>
                              void selectGreeting((greetingIndex() - 1 + greetings().length) % greetings().length)
                            }
                          >
                            上一场
                          </button>
                          <span class="min-w-10 text-center text-12-regular text-text-weak">
                            {greetingIndex() + 1}/{greetings().length}
                          </span>
                          <button
                            type="button"
                            class="rounded-md bg-surface-base px-2 py-1 text-12-medium text-text-base hover:bg-surface-base-hover"
                            aria-label="下一条开局场景"
                            onClick={() => void selectGreeting((greetingIndex() + 1) % greetings().length)}
                          >
                            下一场
                          </button>
                        </div>
                      </Show>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <label class="text-11-regular text-text-weak">
                        玩家身份
                        <select
                          class="ml-1 rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base"
                          value={binding()?.personaID ?? ""}
                          onChange={(event) =>
                            void updateBinding({ personaID: event.currentTarget.value || undefined })
                          }
                        >
                          <option value="">玩家</option>
                          <For each={data()?.personas ?? []}>
                            {(item) => <option value={item.id}>{item.name}</option>}
                          </For>
                        </select>
                      </label>
                      <label class="text-11-regular text-text-weak">
                        对话预设
                        <select
                          class="ml-1 rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base"
                          value={binding()?.presetID ?? ""}
                          onChange={(event) => void updateBinding({ presetID: event.currentTarget.value || undefined })}
                        >
                          <option value="">默认</option>
                          <For each={data()?.presets ?? []}>
                            {(item) => <option value={item.id}>{item.name}</option>}
                          </For>
                        </select>
                      </label>
                      <Show when={conversation()?.group && conversation()!.members.length > 1}>
                        <label class="text-11-regular text-text-weak">
                          发言方式
                          <select
                            class="ml-1 rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base"
                            aria-label="群组发言方式"
                            data-automation-id="tavern-speaker-mode"
                            value={speakerMode()}
                            onChange={(event) =>
                              void updateBinding({ speakerMode: normalizeTavernSpeakerMode(event.currentTarget.value) })
                            }
                          >
                            <option value="manual">手动</option>
                            <option value="round-robin">轮流</option>
                            <option value="random">随机</option>
                            <option value="auto">模型自动</option>
                          </select>
                        </label>
                        <label class="text-11-regular text-text-weak">
                          当前发言角色
                          <select
                            class="ml-1 rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base"
                            value={character()?.id ?? ""}
                            onChange={(event) =>
                              void updateBinding({ speakerID: event.currentTarget.value || undefined })
                            }
                          >
                            <For each={conversation()?.members ?? []}>
                              {(item) => <option value={item.id}>{item.name}</option>}
                            </For>
                          </select>
                        </label>
                        <button
                          type="button"
                          class="rounded border border-border-base px-2 py-0.5 text-11-medium hover:bg-surface-base-hover disabled:opacity-50"
                          disabled={streaming() || continuationBusy()}
                          onClick={() => void continueGroupTurn(character()?.id ? [character()!.id] : [])}
                        >
                          {continuationBusy() ? "生成中…" : "角色发言"}
                        </button>
                        <button
                          type="button"
                          class="rounded border border-border-base px-2 py-0.5 text-11-medium hover:bg-surface-base-hover disabled:opacity-50"
                          disabled={streaming() || continuationBusy()}
                          onClick={() =>
                            void continueGroupTurn(tavernGroupTurnOrder(conversation()?.members ?? [], character()?.id))
                          }
                        >
                          全员依次发言
                        </button>
                      </Show>
                    </div>
                    <Show when={variablesOpen()}>
                      <section
                        class="mt-3 border-t border-border-base pt-3"
                        aria-label="会话变量"
                        data-automation-id="tavern-variables-panel"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <h2 class="text-12-medium text-text-strong">会话变量</h2>
                          <IconButton
                            type="button"
                            icon="close-small"
                            class="size-6 rounded-md"
                            aria-label="关闭会话变量"
                            onClick={() => setVariablesOpen(false)}
                          />
                        </div>
                        <div class="mt-2 grid gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
                          <input
                            class="min-w-0 rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base outline-none"
                            aria-label="变量名"
                            value={variableName()}
                            placeholder="变量名"
                            onInput={(event) => setVariableName(event.currentTarget.value)}
                          />
                          <input
                            class="min-w-0 rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base outline-none"
                            aria-label="变量值"
                            value={variableValue()}
                            placeholder="变量值"
                            onInput={(event) => setVariableValue(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" || event.isComposing) return
                              event.preventDefault()
                              void saveVariable()
                            }}
                          />
                          <button
                            type="button"
                            class="rounded-md bg-surface-base px-3 py-1 text-12-medium text-text-base hover:bg-surface-base-hover"
                            onClick={() => void saveVariable()}
                          >
                            保存
                          </button>
                        </div>
                        <Show
                          when={Object.keys(variables()).length > 0}
                          fallback={<p class="mt-2 text-11-regular text-text-weak">当前没有变量。</p>}
                        >
                          <div class="mt-2 flex flex-wrap gap-2">
                            <For each={Object.entries(variables())}>
                              {([name, value]) => (
                                <div class="flex max-w-full items-center gap-2 border border-border-base bg-surface-base px-2 py-1 text-11-regular text-text-base">
                                  <span class="font-medium">{name}</span>
                                  <span class="max-w-56 truncate text-text-weak" title={value}>
                                    {value}
                                  </span>
                                  <button
                                    type="button"
                                    class="text-text-weak hover:text-icon-critical-base"
                                    aria-label={`删除变量 ${name}`}
                                    onClick={() =>
                                      void updateBinding({
                                        variables: Object.fromEntries(
                                          Object.entries(variables()).filter(([key]) => key !== name),
                                        ),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </section>
                    </Show>
                    <Show when={authorNoteOpen()}>
                      <section
                        class="mt-3 border-t border-border-base pt-3"
                        aria-label="作者注释"
                        data-automation-id="tavern-author-note-panel"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <div>
                            <h2 class="text-12-medium text-text-strong">作者注释</h2>
                            <p class="mt-0.5 text-11-regular text-text-weak">随下一轮请求注入，不改写历史。</p>
                          </div>
                          <IconButton
                            type="button"
                            icon="close-small"
                            class="size-6 rounded-md"
                            aria-label="关闭作者注释"
                            onClick={() => setAuthorNoteOpen(false)}
                          />
                        </div>
                        <textarea
                          class="mt-2 block min-h-20 w-full resize-y rounded-md border border-border-base bg-background-base px-2 py-1 text-13-regular text-text-base outline-none"
                          maxlength={4000}
                          placeholder="例如：保持雨夜的压抑氛围，角色不要主动离开码头。"
                          value={authorNoteDraft()}
                          onInput={(event) => setAuthorNoteDraft(event.currentTarget.value)}
                        />
                        <div class="mt-2 flex gap-2">
                          <button
                            type="button"
                            class="rounded-md bg-surface-base px-3 py-1 text-12-medium text-text-base hover:bg-surface-base-hover"
                            onClick={() => void saveAuthorNote()}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            class="rounded-md px-3 py-1 text-12-medium hover:bg-surface-base-hover"
                            onClick={() => {
                              setAuthorNoteDraft("")
                              void saveAuthorNote()
                            }}
                          >
                            清除
                          </button>
                        </div>
                      </section>
                    </Show>
                    <Show when={storySummaryOpen()}>
                      <section
                        class="mt-3 border-t border-border-base pt-3"
                        aria-label="剧情摘要"
                        data-automation-id="tavern-story-summary-panel"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 class="text-12-medium text-text-strong">剧情摘要</h2>
                            <p class="mt-0.5 text-11-regular text-text-weak">
                              仅保存当前分支的剧情连续性记忆，不会写入聊天记录。
                            </p>
                          </div>
                          <div class="flex items-center gap-2">
                            <button
                              type="button"
                              class="rounded-md bg-surface-base px-2 py-1 text-11-medium text-text-base hover:bg-surface-base-hover disabled:opacity-50"
                              disabled={!model() || storySummaryBusy()}
                              onClick={() => void generateStorySummary()}
                            >
                              {storySummaryBusy() ? "生成中…" : storySummary() ? "重新生成" : "生成摘要"}
                            </button>
                            <IconButton
                              type="button"
                              icon="close-small"
                              class="size-6 rounded-md"
                              aria-label="关闭剧情摘要"
                              onClick={() => setStorySummaryOpen(false)}
                            />
                          </div>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-3 text-11-regular text-text-weak">
                          <label class="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={storySummarySettings().auto}
                              onChange={(event) =>
                                void updateStorySummarySettings({ auto: event.currentTarget.checked })
                              }
                            />
                            自动摘要
                          </label>
                          <label>
                            每{" "}
                            <select
                              class="rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base"
                              aria-label="自动摘要间隔"
                              value={storySummarySettings().everyTurns}
                              onChange={(event) =>
                                void updateStorySummarySettings({ everyTurns: Number(event.currentTarget.value) })
                              }
                            >
                              <option value={4}>4</option>
                              <option value={8}>8</option>
                              <option value={12}>12</option>
                              <option value={20}>20</option>
                            </select>{" "}
                            轮
                          </label>
                        </div>
                        <Show
                          when={storySummary()}
                          fallback={
                            <p class="mt-3 text-12-regular text-text-weak">
                              尚未创建摘要。可手动生成；
                              {storySummarySettings().auto
                                ? "自动摘要已启用，将从新的回合开始按间隔生成。"
                                : "自动摘要默认关闭。"}
                            </p>
                          }
                        >
                          {(summary) => (
                            <div class="mt-3">
                              <textarea
                                class="block min-h-40 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-12-regular leading-5 text-text-base outline-none"
                                aria-label="编辑剧情摘要"
                                value={summary().text}
                                onBlur={(event) => void saveStorySummary(event.currentTarget.value)}
                              />
                              <div class="mt-2 flex items-center justify-between gap-3">
                                <span class="text-11-regular text-text-weak">
                                  已覆盖 {summary().sourceMessageCount} 条消息
                                </span>
                                <button
                                  type="button"
                                  class="rounded-md px-2 py-1 text-11-medium text-text-weak hover:bg-surface-base-hover hover:text-icon-critical-base"
                                  onClick={() => void updateBinding({ storySummary: undefined })}
                                >
                                  清除摘要
                                </button>
                              </div>
                            </div>
                          )}
                        </Show>
                      </section>
                    </Show>
                    <Show when={memoryOpen()}>
                      <section
                        class="mt-3 border-t border-border-base pt-3"
                        aria-label="长期记忆"
                        data-automation-id="tavern-memory-panel"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 class="text-12-medium text-text-strong">长期记忆</h2>
                            <p class="mt-0.5 text-11-regular text-text-weak">
                              项目记忆供同一角色或群组的所有对话使用；会话记忆只在当前对话召回。
                            </p>
                          </div>
                          <IconButton
                            type="button"
                            icon="close-small"
                            class="size-6 rounded-md"
                            aria-label="关闭长期记忆"
                            onClick={() => setMemoryOpen(false)}
                          />
                        </div>
                        <div class="mt-3 flex flex-wrap items-end gap-2">
                          <label class="min-w-24 text-11-regular text-text-weak">
                            保存范围
                            <select
                              class="mt-1 block rounded border border-border-base bg-background-base px-1 py-1 text-text-base"
                              value={memoryLayer()}
                              onChange={(event) =>
                                setMemoryLayer(event.currentTarget.value === "project" ? "project" : "conversation")
                              }
                            >
                              <option value="conversation">当前会话</option>
                              <option value="project">当前项目</option>
                            </select>
                          </label>
                          <textarea
                            class="min-h-16 min-w-52 flex-1 resize-y rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base outline-none"
                            aria-label="新增长期记忆"
                            value={memoryText()}
                            onInput={(event) => setMemoryText(event.currentTarget.value)}
                            placeholder="写下应在后续对话中保留的事实、关系或约定"
                          />
                          <button
                            type="button"
                            class="rounded-md bg-surface-base px-2 py-1 text-11-medium text-text-base hover:bg-surface-base-hover disabled:opacity-50"
                            disabled={!memoryText().trim() || memoryBusy()}
                            onClick={() => void saveMemory()}
                          >
                            {memoryBusy() ? "保存中…" : "保存"}
                          </button>
                        </div>
                        <label class="mt-3 flex items-center gap-2 text-11-regular text-text-weak">
                          <input
                            type="checkbox"
                            checked={memorySettings().recall}
                            onChange={(event) => {
                              const current = data()
                              if (current)
                                void saveData({
                                  ...current,
                                  settings: {
                                    ...current.settings,
                                    memory: { ...memorySettings(), recall: event.currentTarget.checked },
                                  },
                                })
                            }}
                          />
                          发送时自动召回相近记忆
                        </label>
                        <Show when={memorySettings().recall}>
                          <label class="mt-2 block text-11-regular text-text-weak">
                            每轮最多{" "}
                            <select
                              class="rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base"
                              value={memorySettings().limit}
                              onChange={(event) => {
                                const current = data()
                                if (current)
                                  void saveData({
                                    ...current,
                                    settings: {
                                      ...current.settings,
                                      memory: { ...memorySettings(), limit: Number(event.currentTarget.value) },
                                    },
                                  })
                              }}
                            >
                              <option value={1}>1</option>
                              <option value={2}>2</option>
                              <option value={3}>3</option>
                              <option value={4}>4</option>
                              <option value={6}>6</option>
                            </select>{" "}
                            条
                          </label>
                        </Show>
                        <p class="mt-2 text-11-regular text-text-weak">
                          自动召回默认关闭。启用后，当前输入会发送给你配置的 Embedding
                          服务；未配置或服务不可用时会静默跳过。
                        </p>
                        <Show when={memoryItems().some((item) => !item.indexed)}>
                          <button
                            type="button"
                            class="mt-2 rounded-md border border-border-base px-2 py-1 text-11-medium text-text-weak hover:bg-surface-base-hover disabled:opacity-50"
                            disabled={memoryBusy()}
                            onClick={() => void reindexMemory()}
                          >
                            {memoryBusy() ? "索引中…" : "索引当前项目待处理记忆"}
                          </button>
                        </Show>
                        <div class="mt-3 space-y-2">
                          <For
                            each={memoryItems()}
                            fallback={<p class="text-12-regular text-text-weak">尚未保存长期记忆。</p>}
                          >
                            {(item) => (
                              <div class="flex gap-2 rounded-md border border-border-base px-2 py-2">
                                <span class="shrink-0 text-11-regular text-text-weak">
                                  {item.layer === "project" ? "项目" : "会话"}
                                  {item.indexed ? "" : "（待索引）"}
                                </span>
                                <p class="min-w-0 flex-1 whitespace-pre-wrap text-12-regular text-text-base">
                                  {item.content}
                                </p>
                                <button
                                  type="button"
                                  class="shrink-0 text-11-medium text-text-weak hover:text-icon-critical-base"
                                  aria-label="删除长期记忆"
                                  onClick={() => void deleteMemory(item.id)}
                                >
                                  删除
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                      </section>
                    </Show>
                  </div>
                </Show>
                <div class="relative flex min-h-0 flex-1">
                  <div class="relative min-w-0 flex-1">
                    <ScrollView viewportRef={setMessageViewport} class="size-full" aria-label="酒馆消息">
                      <Show when={messages()} fallback={<TavernLoading />}>
                        {(items) => (
                          <TavernMessageList
                            messages={items()}
                            parts={sync.data.part}
                            html={data()?.settings?.html ?? true}
                            characterName={character()?.name ?? "酒馆角色"}
                            openingMessage={greeting()}
                            railVisible={railTurnIDs().length > 0 && !immersive()}
                            roadwayEnabled={roadwaySettings().enabled}
                            roadwayShowUseAction={roadwaySettings().showUseAction}
                            roadwayAutoOpen={roadwaySettings().autoOpen}
                            roadwayResults={roadwayResults()}
                            roadwayBusy={roadwayBusy()}
                            branchBusy={branchBusy()}
                            swipeBusy={swipeBusy()}
                            messageDeleteBusy={messageDeleteBusy()}
                            confirmingDeleteMessageID={confirmDeleteMessageID()}
                            speechEnabled={speechSettings().enabled}
                            onSpeak={(text) => void speak(text)}
                            onRoadwayGenerate={(messageID) => void generateRoadway(messageID)}
                            onRoadwayUse={useRoadwayOption}
                            onRoadwayImpersonate={(option) => void impersonateRoadwayOption(option)}
                            onRoadwayResultChange={(messageID, patch) => void updateRoadwayResult(messageID, patch)}
                            onRoadwayOptionChange={(messageID, index, value) =>
                              void updateRoadwayOption(messageID, index, value)
                            }
                            onSwipeChange={(message, part, swipes, swipeID) =>
                              void selectSwipe(message, part, swipes, swipeID)
                            }
                            onSwipeDelete={(message, part) => void deleteSwipe(message, part)}
                            onDelete={(message) => void deleteMessage(message)}
                            onFork={(message) => void forkFromMessage(message)}
                            onEdit={(message, text) => void editFromMessage(message, text)}
                            onRegenerate={(message) => void regenerateFromMessage(message)}
                            onGenerateSwipe={(message) => void generateSwipeFromMessage(message)}
                          />
                        )}
                      </Show>
                    </ScrollView>
                    <Show when={railTurnIDs().length > 0 && !immersive()}>
                      <SessionHistoryRail
                        turnIDs={railTurnIDs}
                        viewport={messageViewport}
                        ariaLabel="酒馆消息导航"
                        onSelect={selectMessageTurn}
                      />
                    </Show>
                  </div>
                  <Show when={dualView()}>
                    <TavernContextPanel
                      character={character()}
                      persona={conversation()?.persona}
                      preset={conversation()?.preset}
                      worldbooks={(data()?.worldbooks ?? []).filter((item) => worldbookIDs().includes(item.id))}
                      messages={messages() ?? []}
                      parts={sync.data.part}
                    />
                  </Show>
                </div>
                <footer class="shrink-0 bg-background-stronger pb-3 pt-2">
                  <div
                    class="w-full px-8 md:px-8"
                    classList={{ "pl-[76px]": railTurnIDs().length > 0 && !immersive() }}
                  >
                    <Show when={sendError()}>
                      {(message) => (
                        <div class="mb-2 rounded-md border border-icon-critical-base/30 bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">
                          {message()}
                        </div>
                      )}
                    </Show>
                    <Show when={commandNotice()}>
                      {(message) => (
                        <div class="mb-2 rounded-md border border-icon-info-base/30 bg-icon-info-base/10 px-3 py-2 text-12-regular text-icon-info-base">
                          {message()}
                        </div>
                      )}
                    </Show>
                    <Show when={roadwayError()}>
                      {(message) => (
                        <div class="mb-2 rounded-md border border-icon-critical-base/30 bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">
                          {message()}
                        </div>
                      )}
                    </Show>
                    <div
                      data-prompt-composer="true"
                      class="relative w-full overflow-hidden"
                      classList={{ "ring-2 ring-icon-info-base": draggingMedia() }}
                      onDragOver={(event) => {
                        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return
                        event.preventDefault()
                        setDraggingMedia(true)
                      }}
                      onDragLeave={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node)) return
                        setDraggingMedia(false)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDraggingMedia(false)
                        void addAttachments(Array.from(event.dataTransfer?.files ?? []))
                      }}
                    >
                      <input
                        ref={attachmentInput}
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        multiple
                        class="hidden"
                        aria-label="选择酒馆图片"
                        onChange={(event) => {
                          void addAttachments(Array.from(event.currentTarget.files ?? []))
                          event.currentTarget.value = ""
                        }}
                      />
                      <PromptImageAttachments
                        attachments={attachments()}
                        removeLabel="移除图片"
                        onOpen={(attachment) =>
                          dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
                        }
                        onRemove={(id) =>
                          setAttachments((current) => current.filter((attachment) => attachment.id !== id))
                        }
                      />
                      <Show when={imageMakerOpen()}>
                        <div
                          class="border-b border-border-base bg-surface-base px-4 py-3"
                          data-automation-id="tavern-imagemaker-panel"
                        >
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-12-medium text-text-strong">ImageMaker 绘图</span>
                            <IconButton
                              type="button"
                              icon="close-small"
                              class="size-6 rounded-md"
                              aria-label="关闭 ImageMaker 绘图"
                              disabled={imageMakerBusy()}
                              onClick={() => setImageMakerOpen(false)}
                            />
                          </div>
                          <textarea
                            class="mt-2 block min-h-18 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-12-regular text-text-strong outline-none placeholder:text-text-weak"
                            value={imageMakerPrompt()}
                            placeholder="描述画面、风格、构图与光线…"
                            disabled={imageMakerBusy()}
                            onInput={(event) => setImageMakerPrompt(event.currentTarget.value)}
                          />
                          <textarea
                            class="mt-2 block min-h-14 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-12-regular text-text-strong outline-none placeholder:text-text-weak"
                            value={imageMakerNegativePrompt()}
                            placeholder="不希望出现的内容（可选）"
                            disabled={imageMakerBusy()}
                            onInput={(event) => setImageMakerNegativePrompt(event.currentTarget.value)}
                          />
                          <div class="mt-2 flex items-center justify-between gap-3">
                            <select
                              class="rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base"
                              aria-label="生成图片尺寸"
                              value={imageMakerSize()}
                              disabled={imageMakerBusy()}
                              onChange={(event) => setImageMakerSize(event.currentTarget.value)}
                            >
                              <option value="1024x1024">1024 x 1024</option>
                              <option value="1024x1536">1024 x 1536</option>
                              <option value="1536x1024">1536 x 1024</option>
                            </select>
                            <button
                              type="button"
                              class="rounded-md bg-icon-info-base px-3 py-1.5 text-12-medium text-white disabled:opacity-50"
                              disabled={imageMakerBusy() || !imageMakerPrompt().trim()}
                              onClick={() => void generateImage()}
                            >
                              {imageMakerBusy() ? "生成中…" : "生成并加入附件"}
                            </button>
                          </div>
                        </div>
                      </Show>
                      <textarea
                        class="block h-[60px] min-h-0 w-full resize-none bg-transparent px-5 pb-2 pt-4 text-14-regular text-text-strong outline-none placeholder:text-text-weak"
                        data-automation-id="tavern-composer"
                        value={draft()}
                        placeholder="以角色身份发送消息…"
                        disabled={streaming() || !model() || !agent()}
                        onInput={(event) => setDraft(event.currentTarget.value)}
                        onPaste={handleComposerPaste}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                          event.preventDefault()
                          void submit()
                        }}
                      />
                      <div class="flex h-[47px] items-center justify-between gap-3 px-4 py-2">
                        <div class="flex min-w-0 items-center gap-1.5">
                          <IconButton
                            type="button"
                            icon="photo"
                            class="size-7 rounded-md"
                            aria-label="添加酒馆图片"
                            data-automation-id="tavern-add-image"
                            disabled={streaming()}
                            onClick={() => void chooseAttachments()}
                          />
                          <IconButton
                            type="button"
                            icon="models"
                            class="size-7 rounded-md"
                            aria-label="使用 ImageMaker 绘图"
                            data-automation-id="tavern-generate-image"
                            disabled={streaming() || imageMakerBusy()}
                            onClick={() => setImageMakerOpen((current) => !current)}
                          />
                          <Show when={quickReplies().length > 0}>
                            <select
                              class="max-w-40 rounded-md bg-transparent px-2 py-1 text-12-regular text-text-base outline-none hover:bg-surface-base-hover"
                              value=""
                              aria-label="选择酒馆快捷回复"
                              data-automation-id="tavern-quick-replies"
                              disabled={streaming()}
                              onChange={(event) => {
                                useQuickReply(event.currentTarget.value)
                                event.currentTarget.value = ""
                              }}
                            >
                              <option value="">快捷回复</option>
                              <For each={quickReplies()}>
                                {(set) => (
                                  <optgroup label={set.name}>
                                    <For each={set.replies}>
                                      {(reply) => (
                                        <option value={`${set.id}:${reply.id}`} title={reply.title}>
                                          {reply.label}
                                        </option>
                                      )}
                                    </For>
                                  </optgroup>
                                )}
                              </For>
                            </select>
                          </Show>
                          <ModelSelectorPopover
                            model={local.model}
                            triggerAs="button"
                            triggerProps={{
                              class:
                                "max-w-44 truncate rounded-md px-2 py-1 text-left text-12-regular text-text-base hover:bg-surface-base-hover",
                            }}
                          >
                            {model()?.name ?? "选择模型 / 思考强度"}
                          </ModelSelectorPopover>
                          <select
                            class="max-w-40 rounded-md bg-transparent px-2 py-1 text-12-regular text-text-base outline-none hover:bg-surface-base-hover"
                            value=""
                            aria-label="选择酒馆世界书"
                            onChange={(event) => {
                              const worldbookID = event.currentTarget.value
                              event.currentTarget.value = ""
                              if (!worldbookID) return
                              const next = worldbookIDs().includes(worldbookID)
                                ? worldbookIDs().filter((item) => item !== worldbookID)
                                : [...worldbookIDs(), worldbookID]
                              void updateBinding({ worldbookIDs: next })
                            }}
                          >
                            <option value="">世界书{worldbookIDs().length ? ` ${worldbookIDs().length}` : ""}</option>
                            <For each={data()?.worldbooks ?? []}>
                              {(item) => (
                                <option value={item.id}>
                                  {worldbookIDs().includes(item.id) ? "移除 " : "加入 "}
                                  {item.name}
                                </option>
                              )}
                            </For>
                          </select>
                          <span class="truncate text-11-regular text-text-weak">
                            {character()?.name ?? "未绑定角色"}
                          </span>
                        </div>
                        <Show
                          when={streaming()}
                          fallback={
                            <IconButton
                              type="button"
                              data-automation-id="tavern-send"
                              icon="arrow-up"
                              variant="primary"
                              class="size-7 rounded-full"
                              aria-label="发送"
                              disabled={!tavernCanSend(draft(), attachments()) || !model() || !agent()}
                              onClick={() => void submit()}
                            />
                          }
                        >
                          <IconButton
                            type="button"
                            icon="stop"
                            variant="primary"
                            class="size-7 rounded-full"
                            aria-label="停止"
                            onClick={() => void sdk.client.session.abort({ sessionID: props.sessionID! })}
                          />
                        </Show>
                      </div>
                    </div>
                  </div>
                </footer>
              </Show>
            }
          >
            {(view) => <TavernManager view={view()} projectID={props.projectID} worktree={props.directory} />}
          </Show>
        </main>
      </div>
    </Show>
  )
}

function TavernNav(props: { label: string; icon: string; active: boolean; automationID: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-automation-id={props.automationID}
      class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-12-medium text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-base"
      classList={{ "bg-icon-info-base/10 text-icon-info-base": props.active }}
      onClick={props.onClick}
    >
      <Icon name={props.icon as never} size="small" />
      {props.label}
    </button>
  )
}

function TavernEmpty(props: { onNew: () => void }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <Icon name="brain" size="large" />
      <h1 class="mt-4 text-18-medium text-text-strong">开始一段酒馆对话</h1>
      <p class="mt-2 max-w-sm text-13-regular text-text-weak">
        选择角色后创建独立的酒馆会话；原生 Build、文件和环境面板不会进入此页面。
      </p>
      <button
        type="button"
        data-automation-id="tavern-select-character"
        class="mt-5 rounded-lg bg-icon-info-base px-4 py-2 text-13-medium text-white"
        onClick={props.onNew}
      >
        选择角色
      </button>
    </div>
  )
}

function TavernLoading() {
  return <div class="flex h-full items-center justify-center text-13-regular text-text-weak">正在加载酒馆对话…</div>
}

function TavernPluginRecovery(props: { availability: TavernPluginAvailability; onRetry: () => void }) {
  const dialog = useDialog()
  const detail = () => {
    if (props.availability.kind === "checking") return "正在检查酒馆插件状态。"
    if (props.availability.kind !== "unavailable") return "正在准备酒馆会话。"
    if (props.availability.reason === "missing") return "未找到 lfcode-tavern 插件。"
    if (props.availability.reason === "disabled") return "lfcode-tavern 插件当前已停用。"
    if (props.availability.reason === "degraded") return "lfcode-tavern 插件没有处于可用运行状态。"
    return "无法读取酒馆插件状态。"
  }
  const openPluginSettings = () => {
    void import("@/components/dialog-settings").then((module) => {
      dialog.show(() => <module.DialogSettings defaultValue="plugins" />)
    })
  }
  return (
    <div
      class="size-full min-h-0 overflow-hidden bg-background-base"
      data-tavern-recovery-page
      data-automation-id="tavern-recovery-page"
    >
      <main class="flex size-full items-center justify-center bg-background-stronger px-6">
        <section class="w-full max-w-lg rounded-md border border-border-base bg-background-base px-6 py-5">
          <h1 class="text-16-medium text-text-strong">酒馆会话处于只读恢复模式</h1>
          <p class="mt-2 text-13-regular text-text-weak">{detail()}</p>
          <p class="mt-2 text-12-regular leading-5 text-text-weak">
            该会话仍由 Tavern
            管理。为保护已有聊天记录，发送、编辑、删除、生成和资源管理均已禁用；恢复插件后可重新进入酒馆页面。
          </p>
          <div class="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md bg-surface-base px-3 py-1.5 text-12-medium text-text-base hover:bg-surface-base-hover"
              onClick={props.onRetry}
            >
              重新检查
            </button>
            <Show when={props.availability.kind !== "checking"}>
              <button
                type="button"
                class="rounded-md border border-border-base px-3 py-1.5 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                onClick={openPluginSettings}
              >
                管理插件
              </button>
            </Show>
          </div>
        </section>
      </main>
    </div>
  )
}

function TavernContextPanel(props: {
  character: TavernConversationData["characters"][number] | undefined
  persona: ReturnType<typeof resolveTavernConversation>["persona"]
  preset: ReturnType<typeof resolveTavernConversation>["preset"]
  worldbooks: TavernData["worldbooks"]
  messages: (UserMessage | AssistantMessage)[]
  parts: Record<string, Part[] | undefined>
}) {
  const turns = createMemo(() => ({
    user: props.messages.filter((message) => isTavernVisibleUserMessage(message, props.parts[message.id] ?? [])).length,
    assistant: props.messages.filter((message) => message.role === "assistant").length,
  }))
  return (
    <aside
      class="hidden w-80 shrink-0 flex-col border-l border-border-base bg-background-base xl:flex"
      aria-label="当前剧情"
    >
      <div class="border-b border-border-base px-4 py-3">
        <div class="text-13-medium text-text-strong">当前剧情</div>
        <div class="mt-1 text-11-regular text-text-weak">
          {turns().user} 次行动 · {turns().assistant} 次角色回复
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <section class="border-b border-border-base px-4 py-3">
          <div class="text-11-medium text-text-weak">角色</div>
          <div class="mt-1 text-13-medium text-text-strong">{props.character?.name ?? "未绑定角色"}</div>
          <Show when={props.character?.prompt}>
            <div class="mt-2 line-clamp-6 text-12-regular leading-5 text-text-weak">{props.character!.prompt}</div>
          </Show>
        </section>
        <section class="border-b border-border-base px-4 py-3">
          <div class="text-11-medium text-text-weak">玩家身份</div>
          <div class="mt-1 text-12-regular text-text-base">{props.persona?.name ?? "玩家"}</div>
          <Show when={props.persona?.description}>
            <div class="mt-1 line-clamp-4 text-12-regular leading-5 text-text-weak">{props.persona!.description}</div>
          </Show>
        </section>
        <section class="border-b border-border-base px-4 py-3">
          <div class="text-11-medium text-text-weak">对话预设</div>
          <div class="mt-1 text-12-regular text-text-base">{props.preset?.name ?? "默认"}</div>
        </section>
        <section class="px-4 py-3">
          <div class="text-11-medium text-text-weak">已绑定世界书</div>
          <Show when={props.worldbooks.length} fallback={<div class="mt-1 text-12-regular text-text-weak">未绑定</div>}>
            <div class="mt-2 flex flex-col gap-1">
              <For each={props.worldbooks}>
                {(worldbook) => <div class="truncate text-12-regular text-text-base">{worldbook.name}</div>}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </aside>
  )
}

function TavernMessageList(props: {
  messages: (UserMessage | AssistantMessage)[]
  parts: Record<string, Part[] | undefined>
  html: boolean
  characterName: string
  openingMessage?: string
  railVisible: boolean
  roadwayEnabled: boolean
  roadwayShowUseAction: boolean
  roadwayAutoOpen: boolean
  roadwayResults: Record<string, TavernRoadwayResult>
  roadwayBusy?: string
  branchBusy?: string
  swipeBusy?: string
  messageDeleteBusy?: string
  confirmingDeleteMessageID?: string
  speechEnabled: boolean
  onSpeak: (text: string) => void
  onRoadwayGenerate: (messageID: string) => void
  onRoadwayUse: (option: string) => void
  onRoadwayImpersonate: (option: string) => void
  onRoadwayResultChange: (messageID: string, patch: Partial<TavernRoadwayResult>) => void
  onRoadwayOptionChange: (messageID: string, index: number, value: string) => void
  onSwipeChange: (message: UserMessage | AssistantMessage, part: TextPart, swipes: string[], swipeID: number) => void
  onSwipeDelete: (message: UserMessage | AssistantMessage, part: TextPart) => void
  onDelete: (message: UserMessage | AssistantMessage) => void
  onFork: (message: UserMessage | AssistantMessage) => void
  onEdit: (message: UserMessage, text: string) => void
  onRegenerate: (message: AssistantMessage) => void
  onGenerateSwipe: (message: AssistantMessage) => void
}) {
  const firstAssistantID = () =>
    props.messages.find((message) => {
      if (message.role !== "assistant") return false
      const text = props.parts[message.id]?.find((part): part is TextPart => part.type === "text" && !part.synthetic)
      return !resolveTavernSwipe(text?.metadata)
    })?.id
  return (
    <div class="flex w-full flex-col px-8 py-5" classList={{ "pl-[76px]": props.railVisible }}>
      <Show
        when={props.messages.length}
        fallback={<TavernOpening text={props.openingMessage} html={props.html} characterName={props.characterName} />}
      >
        <For each={props.messages}>
          {(message) => (
            <TavernMessage
              message={message}
              parts={props.parts[message.id] ?? []}
              html={props.html}
              characterName={props.characterName}
              opening={message.id === firstAssistantID()}
              roadwayEnabled={props.roadwayEnabled}
              roadwayShowUseAction={props.roadwayShowUseAction}
              roadwayAutoOpen={props.roadwayAutoOpen}
              roadwayResult={props.roadwayResults[message.id]}
              roadwayBusy={props.roadwayBusy === message.id}
              branchBusy={props.branchBusy === message.id}
              swipeBusy={props.swipeBusy}
              messageDeleteBusy={props.messageDeleteBusy === message.id}
              confirmingDelete={props.confirmingDeleteMessageID === message.id}
              speechEnabled={props.speechEnabled}
              onSpeak={props.onSpeak}
              onRoadwayGenerate={props.onRoadwayGenerate}
              onRoadwayUse={props.onRoadwayUse}
              onRoadwayImpersonate={props.onRoadwayImpersonate}
              onRoadwayResultChange={props.onRoadwayResultChange}
              onRoadwayOptionChange={props.onRoadwayOptionChange}
              onSwipeChange={props.onSwipeChange}
              onSwipeDelete={props.onSwipeDelete}
              onDelete={props.onDelete}
              onFork={props.onFork}
              onEdit={props.onEdit}
              onRegenerate={props.onRegenerate}
              onGenerateSwipe={props.onGenerateSwipe}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

function TavernOpening(props: { text?: string; html: boolean; characterName: string }) {
  return (
    <Show when={props.text}>
      <article class="mb-6 flex w-full justify-start">
        <div class="w-full px-0 py-1 text-14-regular leading-6 text-text-strong">
          <div class="mb-2 text-11-medium opacity-70">{props.characterName}</div>
          <TavernRichText
            text={props.text!}
            html={props.html}
            cacheKey={`tavern-opening:${props.characterName}:${props.html ? "html" : "text"}`}
          />
        </div>
      </article>
    </Show>
  )
}

function TavernMessage(props: {
  message: UserMessage | AssistantMessage
  parts: Part[]
  html: boolean
  characterName: string
  opening: boolean
  roadwayEnabled: boolean
  roadwayShowUseAction: boolean
  roadwayAutoOpen: boolean
  roadwayResult?: TavernRoadwayResult
  roadwayBusy: boolean
  branchBusy: boolean
  swipeBusy?: string
  messageDeleteBusy: boolean
  confirmingDelete: boolean
  speechEnabled: boolean
  onSpeak: (text: string) => void
  onRoadwayGenerate: (messageID: string) => void
  onRoadwayUse: (option: string) => void
  onRoadwayImpersonate: (option: string) => void
  onRoadwayResultChange: (messageID: string, patch: Partial<TavernRoadwayResult>) => void
  onRoadwayOptionChange: (messageID: string, index: number, value: string) => void
  onSwipeChange: (message: UserMessage | AssistantMessage, part: TextPart, swipes: string[], swipeID: number) => void
  onSwipeDelete: (message: UserMessage | AssistantMessage, part: TextPart) => void
  onDelete: (message: UserMessage | AssistantMessage) => void
  onFork: (message: UserMessage | AssistantMessage) => void
  onEdit: (message: UserMessage, text: string) => void
  onRegenerate: (message: AssistantMessage) => void
  onGenerateSwipe: (message: AssistantMessage) => void
}) {
  const dialog = useDialog()
  const primaryTextPart = createMemo(() =>
    props.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic),
  )
  const swipe = createMemo(() => resolveTavernSwipe(primaryTextPart()?.metadata))
  const text = createMemo(() => tavernMessageText(props.parts))
  const images = createMemo(() =>
    props.parts.filter((part): part is FilePart => part.type === "file" && part.mime.startsWith("image/")),
  )
  const user = () => props.message.role === "user"
  const streaming = () =>
    !user() && "completed" in props.message.time && typeof props.message.time.completed !== "number"
  const generatingSwipe = () => props.swipeBusy === props.message.id
  const openImage = (image: FilePart) => {
    const gallery = images().map((item) => ({
      id: item.id,
      src: resolveInlineImageUrl(item) ?? item.url,
      alt: item.filename ?? "酒馆图片",
    }))
    const index = gallery.findIndex((item) => item.id === image.id)
    const selected = gallery[index] ?? {
      src: resolveInlineImageUrl(image) ?? image.url,
      alt: image.filename ?? "酒馆图片",
    }
    dialog.show(() => <ImagePreview src={selected.src} alt={selected.alt} images={gallery} initialIndex={index} />)
  }
  return (
    <Show when={text() || images().length}>
      <article
        id={user() ? `tavern-message-${props.message.id}` : undefined}
        data-viewport-turn={user() ? props.message.id : undefined}
        class="mb-6 flex w-full"
        classList={{ "justify-end": user(), "justify-start": !user() }}
      >
        <div
          class="text-14-regular leading-6"
          classList={{
            "max-w-[82%] rounded-2xl border border-icon-info-base bg-icon-info-base px-4 py-3 text-white shadow-sm":
              user(),
            "w-full px-0 py-1 text-text-strong": !user(),
          }}
        >
          <div class="mb-2 flex items-center gap-2 text-11-medium opacity-70">
            <span>{user() ? "你" : props.characterName}</span>
            <Show when={!props.opening && !user() && swipe()}>
              {(value) => (
                <Show when={primaryTextPart()}>
                  {(part) => (
                    <span class="inline-flex items-center rounded-md border border-border-base">
                      <button
                        type="button"
                        class="px-1.5 py-0.5 hover:bg-surface-base-hover"
                        disabled={!!props.swipeBusy}
                        aria-label="上一条回复分支"
                        onClick={() =>
                          props.onSwipeChange(
                            props.message,
                            part(),
                            value().swipes,
                            (value().swipeID - 1 + value().swipes.length) % value().swipes.length,
                          )
                        }
                      >
                        ‹
                      </button>
                      <span class="px-1">
                        回复 {value().swipeID + 1}/{value().swipes.length}
                      </span>
                      <button
                        type="button"
                        class="px-1.5 py-0.5 hover:bg-surface-base-hover"
                        disabled={!!props.swipeBusy}
                        aria-label="下一条回复分支"
                        onClick={() =>
                          props.onSwipeChange(
                            props.message,
                            part(),
                            value().swipes,
                            (value().swipeID + 1) % value().swipes.length,
                          )
                        }
                      >
                        ›
                      </button>
                      <button
                        type="button"
                        class="border-l border-border-base px-1.5 py-0.5 hover:bg-surface-base-hover"
                        disabled={!!props.swipeBusy}
                        aria-label="删除当前回复分支"
                        title="删除当前候选"
                        onClick={() => props.onSwipeDelete(props.message, part())}
                      >
                        删除
                      </button>
                    </span>
                  )}
                </Show>
              )}
            </Show>
            <Show when={!user() && props.roadwayEnabled}>
              <button
                type="button"
                class="rounded-md px-1.5 py-0.5 text-11-medium hover:bg-surface-base-hover"
                disabled={props.roadwayBusy || streaming()}
                aria-label="生成 Roadway 剧情建议"
                onClick={() => props.onRoadwayGenerate(props.message.id)}
              >
                {props.roadwayBusy ? "生成中…" : "Roadway"}
              </button>
            </Show>
          </div>
          <Show when={images().length > 0}>
            <div class="mb-3 flex flex-wrap gap-2">
              <For each={images()}>
                {(image) => (
                  <button
                    type="button"
                    class="overflow-hidden rounded-md border border-border-base bg-background-base"
                    aria-label={`查看图片 ${image.filename ?? "酒馆图片"}`}
                    onClick={() => openImage(image)}
                  >
                    <ThumbnailImage
                      src={image.url}
                      resolveSrc={() => resolveInlineImageUrl(image)}
                      alt={image.filename ?? "酒馆图片"}
                      cacheKey={image.id}
                      class="max-h-60 max-w-full object-cover"
                      placeholderClass="h-24 w-24 bg-surface-base"
                    />
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={text()}>
            <TavernRichText
              text={text()}
              html={props.html}
              cacheKey={`tavern-page:${props.message.id}:${primaryTextPart()?.metadata?.tavern ? JSON.stringify(primaryTextPart()?.metadata?.tavern) : "default"}:${props.html ? "html" : "text"}`}
              streaming={streaming()}
            />
          </Show>
          <Show when={!props.opening}>
            <div class="mt-2 flex flex-wrap gap-1 text-11-medium">
              <Show when={user()}>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 hover:bg-surface-base-hover"
                  disabled={props.branchBusy}
                  aria-label="编辑到新分支"
                  onClick={() => props.onEdit(props.message as UserMessage, text())}
                >
                  编辑
                </button>
              </Show>
              <button
                type="button"
                class="rounded-md px-1.5 py-0.5 hover:bg-surface-base-hover"
                disabled={props.branchBusy}
                aria-label="从此处分支"
                onClick={() => props.onFork(props.message)}
              >
                {props.branchBusy ? "创建中…" : "分支"}
              </button>
              <button
                type="button"
                class="rounded-md px-1.5 py-0.5 hover:bg-surface-base-hover hover:text-icon-critical-base"
                disabled={props.messageDeleteBusy || streaming()}
                aria-label="删除当前酒馆消息"
                onClick={() => props.onDelete(props.message)}
              >
                {props.messageDeleteBusy ? "删除中…" : props.confirmingDelete ? "确认删除" : "删除"}
              </button>
              <Show when={!user()}>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 hover:bg-surface-base-hover"
                  disabled={!props.speechEnabled || streaming()}
                  aria-label="朗读角色回复"
                  onClick={() => props.onSpeak(text())}
                >
                  朗读
                </button>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 hover:bg-surface-base-hover"
                  disabled={props.branchBusy || !!props.swipeBusy || streaming()}
                  aria-label="重新生成角色回复"
                  onClick={() => props.onRegenerate(props.message as AssistantMessage)}
                >
                  重新生成
                </button>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 hover:bg-surface-base-hover"
                  disabled={props.branchBusy || !!props.swipeBusy || streaming()}
                  aria-label="生成新角色回复"
                  onClick={() => props.onGenerateSwipe(props.message as AssistantMessage)}
                >
                  {generatingSwipe() ? "生成中…" : "新回复"}
                </button>
              </Show>
            </div>
          </Show>
          <Show when={!user() && props.roadwayResult}>
            {(result) => (
              <TavernRoadwayCard
                messageID={props.message.id}
                result={result()}
                autoOpen={props.roadwayAutoOpen}
                showUseAction={props.roadwayShowUseAction}
                onUse={props.onRoadwayUse}
                onImpersonate={props.onRoadwayImpersonate}
                onResultChange={props.onRoadwayResultChange}
                onOptionChange={props.onRoadwayOptionChange}
              />
            )}
          </Show>
        </div>
      </article>
    </Show>
  )
}

function TavernRoadwayCard(props: {
  messageID: string
  result: TavernRoadwayResult
  autoOpen: boolean
  showUseAction: boolean
  onUse: (option: string) => void
  onImpersonate: (option: string) => void
  onResultChange: (messageID: string, patch: Partial<TavernRoadwayResult>) => void
  onOptionChange: (messageID: string, index: number, value: string) => void
}) {
  const [editing, setEditing] = createSignal<number>()
  const options = () => (props.result.options?.length ? props.result.options : [props.result.text])
  return (
    <details
      class="mt-3 rounded-lg border border-border-base bg-surface-raised-base text-text-base"
      open={props.result.expanded ?? props.autoOpen}
      onToggle={(event) => props.onResultChange(props.messageID, { expanded: event.currentTarget.open })}
    >
      <summary class="cursor-pointer px-3 py-2 text-12-medium">Roadway 剧情建议</summary>
      <div class="border-t border-border-base px-3 py-2">
        <For each={options()}>
          {(option, index) => (
            <div class="flex gap-2 border-b border-border-base py-2 last:border-b-0">
              <span class="shrink-0 pt-1 text-12-regular text-text-weak">{index() + 1}.</span>
              <div class="min-w-0 flex-1">
                <Show
                  when={editing() === index()}
                  fallback={<p class="whitespace-pre-wrap text-13-regular leading-5">{option}</p>}
                >
                  <textarea
                    class="block min-h-16 w-full resize-y rounded-md border border-border-base bg-background-base px-2 py-1 text-13-regular outline-none"
                    value={option}
                    autofocus
                    onBlur={(event) => {
                      props.onOptionChange(props.messageID, index(), event.currentTarget.value.trim() || option)
                      setEditing()
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                      event.preventDefault()
                      event.currentTarget.blur()
                    }}
                  />
                </Show>
                <div class="mt-1 flex items-center gap-1 text-11-medium">
                  <Show when={props.showUseAction}>
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 hover:bg-surface-base-hover"
                      onClick={() => props.onUse(option)}
                    >
                      使用
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 hover:bg-surface-base-hover"
                    onClick={() => props.onImpersonate(option)}
                  >
                    代入为我
                  </button>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 hover:bg-surface-base-hover"
                    onClick={() => setEditing(index())}
                  >
                    编辑
                  </button>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </details>
  )
}

function emptyTavernData(): TavernData {
  return {
    characters: [],
    worldbooks: [],
    sessions: {},
    settings: { roadway: defaultRoadwaySettings(), tts: normalizeTavernSpeechSettings() },
    roadway: { results: {} },
  }
}
