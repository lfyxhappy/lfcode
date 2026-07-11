export type TimelineViewportAnchor = {
  blockID: string
  turnID: string
  element: HTMLElement
}

function fromElement(root: HTMLDivElement, input: Element | null | undefined) {
  const element = input instanceof HTMLElement ? input.closest<HTMLElement>("[data-viewport-anchor]") : undefined
  if (!element || !root.contains(element)) return
  const blockID = element.dataset.viewportAnchor
  const turnID = element.closest<HTMLElement>("[data-viewport-turn]")?.dataset.viewportTurn
  if (!blockID || !turnID) return
  return { blockID, turnID, element } satisfies TimelineViewportAnchor
}

function targetPoint(root: HTMLDivElement) {
  const box = root.getBoundingClientRect()
  return {
    x: Math.max(box.left + 1, Math.min(box.right - 1, box.left + box.width / 2)),
    y: Math.max(box.top + 1, Math.min(box.bottom - 1, box.top + Math.min(96, Math.max(1, box.height / 3)))),
  }
}

/**
 * Uses the block under the reading line when possible, then falls back to the
 * closest rendered anchor. This keeps an empty gutter from dropping a valid
 * reading snapshot during a virtualized render.
 */
export function findTimelineViewportAnchor(root: HTMLDivElement): TimelineViewportAnchor | undefined {
  const point = targetPoint(root)
  const points = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(point.x, point.y) : []
  for (const element of points) {
    const anchor = fromElement(root, element)
    if (anchor) return anchor
  }

  const anchors = [...root.querySelectorAll<HTMLElement>("[data-viewport-anchor]")]
    .map((element) => ({ anchor: fromElement(root, element), rect: element.getBoundingClientRect() }))
    .filter((item): item is { anchor: TimelineViewportAnchor; rect: DOMRect } => !!item.anchor && item.rect.height > 0)
  if (anchors.length === 0) return

  const containing = anchors
    .filter((item) => item.rect.top <= point.y && item.rect.bottom > point.y)
    .sort((left, right) => left.rect.height - right.rect.height)[0]
  if (containing) return containing.anchor

  const after = anchors
    .filter((item) => item.rect.top > point.y)
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.height - right.rect.height)[0]
  if (after) return after.anchor

  return anchors.sort((left, right) => right.rect.bottom - left.rect.bottom || left.rect.height - right.rect.height)[0]?.anchor
}
