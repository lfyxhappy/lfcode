import type { VirtualizerHandle } from "virtua/solid"
import {
  createSessionViewStateV4,
  createSessionViewportStateV4,
  shouldRestoreSessionViewState,
  type SessionViewStateV4,
} from "./session-view-state"

type ActiveViewport = {
  key: string
  sessionID: string
  assistantRevision: string
  streaming: boolean
}

type ViewportAnchor = {
  blockID: string
  turnID: string
  element: HTMLElement
}

export type TimelineVirtualPhase = "idle" | "requested" | "preparing" | "committed" | "cancelled"

type TimelineVirtualDecision = {
  mode: "bottom" | "anchor"
  blockID?: string
  turnID?: string
  offsetPx?: number
}

export type TimelineVirtualDiagnostics = {
  phase: TimelineVirtualPhase
  key?: string
  saved?: TimelineVirtualDecision
  requested?: TimelineVirtualDecision
  resolved?: TimelineVirtualDecision
  fallback?: "missing" | "streaming" | "revision" | "anchor" | "history" | "none"
}

export type TimelineVirtualControllerOptions = {
  active: () => ActiveViewport | undefined
  ready: () => boolean
  root: () => HTMLDivElement | undefined
  virtualizer: () => VirtualizerHandle | undefined
  state: (key: string) => SessionViewStateV4 | undefined
  persist: (key: string, state: SessionViewStateV4) => void
  turnStart: () => number
  setTurnStart: (value: number) => void
  resetHistoryToRecent: () => void
  prepareAnchorWindow: (turnID: string, fallbackStart: number) => boolean
  historyMore: () => boolean
  historyLoading: () => boolean
  loadHistory: () => Promise<void>
  turnIDs: () => string[]
  findAnchor: (root: HTMLDivElement) => ViewportAnchor | undefined
  anchorElement: (root: HTMLDivElement, blockID: string) => HTMLElement | undefined
  turnElement: (root: HTMLDivElement, turnID: string) => HTMLElement | undefined
  pauseAutoScroll: () => void
  scrollToBottom: () => void
  onPhase?: (phase: TimelineVirtualPhase, detail: { key?: string; hot: boolean; virtualItems: number }) => void
}

type RestoreRequest = {
  token: number
  active: ActiveViewport
  state: SessionViewStateV4
  phase: TimelineVirtualPhase
}

/**
 * A single semantic restore transaction for a virtualized timeline. It never
 * interprets a new root's scrollTop as a previous session state.
 */
export class TimelineVirtualController {
  #options: TimelineVirtualControllerOptions
  #root: HTMLDivElement | undefined
  #virtualizer: VirtualizerHandle | undefined
  #captureTimer: number | undefined
  #frame: number | undefined
  #stabilityFrame: number | undefined
  #stabilityTimer: number | undefined
  #stabilityObserver: ResizeObserver | undefined
  #stabilitySignature: string | undefined
  #stabilityFrames = 0
  #request: RestoreRequest | undefined
  #committed: ActiveViewport | undefined
  #token = 0
  #diagnostics: TimelineVirtualDiagnostics = { phase: "idle", fallback: "none" }

  constructor(options: TimelineVirtualControllerOptions) {
    this.#options = options
  }

  setRoot(root: HTMLDivElement | undefined) {
    if (this.#root === root) return
    this.#detachRoot()
    this.#stopStabilityBarrier()
    this.#root = root
    this.#committed = undefined
    if (!root) return
    root.addEventListener("scroll", this.#onScroll, { passive: true })
    root.addEventListener("scrollend", this.#onScrollEnd)
  }

  setVirtualizer(handle: VirtualizerHandle | undefined) {
    this.#virtualizer = handle
    this.#prepare()
  }

  activate() {
    const active = this.#options.active()
    if (!active) return
    if (this.#sameActive(this.#committed, active)) return
    if (this.#sameActive(this.#request?.active, active)) {
      this.#prepare()
      return
    }
    this.cancelRestore()
    const stored = this.#options.state(active.key)
    const accepted = shouldRestoreSessionViewState({
      state: stored,
      assistantRevision: active.assistantRevision,
      streaming: active.streaming,
    })
    const state = accepted
      ? stored!
      : createSessionViewStateV4({
          viewport: {
            version: 4,
            mode: "bottom",
            assistantRevision: active.assistantRevision,
            historyTurnStart: 0,
            updatedAt: Date.now(),
          },
          turnStart: 0,
        })
    this.#diagnostics = {
      phase: "requested",
      key: active.key,
      saved: stored ? decisionFor(stored) : undefined,
      requested: decisionFor(state),
      fallback: accepted ? "none" : active.streaming ? "streaming" : stored ? "revision" : "missing",
    }
    this.#request = { token: ++this.#token, active, state, phase: "requested" }
    this.#emit("requested", active.key)
    this.#prepare()
  }

  deactivate() {
    this.flush()
    this.cancelRestore()
    this.#committed = undefined
  }

  notifyDataReady() {
    this.#prepare()
  }

  notifyLayout() {
    this.notifyDataReady()
  }

  scheduleCapture() {
    if (this.#request) return
    if (this.#captureTimer !== undefined) window.clearTimeout(this.#captureTimer)
    this.#captureTimer = window.setTimeout(() => {
      this.#captureTimer = undefined
      this.captureNow()
    }, 120)
  }

  captureNow() {
    if (this.#request) return
    const active = this.#options.active()
    const root = this.#root
    if (!active || !root || root !== this.#options.root()) return
    const anchor = this.#options.findAnchor(root)
    const viewport = createSessionViewportStateV4({
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      assistantRevision: active.assistantRevision,
      historyTurnStart: this.#options.turnStart(),
      anchorRenderBlockID: anchor?.blockID,
      anchorTurnID: anchor?.turnID,
      anchorTop: anchor?.element.getBoundingClientRect().top,
      viewportTop: root.getBoundingClientRect().top,
    })
    if (!viewport) return
    this.#diagnostics = {
      ...this.#diagnostics,
      key: active.key,
      saved: decisionFor(viewport),
    }
    this.#options.persist(
      active.key,
      createSessionViewStateV4({
        viewport,
        turnStart: this.#options.turnStart(),
      }),
    )
  }

  flush() {
    if (this.#captureTimer !== undefined) window.clearTimeout(this.#captureTimer)
    this.#captureTimer = undefined
    this.captureNow()
  }

  cancelForUserInput() {
    this.cancelRestore()
  }

  cancelRestore() {
    if (!this.#request) return
    const key = this.#request.active.key
    this.#request = undefined
    this.#token += 1
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame)
    this.#frame = undefined
    this.#stopStabilityBarrier()
    this.#diagnostics = { ...this.#diagnostics, phase: "cancelled", key }
    this.#emit("cancelled", key)
  }

  inspect() {
    return this.#diagnostics
  }

  dispose() {
    this.deactivate()
    if (this.#captureTimer !== undefined) window.clearTimeout(this.#captureTimer)
    this.#captureTimer = undefined
    this.#detachRoot()
    this.#stopStabilityBarrier()
    this.#virtualizer = undefined
  }

  #onScroll = () => this.scheduleCapture()

  #onScrollEnd = () => this.captureNow()

  #detachRoot() {
    if (!this.#root) return
    this.#root.removeEventListener("scroll", this.#onScroll)
    this.#root.removeEventListener("scrollend", this.#onScrollEnd)
  }

  #prepare() {
    const request = this.#request
    const root = this.#root
    const virtualizer = this.#virtualizer ?? this.#options.virtualizer()
    if (!request || !root || !virtualizer || !this.#options.ready()) return
    if (request.active.key !== this.#options.active()?.key || root !== this.#options.root()) return
    this.#virtualizer = virtualizer
    if (request.phase === "preparing") return
    request.phase = "preparing"
    this.#emit("preparing", request.active.key)

    const viewport = request.state.viewport
    if (viewport.mode === "bottom") {
      this.#options.resetHistoryToRecent()
      this.#queue(request.token, () => this.#prepareBottom(request.token))
      return
    }

    this.#options.pauseAutoScroll()
    if (this.#options.prepareAnchorWindow(viewport.anchorTurnID, viewport.historyTurnStart)) {
      this.#queue(request.token, () => this.#prepareAnchor(request.token))
      return
    }
    this.#prepareAnchor(request.token)
  }

  #prepareBottom(token: number) {
    const request = this.#current(token)
    const virtualizer = this.#virtualizer
    if (!request || !virtualizer) return
    this.#diagnostics = { ...this.#diagnostics, resolved: { mode: "bottom" } }
    const items = this.#options.turnIDs()
    if (items.length > 0) virtualizer.scrollToIndex(items.length - 1, { align: "end" })
    this.#queue(token, () => {
      const current = this.#current(token)
      if (!current) return
      this.#options.scrollToBottom()
      this.#awaitStability(token)
    })
  }

  #prepareAnchor(token: number, attempt = 0) {
    const request = this.#current(token)
    const virtualizer = this.#virtualizer
    const root = this.#root
    if (!request || !virtualizer || !root || request.state.viewport.mode !== "anchor") return
    const anchor = request.state.viewport
    const index = this.#options.turnIDs().indexOf(anchor.anchorTurnID)
    if (index < 0) {
      if (this.#options.historyMore() && !this.#options.historyLoading()) {
        this.#diagnostics = { ...this.#diagnostics, fallback: "history" }
        request.phase = "requested"
        void this.#options.loadHistory().finally(() => this.#prepare())
        return
      }
      this.#fallbackBottom(token)
      return
    }
    if (attempt === 0) virtualizer.scrollToIndex(index, { align: "start" })
    this.#queue(token, () => {
      const current = this.#current(token)
      if (!current || current.state.viewport.mode !== "anchor" || !this.#root) return
      const target =
        this.#options.anchorElement(this.#root, current.state.viewport.anchorRenderBlockID) ??
        this.#options.turnElement(this.#root, current.state.viewport.anchorTurnID)
      if (!target) {
        if (attempt < 2) {
          this.#prepareAnchor(token, attempt + 1)
          return
        }
        this.#fallbackBottom(token)
        return
      }
      const offset = target.getBoundingClientRect().top - this.#root.getBoundingClientRect().top
      this.#root.scrollTop = Math.max(0, this.#root.scrollTop + offset - current.state.viewport.offsetPx)
      this.#diagnostics = {
        ...this.#diagnostics,
        resolved: {
          mode: "anchor",
          blockID: target.dataset.viewportAnchor ?? current.state.viewport.anchorRenderBlockID,
          turnID: target.closest<HTMLElement>("[data-viewport-turn]")?.dataset.viewportTurn ?? current.state.viewport.anchorTurnID,
          offsetPx: current.state.viewport.offsetPx,
        },
        fallback: target.dataset.viewportAnchor ? "none" : "anchor",
      }
      this.#awaitStability(token)
    })
  }

  #fallbackBottom(token: number) {
    const request = this.#current(token)
    if (!request) return
    request.state = createSessionViewStateV4({
      viewport: {
        version: 4,
        mode: "bottom",
        assistantRevision: request.active.assistantRevision,
        historyTurnStart: 0,
        updatedAt: Date.now(),
      },
      turnStart: 0,
    })
    this.#diagnostics = {
      ...this.#diagnostics,
      requested: decisionFor(request.state),
      resolved: { mode: "bottom" },
      fallback: this.#diagnostics.fallback === "history" ? "history" : "anchor",
    }
    this.#options.resetHistoryToRecent()
    this.#prepareBottom(token)
  }

  #awaitStability(token: number) {
    this.#stopStabilityBarrier()
    const root = this.#root
    if (!root) return

    const check = () => {
      this.#stabilityFrame = undefined
      const request = this.#current(token)
      const current = this.#root
      if (!request || !current) return
      const anchor =
        request.state.viewport.mode === "anchor"
          ? this.#options.anchorElement(current, request.state.viewport.anchorRenderBlockID) ??
            this.#options.turnElement(current, request.state.viewport.anchorTurnID)
          : undefined
      const signature = [
        current.scrollHeight,
        current.clientHeight,
        current.scrollTop,
        anchor?.getBoundingClientRect().top ?? "bottom",
        anchor?.getBoundingClientRect().height ?? "",
      ].join(":")
      this.#stabilityFrames = signature === this.#stabilitySignature ? this.#stabilityFrames + 1 : 1
      this.#stabilitySignature = signature
      if (this.#stabilityFrames >= 2) {
        this.#commit(token)
        return
      }
      this.#stabilityFrame = requestAnimationFrame(check)
    }

    if (typeof ResizeObserver !== "undefined") {
      this.#stabilityObserver = new ResizeObserver(() => {
        if (this.#stabilityFrame !== undefined) return
        this.#stabilityFrame = requestAnimationFrame(check)
      })
      this.#stabilityObserver.observe(root)
      if (root.firstElementChild instanceof HTMLElement) this.#stabilityObserver.observe(root.firstElementChild)
    }
    this.#stabilityTimer = window.setTimeout(() => this.#commit(token), 450)
    this.#stabilityFrame = requestAnimationFrame(check)
  }

  #stopStabilityBarrier() {
    if (this.#stabilityFrame !== undefined) cancelAnimationFrame(this.#stabilityFrame)
    if (this.#stabilityTimer !== undefined) window.clearTimeout(this.#stabilityTimer)
    this.#stabilityFrame = undefined
    this.#stabilityTimer = undefined
    this.#stabilitySignature = undefined
    this.#stabilityFrames = 0
    this.#stabilityObserver?.disconnect()
    this.#stabilityObserver = undefined
  }

  #queue(token: number, task: () => void) {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame)
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined
      if (!this.#current(token)) return
      task()
    })
  }

  #current(token: number) {
    const request = this.#request
    if (!request || request.token !== token) return
    if (request.active.key !== this.#options.active()?.key) return
    return request
  }

  #commit(token: number) {
    const request = this.#current(token)
    if (!request) return
    request.phase = "committed"
    this.#request = undefined
    this.#committed = request.active
    this.#stopStabilityBarrier()
    this.#emit("committed", request.active.key)
  }

  #sameActive(left: ActiveViewport | undefined, right: ActiveViewport) {
    if (!left) return false
    return (
      left.key === right.key &&
      left.assistantRevision === right.assistantRevision &&
      left.streaming === right.streaming
    )
  }

  #emit(phase: TimelineVirtualPhase, key?: string) {
    this.#diagnostics = { ...this.#diagnostics, phase, key: key ?? this.#diagnostics.key }
    this.#options.onPhase?.(phase, {
      key,
      hot: false,
      virtualItems: this.#options.turnIDs().length,
    })
  }
}

function decisionFor(state: SessionViewStateV4 | SessionViewStateV4["viewport"]): TimelineVirtualDecision {
  const viewport = "viewport" in state ? state.viewport : state
  if (viewport.mode === "bottom") return { mode: "bottom" }
  return {
    mode: "anchor",
    blockID: viewport.anchorRenderBlockID,
    turnID: viewport.anchorTurnID,
    offsetPx: viewport.offsetPx,
  }
}
