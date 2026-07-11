import { afterEach, describe, expect, test } from "bun:test"
import { findTimelineViewportAnchor } from "./timeline-viewport-anchor"

function root() {
  const root = document.createElement("div")
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 500)
  document.body.append(root)
  return root
}

function anchor(root: HTMLDivElement, input: { blockID: string; turnID: string; top: number; height: number }) {
  const turn = document.createElement("div")
  turn.dataset.viewportTurn = input.turnID
  const block = document.createElement("div")
  block.dataset.viewportAnchor = input.blockID
  block.getBoundingClientRect = () => new DOMRect(0, input.top, 800, input.height)
  turn.append(block)
  root.append(turn)
  return block
}

describe("timeline viewport anchor", () => {
  afterEach(() => document.body.replaceChildren())

  test("falls back to the visible block when the reading line lands in an empty gutter", () => {
    const el = root()
    anchor(el, { blockID: "before", turnID: "turn-1", top: 12, height: 24 })
    anchor(el, { blockID: "after", turnID: "turn-2", top: 132, height: 40 })

    expect(findTimelineViewportAnchor(el)).toMatchObject({ blockID: "after", turnID: "turn-2" })
  })

  test("prefers the innermost rendered assistant block over its turn wrapper", () => {
    const el = root()
    const outer = anchor(el, { blockID: "turn-1", turnID: "turn-1", top: 0, height: 300 })
    const inner = document.createElement("div")
    inner.dataset.viewportAnchor = "assistant-1:part-1"
    inner.getBoundingClientRect = () => new DOMRect(0, 80, 800, 80)
    outer.append(inner)

    expect(findTimelineViewportAnchor(el)).toMatchObject({ blockID: "assistant-1:part-1", turnID: "turn-1" })
  })
})
