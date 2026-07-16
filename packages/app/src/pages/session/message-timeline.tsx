import { For, createEffect, createMemo, on, onCleanup, Show, Index, type JSX, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@lfcode-ai/ui/button"
import { FileIcon } from "@lfcode-ai/ui/file-icon"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { InlineInput } from "@lfcode-ai/ui/inline-input"
import { Spinner } from "@lfcode-ai/ui/spinner"
import { SessionTurn } from "@lfcode-ai/ui/session-turn"
import type { RenderCodeBlockInput } from "@lfcode-ai/ui/message-code-blocks"
import type { HtmlComponentEventDetail } from "@lfcode-ai/ui/markdown"
import { ScrollView } from "@lfcode-ai/ui/scroll-view"
import { TextField } from "@lfcode-ai/ui/text-field"
import type { VirtualizerHandle } from "virtua/solid"
import type { FileReferenceContextValue } from "@lfcode-ai/ui/context/file-reference"
import type { Message as MessageType, Part, TextPart, UserMessage } from "@lfcode-ai/sdk/v2"
import { showToast } from "@lfcode-ai/ui/toast"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { buildMessageTimelineModel } from "@/pages/session/message-timeline-model"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { useSessionKey } from "@/pages/session/session-layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { messageAgentColor } from "@/utils/agent"
import { isSessionWorking } from "@/utils/session-status"
import { sessionTitle } from "@/utils/session-title"
import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { makeTimer } from "@solid-primitives/timer"
import { ComposeRouteStatusBadge } from "./compose-route-banner"
import { isCodeEditorFenceLanguageSupported } from "@/components/code-editor/core/language"
import { CppMessageBlock } from "./cpp-message-block"
import { MessageCodeBlock } from "./message-code-block"
import { buildSessionMenuActions, type MenuAction, sessionDeeplink } from "../layout/menu-actions"

type MessageComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

const emptyMessages: MessageType[] = []
const idle = { type: "idle" as const }
type UserActions = {
  fork?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
}

const messageComments = (parts: Part[]): MessageComment[] =>
  parts.flatMap((part) => {
    if (part.type !== "text" || !(part as TextPart).synthetic) return []
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return []
    return [
      {
        path: next.path,
        comment: next.comment,
        selection: next.selection
          ? {
              startLine: next.selection.startLine,
              endLine: next.selection.endLine,
            }
          : undefined,
      },
    ]
  })

const taskDescription = (part: Part, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

const pace = (width: number) => Math.round(Math.max(1200, Math.min(3200, (Math.max(width, 360) * 2000) / 900)))

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

function indexTimelineMessages(messages: MessageType[]) {
  const turns = new Map<string, MessageType[]>()
  for (const message of messages) {
    const turnID = message.role === "user" ? message.id : message.role === "assistant" ? message.parentID : undefined
    if (!turnID) continue
    const turn = turns.get(turnID) ?? []
    turn.push(message)
    turns.set(turnID, turn)
  }
  return turns
}

function selectTimelineMessages(turns: Map<string, MessageType[]>, users: UserMessage[]) {
  return users.flatMap((message) => turns.get(message.id) ?? [])
}

export type MessageTimelineProps = {
  // A timeline must always be bound to an explicit session. Falling back to
  // the router makes an inactive surface accidentally render the active route.
  sessionID: () => string | undefined
  sessionKey: () => string
  embedded?: boolean
  mobileChanges: boolean
  mobileFallback: JSX.Element
  timelineVisible: boolean
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onTurnBackfillScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  centered: boolean
  rightInset?: boolean
  setContentRef: (el: HTMLDivElement) => void
  turnStart: number
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  timelineMessages: MessageType[]
  renderedUserMessages: UserMessage[]
  viewAgentID: string
  sessionActors: { actorID: string; mode: string; status: string; time: { created: number } }[]
  onViewAgentChange: (agentID: string) => void
  /** Canonical URL hash anchor. */
  anchor: (id: string) => string
  /** Surface-prefixed DOM anchor; prevents duplicate IDs across hot views. */
  domAnchor?: (id: string) => string
  fileReferences?: FileReferenceContextValue
  onOpenSideChat?: () => void
  onHtmlComponentEvent?: (detail: HtmlComponentEventDetail) => void
  onVirtualizerRef?: (handle: VirtualizerHandle | undefined) => void
  virtualizerCache?: () => VirtualizerHandle["cache"] | undefined
}

export function MessageTimeline(props: MessageTimelineProps) {
  let touchGesture: number | undefined

  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const dialog = useDialog()
  const language = useLanguage()
  const layout = useLayout()
  const notification = useNotification()
  const current = useSessionKey()
  const platform = usePlatform()
  const server = useServer()

  const sessionID = createMemo(props.sessionID)
  const sessionKey = createMemo(props.sessionKey)
  const timelineMessages = createMemo(() => props.timelineMessages ?? emptyMessages)
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })
  const working = createMemo(() => isSessionWorking(sessionStatus()))
  const tint = createMemo(() => messageAgentColor(timelineMessages(), sync.data.agent))
  const renderCodeBlock = (input: RenderCodeBlockInput) => {
    if (["cpp", "c++", "cc", "cxx"].includes(input.language)) {
      return (
        <CppMessageBlock
          blockKey={`${input.message.sessionID}:${input.message.id}:${input.partID}:${input.blockIndex}`}
          sessionID={input.message.sessionID}
          messageID={input.message.id}
          partID={input.partID}
          blockIndex={input.blockIndex}
          code={input.code}
        />
      )
    }
    if (!isCodeEditorFenceLanguageSupported(input.language)) return
    return (
      <MessageCodeBlock
        blockKey={`${input.message.sessionID}:${input.message.id}:${input.partID}:${input.blockIndex}`}
        sessionID={input.message.sessionID}
        messageID={input.message.id}
        partID={input.partID}
        blockIndex={input.blockIndex}
        languageID={input.language}
        code={input.code}
      />
    )
  }

  const [timeoutDone, setTimeoutDone] = createSignal(true)

  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (working()) return "showing"
    if (prev === "showing" || !timeoutDone()) return "hiding"
    return "hidden"
  })

  createEffect(() => {
    if (workingStatus() !== "hiding") return

    setTimeoutDone(false)
    makeTimer(() => setTimeoutDone(true), 260, setTimeout)
  })

  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const sessionDirectory = createMemo(() => info()?.directory ?? sdk.directory)
  const sessionPinned = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return layout.sessions.isPinned(sessionDirectory(), id)
  })
  const sessionUnread = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return notification.session.unseenCount(id) > 0
  })
  const canOpenInExplorer = createMemo(
    () => platform.platform === "desktop" && !!platform.openPath && server.isLocal() === true,
  )
  const canCopyDeeplink = createMemo(() => server.isLocal() === true)
  const parentID = createMemo(() => info()?.parentID)
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync.session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => sync.data.part[message.id] ?? [])
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!parentID()) return titleLabel() ?? ""
    if (childTaskDescription()) return childTaskDescription()
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })
  const showHeader = createMemo(() => !props.embedded && !!(titleValue() || parentID()))
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>()
  const rendered = createMemo(() => props.renderedUserMessages.map((message) => message.id))
  const timelineTurns = createMemo(() => indexTimelineMessages(timelineMessages()))
  const timelineWindow = createMemo(() => selectTimelineMessages(timelineTurns(), props.renderedUserMessages))
  const timelineModel = createMemo(() =>
    buildMessageTimelineModel({
      messages: timelineWindow(),
      renderedUsers: props.renderedUserMessages,
      partsByMessageID: sync.data.part,
      sessionCompacting: info()?.time.compacting,
    }),
  )
  const timelineContext = createMemo(() => timelineModel().context)
  const turnLookup = createMemo(() => timelineModel().turnLookup)

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })
  const [bar, setBar] = createStore({
    ms: pace(640),
  })

  let more: HTMLButtonElement | undefined
  let head: HTMLDivElement | undefined

  createResizeObserver(
    () => head,
    () => {
      if (!head || head.clientWidth <= 0) return
      setBar("ms", pace(head.clientWidth))
    },
  )

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value).then(
      () => {
        showToast({ title: language.t("session.share.copy.copied") })
      },
      () => {
        showToast({ title: language.t("common.requestFailed") })
      },
    )
  }

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const shareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.share({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to share session", err)
    },
  }))

  const unshareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.unshare({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to unshare session", err)
    },
  }))

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk.client.session.update({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  const shareSession = () => {
    const id = sessionID()
    if (!id || shareMutation.isPending) return
    if (!shareEnabled()) return
    shareMutation.mutate(id)
  }

  const unshareSession = () => {
    const id = sessionID()
    if (!id || unshareMutation.isPending) return
    if (!shareEnabled()) return
    unshareMutation.mutate(id)
  }

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync.data.message[id] !== undefined) return
        void sync.session.sync(id)
      },
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (current.params.id !== sessionID) return
    if (parentID) {
      navigate(`/${current.params.dir}/session/${parentID}`)
      return
    }
    if (nextSessionID) {
      navigate(`/${current.params.dir}/session/${nextSessionID}`)
      return
    }
    navigate(`/${current.params.dir}/session`)
  }

  const archiveSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${current.params.dir}/session/${id}`)
  }

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const handleDelete = async () => {
      await deleteSession(props.sessionID)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const sessionMenuActions = createMemo(() => {
    const id = sessionID()
    if (!id) return [] as MenuAction[]
    const extrasAfterRename = [] as MenuAction[]
    if (shareEnabled()) {
      extrasAfterRename.push({
        key: "share",
        kind: "item",
        label: language.t("session.share.action.share"),
        onSelect: () => {
          setTitle({ pendingShare: true, menuOpen: false })
        },
      })
    }
    if (props.onOpenSideChat) {
      extrasAfterRename.push({
        key: "open-side-chat",
        kind: "item",
        label: language.t("session.sideChat.open"),
        onSelect: () => {
          props.onOpenSideChat?.()
        },
      })
    }
    return buildSessionMenuActions({
      t: language.t,
      pinned: sessionPinned(),
      unread: sessionUnread(),
      canOpenInExplorer: canOpenInExplorer(),
      canCopyDeeplink: canCopyDeeplink(),
      extrasAfterRename,
      onTogglePinned: () => layout.sessions.togglePinned(sessionDirectory(), id),
      onRename: () => {
        setTitle("pendingRename", true)
        setTitle("menuOpen", false)
      },
      onArchive: () => void archiveSession(id),
      onMarkUnread: () => notification.session.markUnread(id, sessionDirectory()),
      onOpenInExplorer: () => void platform.openPath?.(sessionDirectory()),
      onCopyWorkingDirectory: () => void copyText(sessionDirectory()),
      onCopySessionID: () => void copyText(id),
      onCopyDeeplink: () => void copyText(sessionDeeplink(sessionDirectory(), id)),
      onFork: async () => {
        const result = await sdk.client.session.fork({ sessionID: id }).catch(() => undefined)
        if (!result?.data?.id) {
          showToast({ title: language.t("common.requestFailed") })
          return
        }
        const directory = result.data.directory ?? sessionDirectory()
        navigate(`/${base64Encode(directory)}/session/${result.data.id}`)
      },
      onDelete: () => dialog.show(() => <DialogDeleteSession sessionID={id} />),
    })
  })

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          data-component="timeline-resume-control"
          class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none"
          classList={{
            "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
            "opacity-0 translate-y-2 scale-95 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
          }}
        >
          <button
            class="pointer-events-auto flex items-center justify-center w-10 h-8 bg-transparent border-none cursor-pointer p-0 group"
            onClick={props.onResumeScroll}
          >
            <div
              class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border-weak-base)] group-hover:[--icon-base:var(--icon-hover)]"
              style={{
                "box-shadow":
                  "0 51px 60px 0 rgba(0,0,0,0.10), 0 15px 18px 0 rgba(0,0,0,0.12), 0 6.386px 7.513px 0 rgba(0,0,0,0.12), 0 2.31px 2.717px 0 rgba(0,0,0,0.20)",
              }}
            >
              <Icon name="arrow-down-to-line" size="small" />
            </div>
          </button>
        </div>
        <ScrollView
          viewportRef={(el) => {
            setScrollRoot(el)
            props.setScrollRef(el)
          }}
          onUserScrollIntent={() => props.onMarkScrollGesture()}
          onWheel={(e) => {
            const root = e.currentTarget
            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchStart={(e) => {
            touchGesture = e.touches[0]?.clientY
          }}
          onTouchMove={(e) => {
            const next = e.touches[0]?.clientY
            const prev = touchGesture
            touchGesture = next
            if (next === undefined || prev === undefined) return

            const delta = prev - next
            if (!delta) return

            const root = e.currentTarget
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchEnd={() => {
            touchGesture = undefined
          }}
          onTouchCancel={() => {
            touchGesture = undefined
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onScroll={(e) => {
            props.onScheduleScrollState(e.currentTarget)
            if (props.hasScrollGesture()) {
              props.onUserScroll()
              props.onMarkScrollGesture(e.currentTarget)
            }
            props.onAutoScrollHandleScroll()
            props.onTurnBackfillScroll()
          }}
          onClick={props.onAutoScrollInteraction}
          class="relative min-w-0 w-full h-full"
          style={{
            "--session-title-height": showHeader() ? "40px" : "0px",
            "--sticky-accordion-top": showHeader() ? "48px" : "0px",
          }}
        >
          <div
            ref={props.setContentRef}
            data-session-id={sessionID() ?? ""}
            class="min-w-0 w-full"
            style={{ width: props.rightInset ? "calc(100% - clamp(336px, 22vw, 440px))" : undefined }}
          >
            <Show when={showHeader()}>
              <div
                ref={(el) => {
                  head = el
                  setBar("ms", pace(el.clientWidth))
                }}
                data-session-title
                classList={{
                  "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
                  relative: true,
                  "w-full": true,
                  "pb-4": true,
                  "pl-2 pr-3 md:pl-4 md:pr-3": true,
                  "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
                }}
              >
                <Show when={workingStatus() !== "hidden"}>
                  <div
                    data-component="session-progress"
                    data-state={workingStatus()}
                    aria-hidden="true"
                    style={{
                      "--session-progress-color": tint() ?? "var(--icon-interactive-base)",
                      "--session-progress-ms": `${bar.ms}ms`,
                    }}
                  >
                    <div data-component="session-progress-bar" />
                  </div>
                </Show>
                <div class="h-12 w-full flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
                    <div class="flex items-center min-w-0 grow-1">
                      <Show when={parentID()}>
                        <button
                          type="button"
                          data-slot="session-title-parent"
                          class="min-w-0 max-w-[40%] truncate text-14-medium text-text-weak transition-colors hover:text-text-base"
                          onClick={navigateParent}
                        >
                          {parentTitle()}
                        </button>
                        <span
                          data-slot="session-title-separator"
                          class="px-2 text-14-medium text-text-weak"
                          aria-hidden="true"
                        >
                          /
                        </span>
                      </Show>
                      <div
                        data-component="timeline-working-indicator"
                        class="shrink-0 flex items-center justify-center overflow-hidden"
                        style={{
                          width: working() ? "16px" : "0px",
                          "margin-right": working() ? "8px" : "0px",
                        }}
                        aria-hidden="true"
                      >
                        <Show when={workingStatus() !== "hidden"}>
                          <div
                            data-component="timeline-working-spinner"
                            classList={{ "opacity-0": workingStatus() === "hiding" }}
                          >
                            <Spinner class="size-4" style={{ color: tint() ?? "var(--icon-interactive-base)" }} />
                          </div>
                        </Show>
                      </div>
                      <Show when={childTitle() || title.editing}>
                        <Show
                          when={title.editing}
                          fallback={
                            <h1
                              data-slot="session-title-child"
                              class="text-14-medium text-text-strong truncate grow-1 min-w-0"
                              onDblClick={openTitleEditor}
                            >
                              {childTitle()}
                            </h1>
                          }
                        >
                          <InlineInput
                            ref={(el) => {
                              titleRef = el
                            }}
                            data-slot="session-title-child"
                            value={title.draft}
                            disabled={titleMutation.isPending}
                            class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                            style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                            onInput={(event) => setTitle("draft", event.currentTarget.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === "Enter") {
                                event.preventDefault()
                                void saveTitleEditor()
                                return
                              }
                              if (event.key === "Escape") {
                                event.preventDefault()
                                closeTitleEditor()
                              }
                            }}
                            onBlur={closeTitleEditor}
                          />
                        </Show>
                      </Show>
                      <Show when={info()?.composeRoute}>
                        {(route) => (
                          <div class="ml-2 shrink-0 min-w-0">
                            <ComposeRouteStatusBadge route={route()} />
                          </div>
                        )}
                      </Show>
                    </div>
                  </div>
                  <Show when={sessionID()}>
                    {(id) => (
                      <div class="shrink-0 flex items-center gap-3">
                        <Show when={!parentID()}>
                          <DropdownMenu
                            gutter={4}
                            placement="bottom-end"
                            open={title.menuOpen}
                            onOpenChange={(open) => {
                              setTitle("menuOpen", open)
                              if (open) return
                            }}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="dot-grid"
                              variant="ghost"
                              class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                              classList={{
                                "bg-surface-base-active": share.open || title.pendingShare,
                              }}
                              aria-label={language.t("common.moreOptions")}
                              aria-expanded={title.menuOpen || share.open || title.pendingShare}
                              ref={(el: HTMLButtonElement) => {
                                more = el
                              }}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                style={{ "min-width": "104px" }}
                                onCloseAutoFocus={(event) => {
                                  if (title.pendingRename) {
                                    event.preventDefault()
                                    setTitle("pendingRename", false)
                                    openTitleEditor()
                                    return
                                  }
                                  if (title.pendingShare) {
                                    event.preventDefault()
                                    requestAnimationFrame(() => {
                                      setShare({ open: true, dismiss: null })
                                      setTitle("pendingShare", false)
                                    })
                                  }
                                }}
                              >
                                <For each={sessionMenuActions()}>
                                  {(action) =>
                                    action.kind === "separator" ? (
                                      <DropdownMenu.Separator />
                                    ) : (
                                      <DropdownMenu.Item disabled={action.disabled} onSelect={action.onSelect}>
                                        <DropdownMenu.ItemLabel>{action.label}</DropdownMenu.ItemLabel>
                                      </DropdownMenu.Item>
                                    )
                                  }
                                </For>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>

                          <KobaltePopover
                            open={share.open}
                            anchorRef={() => more}
                            placement="bottom-end"
                            gutter={4}
                            modal={false}
                            onOpenChange={(open) => {
                              if (open) setShare("dismiss", null)
                              setShare("open", open)
                            }}
                          >
                            <KobaltePopover.Portal>
                              <KobaltePopover.Content
                                data-component="popover-content"
                                style={{ "min-width": "320px" }}
                                onEscapeKeyDown={(event) => {
                                  setShare({ dismiss: "escape", open: false })
                                  event.preventDefault()
                                  event.stopPropagation()
                                }}
                                onPointerDownOutside={() => {
                                  setShare({ dismiss: "outside", open: false })
                                }}
                                onFocusOutside={() => {
                                  setShare({ dismiss: "outside", open: false })
                                }}
                                onCloseAutoFocus={(event) => {
                                  if (share.dismiss === "outside") event.preventDefault()
                                  setShare("dismiss", null)
                                }}
                              >
                                <div class="flex flex-col p-3">
                                  <div class="flex flex-col gap-1">
                                    <div class="text-13-medium text-text-strong">
                                      {language.t("session.share.popover.title")}
                                    </div>
                                    <div class="text-12-regular text-text-weak">
                                      {shareUrl()
                                        ? language.t("session.share.popover.description.shared")
                                        : language.t("session.share.popover.description.unshared")}
                                    </div>
                                  </div>
                                  <div class="mt-3 flex flex-col gap-2">
                                    <Show
                                      when={shareUrl()}
                                      fallback={
                                        <Button
                                          size="large"
                                          variant="primary"
                                          class="w-full"
                                          onClick={shareSession}
                                          disabled={shareMutation.isPending}
                                        >
                                          {shareMutation.isPending
                                            ? language.t("session.share.action.publishing")
                                            : language.t("session.share.action.publish")}
                                        </Button>
                                      }
                                    >
                                      <div class="flex flex-col gap-2">
                                        <TextField
                                          value={shareUrl() ?? ""}
                                          readOnly
                                          copyable
                                          copyKind="link"
                                          tabIndex={-1}
                                          class="w-full"
                                        />
                                        <div class="grid grid-cols-2 gap-2">
                                          <Button
                                            size="large"
                                            variant="secondary"
                                            class="w-full shadow-none border border-border-weak-base"
                                            onClick={unshareSession}
                                            disabled={unshareMutation.isPending}
                                          >
                                            {unshareMutation.isPending
                                              ? language.t("session.share.action.unpublishing")
                                              : language.t("session.share.action.unpublish")}
                                          </Button>
                                          <Button
                                            size="large"
                                            variant="primary"
                                            class="w-full"
                                            onClick={viewShare}
                                            disabled={unshareMutation.isPending}
                                          >
                                            {language.t("session.share.action.view")}
                                          </Button>
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </KobaltePopover.Content>
                            </KobaltePopover.Portal>
                          </KobaltePopover>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </div>
            </Show>
            <div
              role="log"
              data-slot="session-turn-list"
              data-compaction-state={timelineModel().attributes.compactionState}
              data-active-context-boundary-id={timelineModel().attributes.activeContextBoundaryID}
              data-active-context-boundary-kind={timelineModel().attributes.activeContextBoundaryKind}
              class="flex flex-col items-start justify-start pb-16 transition-[margin]"
              classList={{
                "w-full": true,
                "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
                "mt-0.5": props.centered,
                "mt-0": !props.centered,
              }}
            >
              <Show when={props.turnStart > 0 || props.historyMore}>
                <div class="w-full flex justify-center h-11">
                  <Button
                    variant="ghost"
                    size="large"
                    class="text-12-medium opacity-50"
                    disabled={props.historyLoading}
                    onClick={props.onLoadEarlier}
                  >
                    {props.historyLoading
                      ? language.t("session.messages.loadingEarlier")
                      : language.t("session.messages.loadEarlier")}
                  </Button>
                </div>
              </Show>
              <For each={rendered()}>
                {(messageID) => {
                  const turn = createMemo(() => turnLookup().turns.get(messageID))
                  const comments = createMemo(() => messageComments(sync.data.part[messageID] ?? []), [], {
                    equals: (a, b) =>
                      a.length === b.length &&
                      a.every(
                        (c, i) =>
                          c.path === b[i].path &&
                          c.comment === b[i].comment &&
                          c.selection?.startLine === b[i].selection?.startLine &&
                          c.selection?.endLine === b[i].selection?.endLine,
                      ),
                  })
                  const commentCount = createMemo(() => comments().length)
                  return (
                    <div
                      id={(props.domAnchor ?? props.anchor)(messageID)}
                      data-message-id={messageID}
                      data-viewport-anchor={messageID}
                      data-viewport-turn={messageID}
                      data-virtual-timeline-item
                      data-assistant-ids={
                        turn()
                          ?.assistantMessages.map((message) => message.id)
                          .join(",") ?? ""
                      }
                      classList={{
                        "min-w-0 w-full max-w-full": true,
                        "md:max-w-200 2xl:max-w-[1000px]": props.centered,
                      }}
                      style={{
                        "overflow-anchor": "none",
                      }}
                    >
                      <Show when={commentCount() > 0}>
                        <div class="w-full px-4 md:px-5 pb-2">
                          <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                            <div class="flex w-max min-w-full justify-end gap-2">
                              <Index each={comments()}>
                                {(commentAccessor: () => MessageComment) => {
                                  const comment = createMemo(() => commentAccessor())
                                  return (
                                    <Show when={comment()}>
                                      {(c) => (
                                        <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                                          <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                                            <FileIcon
                                              node={{ path: c().path, type: "file" }}
                                              class="size-3.5 shrink-0"
                                            />
                                            <span class="truncate">{getFilename(c().path)}</span>
                                            <Show when={c().selection}>
                                              {(selection) => (
                                                <span class="shrink-0 text-text-weak">
                                                  {selection().startLine === selection().endLine
                                                    ? `:${selection().startLine}`
                                                    : `:${selection().startLine}-${selection().endLine}`}
                                                </span>
                                              )}
                                            </Show>
                                          </div>
                                          <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                                            {c().comment}
                                          </div>
                                        </div>
                                      )}
                                    </Show>
                                  )
                                }}
                              </Index>
                            </div>
                          </div>
                        </div>
                      </Show>
                      <SessionTurn
                        sessionID={sessionID() ?? ""}
                        messageID={messageID}
                        turn={turn}
                        messages={timelineWindow}
                        anchor={props.domAnchor ?? props.anchor}
                        actions={props.actions}
                        showReasoningSummaries={settings.general.showReasoningSummaries()}
                        shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                        editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                        classes={{
                          root: "min-w-0 w-full relative",
                          content: "flex flex-col justify-between !overflow-visible",
                          container: "w-full px-4 md:px-5",
                        }}
                        fileReferences={props.fileReferences}
                        onHtmlComponentEvent={props.onHtmlComponentEvent}
                        renderCodeBlock={renderCodeBlock}
                      />
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </ScrollView>
      </div>
    </Show>
  )
}
