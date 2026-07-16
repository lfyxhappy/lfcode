import type { Message, Session } from "@lfcode-ai/sdk/v2/client"
import { showToast } from "@lfcode-ai/ui/toast"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { Binary } from "@lfcode-ai/shared/util/binary"
import { useNavigate, useParams } from "@solidjs/router"
import { batch, type Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, type PromptScope, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { promptFeaturesSystem, type PromptFeature } from "@/utils/prompt-features"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { questionGuidanceSystem, type QuestionGuidance } from "@/utils/question-guidance"
import { buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
  questionGuidance?: QuestionGuidance
  promptFeatures?: PromptFeature[]
}

export type FollowupMode = "queue" | "steer"

type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  globalSync: ReturnType<typeof useGlobalSync>
  sync: ReturnType<typeof useSync>
  draft: FollowupDraft
  delivery?: "steer"
  messageID?: string
  initialPrompt?: boolean
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const [, setStore] = input.globalSync.child(input.draft.sessionDirectory)

  const setBusy = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "busy" })
    input.globalSync.sessionStatus.markBusy(input.draft.sessionDirectory, input.draft.sessionID)
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "idle" })
    input.globalSync.sessionStatus.stop(input.draft.sessionDirectory, input.draft.sessionID)
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const system = [questionGuidanceSystem(input.draft.questionGuidance), promptFeaturesSystem(input.draft.promptFeatures)]
    .filter(Boolean)
    .join("\n")

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  if (cmd && input.sync.data.command.find((item) => item.name === cmd)) {
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      await input.client.session.command({
        sessionID: input.draft.sessionID,
        command: cmd,
        arguments: tail.join(" "),
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: images.map((attachment) => ({
          id: Identifier.ascending("part"),
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.filename,
        })),
      })
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images,
    text,
    sessionID: input.draft.sessionID,
    messageID,
    sessionDirectory: input.draft.sessionDirectory,
  })

  const message: Message = {
    id: messageID,
    sessionID: input.draft.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.draft.agent,
    model: { ...input.draft.model, variant: input.draft.variant },
  }

  const add = () =>
    input.sync.session.optimistic.add({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      message,
      parts: optimisticParts,
    })

  const remove = () =>
    input.sync.session.optimistic.remove({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      messageID,
    })

  batch(() => {
    setBusy()
    add()
  })

  try {
    if (!(await wait())) {
      batch(() => {
        setIdle()
        remove()
      })
      return false
    }

    const sendPrompt = input.client.session.promptAsync({
      sessionID: input.draft.sessionID,
      agent: input.draft.agent,
      model: input.draft.model,
      delivery: input.delivery,
      messageID,
      parts: requestParts,
      variant: input.draft.variant,
      system: system || undefined,
    })

    await sendPrompt
    return true
  } catch (err) {
    batch(() => {
      setIdle()
      remove()
    })
    throw err
  }
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  selectedTextCount?: Accessor<number>
  autoAccept: Accessor<boolean>
  mode: Accessor<"normal" | "shell">
  streaming: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  followupMode?: Accessor<FollowupMode | undefined>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  scope?: Accessor<PromptScope | undefined>
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()
  const scope = () => input.scope?.()
  const activePrompt = () => prompt.scope(scope())
  const sessionID = () => scope()?.id ?? params.id
  const sessionDirectory = () => scope()?.dir ?? sdk.directory
  const client = () => {
    const directory = sessionDirectory()
    if (directory === sdk.directory) return sdk.client
    return sdk.createClient({
      directory,
      throwOnError: true,
    })
  }

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const abort = async (options?: { pauseQueue?: boolean; clearTodo?: boolean }) => {
    const currentSessionID = sessionID()
    if (!currentSessionID) return Promise.resolve()

    if (options?.clearTodo !== false) {
      globalSync.todo.set(currentSessionID, [])
      const [, setStore] = globalSync.child(sessionDirectory())
      setStore("todo", currentSessionID, [])
    }

    if (options?.pauseQueue !== false) input.onAbort?.()

    const queued = pending.get(currentSessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(currentSessionID)
      return Promise.resolve()
    }
    return client()
      .session
      .abort({
        sessionID: currentSessionID,
      })
      .catch(() => {})
  }

  const restoreCommentItems = (items: CommentItem[]) => {
    for (const item of items) {
      activePrompt().context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })
    }
  }

  const removeCommentItems = (items: { key: string }[]) => {
    for (const item of items) {
      activePrompt().context.remove(item.key)
    }
  }

  const clearContext = () => {
    for (const item of activePrompt().context.items()) {
      activePrompt().context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    const [, setStore] = globalSync.child(dir)
    setStore("session", (list: Session[]) => {
      const result = Binary.search(list, info.id, (item) => item.id)
      const next = [...list]
      if (result.found) {
        next[result.index] = info
        return next
      }
      next.splice(result.index, 0, info)
      return next
    })
  }

  const invertFollowupMode = (mode: FollowupMode | undefined) =>
    mode === "queue" ? "steer" : mode === "steer" ? "queue" : undefined

  const handleSubmit = async (event: Event, options?: { invertFollowupMode?: boolean }) => {
    event.preventDefault()

    const currentPrompt = activePrompt().current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (
      text.trim().length === 0 &&
      images.length === 0 &&
      input.commentCount() === 0 &&
      (input.selectedTextCount?.() ?? 0) === 0
    ) {
      if (input.streaming()) void abort()
      return
    }

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const variant = local.model.variant.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()

    const projectDirectory = sessionDirectory()
    const isNewSession = !sessionID()
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = input.newSessionWorktree?.() || "main"

    let targetDirectory = projectDirectory
    let targetClient = client()

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await targetClient.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        targetDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        targetDirectory = worktreeSelection
      }

      if (targetDirectory !== projectDirectory) {
        targetClient = sdk.createClient({
          directory: targetDirectory,
          throwOnError: true,
        })
        globalSync.child(targetDirectory)
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      const created = await targetClient.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        seed(targetDirectory, created)
        session = created
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, targetDirectory)
        local.session.promote(targetDirectory, session.id)
        layout.handoff.setTabs(base64Encode(targetDirectory), session.id)
        navigate(`/${base64Encode(targetDirectory)}/session/${session.id}`)
      }
    }
    if (!session) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const questionGuidance = local.questionGuidance.current()
    const promptFeatures = local.promptFeatures.current()
    const context = activePrompt().context.items().slice()
    const draft: FollowupDraft = {
      sessionID: session.id,
      sessionDirectory: targetDirectory,
      prompt: currentPrompt,
      context,
      agent,
      model,
      variant,
      questionGuidance,
      promptFeatures,
    }

    const clearInput = () => {
      activePrompt().reset()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      activePrompt().set(currentPrompt, input.promptLength(currentPrompt))
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
    }

    const followupMode =
      !isNewSession && mode === "normal"
        ? input.streaming()
          ? "steer"
          : options?.invertFollowupMode
          ? invertFollowupMode(input.followupMode?.())
          : input.followupMode?.()
        : undefined

    if (followupMode === "queue") {
      input.onQueue?.(draft)
      clearContext()
      clearInput()
      return
    }

    input.onSubmit?.()

    if (mode === "shell") {
      clearInput()
      targetClient.session
        .shell({
          sessionID: session.id,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        clearInput()
        targetClient.session
          .command({
            sessionID: session.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: images.map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.dataUrl,
              filename: attachment.filename,
            })),
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: formatServerError(err, language.t, language.t("common.requestFailed")),
            })
            restoreInput()
          })
        return
      }
    }

    const commentItems = context.filter((item) => item.type === "file" && !!item.comment?.trim())
    const messageID = Identifier.ascending("message")

    const removeOptimisticMessage = () => {
      sync.session.optimistic.remove({
        directory: targetDirectory,
        sessionID: session.id,
        messageID,
      })
    }

    removeCommentItems(commentItems)
    clearInput()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(targetDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (targetDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (targetDirectory === projectDirectory) {
          sync.set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(session.id, { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(targetDirectory), abortWait, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(session.id)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    void sendFollowupDraft({
      client: targetClient,
      sync,
      globalSync,
      draft,
      delivery: followupMode === "steer" ? "steer" : undefined,
      messageID,
      initialPrompt: isNewSession,
      optimisticBusy: targetDirectory === projectDirectory,
      before: waitForWorktree,
    }).catch((err) => {
      pending.delete(session.id)
      if (targetDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreCommentItems(commentItems)
      restoreInput()
    })
  }

  return {
    abort,
    handleSubmit,
  }
}
