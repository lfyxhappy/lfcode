import type { UserMessage } from "@lfcode-ai/sdk/v2"
import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { PromptInput } from "@/components/prompt-input"
import { SessionTimelineSurface } from "@/pages/session/session-timeline-surface"
import { createSessionContentSignature, sessionContentRevision } from "@/pages/session/session-view-state"
import { TimelineVirtualController } from "@/pages/session/timeline-virtual-controller"
import { findTimelineViewportAnchor } from "@/pages/session/timeline-viewport-anchor"
import { registerSessionViewSurface, transitionSessionViewSurface } from "@/pages/session/session-viewport-registry"
import { isSessionStreaming } from "@/utils/session-status"
import { createSessionStorageKey } from "@/utils/session-key"
import type { VirtualizerHandle } from "virtua/solid"

export function SideChatPanel(props: {
  sessionID: string
  active: boolean
  setContentRef?: (el: HTMLDivElement) => void
  inputRef?: (el: HTMLDivElement) => void
}) {
  const sdk = useSDK()
  const layout = useLayout()
  const sync = useSync()
  const sessionKey = createMemo(() => createSessionStorageKey(sdk.directory, props.sessionID))
  const viewportKey = createMemo(() => `${sessionKey()}/side-chat`)
  const [refreshAfterBusy, setRefreshAfterBusy] = createSignal(false)
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>()
  const [mounted, setMounted] = createSignal(true)
  let viewportController: TimelineVirtualController | undefined
  let timelineVirtualizer: VirtualizerHandle | undefined
  let dropRoot: HTMLDivElement | undefined
  const [ui, setUi] = createStore({
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
    },
  })

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const renderedUserMessages = createMemo(() => messages().filter((message): message is UserMessage => message.role === "user"))
  const contentRevision = createMemo(() => {
    const timeline = messages()
    const tail = timeline.at(-1)
    return sessionContentRevision(
      viewportKey(),
      createSessionContentSignature({
        status: sync.data.session_status[props.sessionID]?.type ?? "idle",
        updatedAt: sync.session.get(props.sessionID)?.time.updated,
        messageCount: timeline.length,
        tailMessage: tail,
        tailParts: tail ? sync.data.part[tail.id] : undefined,
      }),
    )
  })
  const promptScope = createMemo(() => ({ dir: sdk.directory, id: props.sessionID }))

  const freeze = () => {
    viewportController?.flush()
    viewportController?.cancelRestore()
  }

  const resume = () => {
    setMounted(true)
    requestAnimationFrame(() => {
      if (!props.active) return
      viewportController?.activate()
      viewportController?.notifyDataReady()
    })
  }

  const cool = () => {
    viewportController?.deactivate()
    setMounted(false)
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop < 4
    setUi("scroll", {
      overflow: el.scrollHeight > el.clientHeight + 1,
      bottom,
      jump: !bottom,
    })
    viewportController?.scheduleCapture()
  }

  const scrollToBottom = () => {
    const el = scrollRoot()
    if (!el) return
    el.scrollTop = el.scrollHeight
    scheduleScrollState(el)
  }

  const resumeScroll = () => {
    viewportController?.cancelRestore()
    scrollToBottom()
    viewportController?.scheduleCapture()
  }

  const markScrollGesture = (target?: EventTarget | null) => {
    if (target && target !== scrollRoot()) return
    setUi("scrollGesture", Date.now())
    viewportController?.cancelForUserInput()
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < 500
  const scheduleCurrentScrollState = () => {
    const root = scrollRoot()
    if (!root) return
    if (hasScrollGesture()) viewportController?.cancelForUserInput()
    scheduleScrollState(root)
  }

  const findAnchor = findTimelineViewportAnchor

  const anchorElement = (root: HTMLDivElement, blockID: string) =>
    [...root.querySelectorAll<HTMLElement>("[data-viewport-anchor]")].find(
      (item) => item.dataset.viewportAnchor === blockID,
    )
  const turnElement = (root: HTMLDivElement, turnID: string) =>
    [...root.querySelectorAll<HTMLElement>("[data-viewport-turn]")].find((item) => item.dataset.viewportTurn === turnID)

  viewportController = new TimelineVirtualController({
    active: () => ({
      key: viewportKey(),
      sessionID: props.sessionID,
      assistantRevision: String(contentRevision()),
      streaming: isSessionStreaming(sync.data.session_status[props.sessionID]),
    }),
    ready: () => sync.data.message[props.sessionID] !== undefined,
    root: scrollRoot,
    virtualizer: () => timelineVirtualizer,
    state: (key) => layout.view(key).sessionState(),
    persist: (key, state) => layout.view(key).setSessionState(state),
    turnStart: () => 0,
    setTurnStart: () => {},
    resetHistoryToRecent: () => {},
    prepareAnchorWindow: () => false,
    historyMore: () => false,
    historyLoading: () => false,
    loadHistory: async () => {},
    findAnchor,
    anchorElement,
    turnElement,
    pauseAutoScroll: () => {},
    scrollToBottom,
    turnIDs: () => renderedUserMessages().map((message) => message.id),
  })

  createEffect(
    on(
      () => [props.sessionID, scrollRoot(), messages().length] as const,
      ([sessionID, root]) => {
        if (!root) return
        viewportController?.setRoot(root)
        if (sessionID !== props.sessionID) return
        viewportController?.activate()
        viewportController?.notifyLayout()
      },
      { defer: true },
    ),
  )

  onCleanup(() => viewportController?.dispose())

  createEffect(
    on(
      () => [viewportKey(), props.sessionID] as const,
      ([key, sessionID]) => {
        onCleanup(
          registerSessionViewSurface({
            key,
            sessionID,
            surface: "side-chat",
            phase: props.active ? "active" : "frozen",
            freeze,
            resume,
            cool,
            estimateWeight: () => renderedUserMessages().length,
          }),
        )
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [viewportKey(), props.active] as const,
      ([key, active]) => transitionSessionViewSurface(key, active ? "active" : "frozen"),
      { defer: true },
    ),
  )

  createEffect(() => {
    if (sync.data.message[props.sessionID] !== undefined) return
    void sync.session.sync(props.sessionID, { force: true })
  })

  createEffect(
    on(
      () => sync.data.session_status[props.sessionID]?.type ?? "idle",
      (status) => {
        if (status === "busy" || status === "retry") {
          setRefreshAfterBusy(true)
          return
        }
        if (!refreshAfterBusy() && !isSessionStreaming(sync.data.session_status[props.sessionID])) return
        setRefreshAfterBusy(false)
        void sync.session.sync(props.sessionID, { force: true })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [messages().length, sync.data.session_status[props.sessionID]?.type] as const,
      () => {
        if (!props.active) return
        if (!isSessionStreaming(sync.data.session_status[props.sessionID])) return
        if (!ui.scroll.bottom) return
        requestAnimationFrame(resumeScroll)
      },
      { defer: true },
    ),
  )

  return (
    <div
      ref={(el) => (dropRoot = el)}
      data-component="side-chat-panel"
      data-session-id={props.sessionID}
      data-session-dropzone
      class="h-full min-w-0 bg-background-base flex flex-col"
    >
      <Show when={mounted()}>
        <div class="flex-1 min-h-0 overflow-hidden" aria-hidden={!props.active} inert={!props.active}>
          <SessionTimelineSurface
            surface="side-chat"
            embedded
            sessionID={() => props.sessionID}
            sessionKey={sessionKey}
            mobileChanges={false}
            mobileFallback={<div />}
            timelineVisible
            scroll={ui.scroll}
            onResumeScroll={resumeScroll}
            setScrollRef={setScrollRoot}
            onScheduleScrollState={scheduleScrollState}
            onAutoScrollHandleScroll={scheduleCurrentScrollState}
            onMarkScrollGesture={markScrollGesture}
            hasScrollGesture={hasScrollGesture}
            onUserScroll={scheduleCurrentScrollState}
            onTurnBackfillScroll={() => {}}
            onAutoScrollInteraction={() => markScrollGesture(scrollRoot())}
            centered={false}
            setContentRef={(el) => props.setContentRef?.(el)}
            turnStart={0}
            historyMore={false}
            historyLoading={false}
            onLoadEarlier={() => {}}
            timelineMessages={messages()}
            renderedUserMessages={renderedUserMessages()}
            viewAgentID="main"
            sessionActors={[]}
            onViewAgentChange={() => {}}
            anchor={(id) => `side-chat-${props.sessionID}-${id}`}
            onVirtualizerRef={(handle) => {
              timelineVirtualizer = handle
              viewportController?.setVirtualizer(handle)
            }}
            turnIDs={() => renderedUserMessages().map((message) => message.id)}
            contentRevision={() => String(contentRevision())}
          />
        </div>
        <div class="shrink-0 w-full bg-background-stronger pb-3 pt-2" aria-hidden={!props.active} inert={!props.active}>
          <div class="w-full px-3">
            <PromptInput
              ref={(el) => {
                props.inputRef?.(el)
              }}
              scope={promptScope()}
              dropRoot={() => dropRoot}
              suspendUntilReady={false}
              onSubmit={() => {
                void sync.session.sync(props.sessionID, { force: true })
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  )
}
