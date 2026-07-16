import { afterEach, describe, expect, test } from "bun:test"
import type { VirtualizerHandle } from "virtua/solid"
import { TimelineVirtualController } from "./timeline-virtual-controller"
import type { SessionViewStateV4 } from "./session-view-state"

type FakeRoot = HTMLDivElement & { setMetrics: (top: number, height: number, client: number) => void }

function root() {
  const el = document.createElement("div") as FakeRoot
  let top = 0
  let height = 1200
  let client = 400
  Object.defineProperties(el, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => client },
    scrollTop: {
      get: () => top,
      set: (value) => {
        top = value
      },
    },
  })
  el.setMetrics = (nextTop, nextHeight, nextClient) => {
    top = nextTop
    height = nextHeight
    client = nextClient
  }
  el.getBoundingClientRect = () => new DOMRect(0, 0, 800, client)
  document.body.append(el)
  return el
}

function anchor(root: FakeRoot, input: { blockID: string; turnID: string; top: number }) {
  const turn = document.createElement("div")
  turn.dataset.viewportTurn = input.turnID
  const block = document.createElement("div")
  block.dataset.viewportAnchor = input.blockID
  block.getBoundingClientRect = () => new DOMRect(0, input.top - root.scrollTop, 10, 40)
  turn.append(block)
  root.append(turn)
}

function waitFrames(count = 3) {
  return new Promise<void>((resolve) => {
    const next = (left: number) => requestAnimationFrame(() => (left <= 1 ? resolve() : next(left - 1)))
    next(count)
  })
}

function state(): SessionViewStateV4 {
  return {
    version: 4,
    viewport: {
      version: 4,
      mode: "anchor",
      assistantRevision: "stable",
      historyTurnStart: 0,
      anchorRenderBlockID: "block-1",
      anchorTurnID: "turn-1",
      offsetPx: 80,
      updatedAt: 1,
    },
    history: { turnStart: 0 },
    updatedAt: 1,
  }
}

describe("TimelineVirtualController", () => {
  let controller: TimelineVirtualController | undefined

  afterEach(() => {
    controller?.dispose()
    controller = undefined
    document.body.replaceChildren()
  })

  test("restores a V4 block anchor through the virtual turn index", async () => {
    const el = root()
    anchor(el, { blockID: "block-1", turnID: "turn-1", top: 300 })
    const requested: number[] = []
    const virtualizer = { scrollToIndex: (index: number) => requested.push(index) } as unknown as VirtualizerHandle
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => virtualizer,
      state: () => state(),
      persist: () => {},
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-0", "turn-1"],
      findAnchor: () => undefined,
      anchorElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-anchor="${id}"]`) ?? undefined,
      turnElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-turn="${id}"]`) ?? undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
    })
    controller.setRoot(el)
    controller.setVirtualizer(virtualizer)
    controller.activate()
    await waitFrames()

    expect(requested).toEqual([1])
    expect(el.scrollTop).toBe(220)
  })

  test("restores a mounted block anchor without a virtualizer", async () => {
    const el = root()
    anchor(el, { blockID: "block-1", turnID: "turn-1", top: 300 })
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => undefined,
      state: () => state(),
      persist: () => {},
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-1"],
      findAnchor: () => undefined,
      anchorElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-anchor="${id}"]`) ?? undefined,
      turnElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-turn="${id}"]`) ?? undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
    })
    controller.setRoot(el)
    controller.activate()
    await waitFrames(5)

    expect(el.scrollTop).toBe(220)
    expect(controller.inspect()).toMatchObject({ phase: "committed", resolved: { mode: "anchor" } })
  })

  test("restores bottom without a virtualizer", async () => {
    const el = root()
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => undefined,
      state: () => ({
        version: 4,
        viewport: { version: 4, mode: "bottom", assistantRevision: "stable", historyTurnStart: 0, updatedAt: 1 },
        history: { turnStart: 0 },
        updatedAt: 1,
      }),
      persist: () => {},
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-1"],
      findAnchor: () => undefined,
      anchorElement: () => undefined,
      turnElement: () => undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
    })
    controller.setRoot(el)
    controller.activate()
    await waitFrames(5)

    expect(el.scrollTop).toBe(800)
    expect(controller.inspect()).toMatchObject({ phase: "committed", resolved: { mode: "bottom" } })
  })

  test("missing anchor resolves to bottom and never restores top", async () => {
    const el = root()
    const virtualizer = { scrollToIndex: () => {} } as unknown as VirtualizerHandle
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => virtualizer,
      state: () => state(),
      persist: () => {},
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-1"],
      findAnchor: () => undefined,
      anchorElement: () => undefined,
      turnElement: () => undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
    })
    controller.setRoot(el)
    controller.setVirtualizer(virtualizer)
    controller.activate()
    await waitFrames(4)

    expect(el.scrollTop).toBe(800)
  })

  test("does not restart a committed restore for the same session revision", async () => {
    const el = root()
    const phases: string[] = []
    const virtualizer = { scrollToIndex: () => {} } as unknown as VirtualizerHandle
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => virtualizer,
      state: () => ({
        version: 4,
        viewport: { version: 4, mode: "bottom", assistantRevision: "stable", historyTurnStart: 0, updatedAt: 1 },
        history: { turnStart: 0 },
        updatedAt: 1,
      }),
      persist: () => {},
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-1"],
      findAnchor: () => undefined,
      anchorElement: () => undefined,
      turnElement: () => undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
      onPhase: (phase) => phases.push(phase),
    })
    controller.setRoot(el)
    controller.setVirtualizer(virtualizer)
    controller.activate()
    await waitFrames(4)
    controller.activate()
    await waitFrames(2)

    expect(phases.filter((phase) => phase === "requested")).toHaveLength(1)
    expect(phases.filter((phase) => phase === "committed")).toHaveLength(1)
  })

  test("waits for the virtual anchor to mount before falling back to bottom", async () => {
    const el = root()
    const virtualizer = { scrollToIndex: () => {} } as unknown as VirtualizerHandle
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => virtualizer,
      state: () => state(),
      persist: () => {},
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-1"],
      findAnchor: () => undefined,
      anchorElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-anchor="${id}"]`) ?? undefined,
      turnElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-turn="${id}"]`) ?? undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
    })
    controller.setRoot(el)
    controller.setVirtualizer(virtualizer)
    controller.activate()
    requestAnimationFrame(() => anchor(el, { blockID: "block-1", turnID: "turn-1", top: 300 }))
    await waitFrames(5)

    expect(el.scrollTop).toBe(220)
  })

  test("reports the captured and restored semantic anchor", async () => {
    const el = root()
    anchor(el, { blockID: "block-1", turnID: "turn-1", top: 300 })
    const virtualizer = { scrollToIndex: () => {} } as unknown as VirtualizerHandle
    let persisted: SessionViewStateV4 | undefined
    controller = new TimelineVirtualController({
      active: () => ({ key: "dir/session", sessionID: "session", assistantRevision: "stable", streaming: false }),
      ready: () => true,
      root: () => el,
      virtualizer: () => virtualizer,
      state: () => state(),
      persist: (_key, value) => {
        persisted = value
      },
      turnStart: () => 0,
      setTurnStart: () => {},
      resetHistoryToRecent: () => {},
      prepareAnchorWindow: () => false,
      historyMore: () => false,
      historyLoading: () => false,
      loadHistory: async () => {},
      turnIDs: () => ["turn-1"],
      findAnchor: (root) => {
        const block = root.querySelector<HTMLElement>("[data-viewport-anchor]")
        if (!block) return
        return { blockID: "block-1", turnID: "turn-1", element: block }
      },
      anchorElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-anchor="${id}"]`) ?? undefined,
      turnElement: (root, id) => root.querySelector<HTMLElement>(`[data-viewport-turn="${id}"]`) ?? undefined,
      pauseAutoScroll: () => {},
      scrollToBottom: () => {
        el.scrollTop = 800
      },
    })
    controller.setRoot(el)
    controller.captureNow()
    controller.setVirtualizer(virtualizer)
    controller.activate()
    await waitFrames(4)

    expect(persisted?.viewport).toMatchObject({
      mode: "anchor",
      anchorRenderBlockID: "block-1",
      anchorTurnID: "turn-1",
    })
    expect(controller.inspect()).toMatchObject({
      phase: "committed",
      saved: { mode: "anchor", blockID: "block-1", turnID: "turn-1" },
      resolved: { mode: "anchor", blockID: "block-1", turnID: "turn-1" },
    })
  })
})
