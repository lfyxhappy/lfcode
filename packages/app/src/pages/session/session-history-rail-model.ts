export type SessionHistoryRailNode = {
  turnID: string
  index: number
  position: number
}

export function clampSessionHistoryRailPosition(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function buildSessionHistoryRailNodes(turnIDs: readonly string[]) {
  if (!turnIDs.length) return [] as SessionHistoryRailNode[]

  const lastIndex = turnIDs.length - 1
  return turnIDs.map((turnID, index) => ({
    turnID,
    index,
    position: lastIndex === 0 ? 0.5 : index / lastIndex,
  }))
}

export function nearestSessionHistoryRailNode(
  nodes: readonly SessionHistoryRailNode[],
  position: number,
) {
  if (!nodes.length) return

  const target = clampSessionHistoryRailPosition(position)
  return nodes.reduce((nearest, node) => {
    const distance = Math.abs(node.position - target)
    const nearestDistance = Math.abs(nearest.position - target)
    return distance < nearestDistance ? node : nearest
  })
}

export function sessionHistoryRailScrollPosition(input: {
  scrollTop?: number
  scrollHeight?: number
  viewportHeight?: number
}) {
  const scrollTop = input.scrollTop ?? 0
  const maxScrollTop = (input.scrollHeight ?? 0) - (input.viewportHeight ?? 0)
  if (maxScrollTop <= 0) return 0
  return clampSessionHistoryRailPosition(scrollTop / maxScrollTop)
}

export function resolveSessionHistoryRailTurnIndex(input: {
  turnIDs: readonly string[]
  currentTurnID?: string
  renderedTurnIDs?: readonly string[]
  turnStart?: number
  scrollTop?: number
  scrollHeight?: number
  viewportHeight?: number
}) {
  if (!input.turnIDs.length) return

  if (input.currentTurnID) {
    const directIndex = input.turnIDs.indexOf(input.currentTurnID)
    if (directIndex >= 0) return directIndex
  }

  const rendered = input.renderedTurnIDs ?? []
  const renderedStart = Math.min(
    input.turnIDs.length - 1,
    Math.max(0, Math.trunc(input.turnStart ?? 0)),
  )
  const renderedIndexes = rendered
    .map((turnID) => input.turnIDs.indexOf(turnID))
    .filter((index) => index >= 0)

  if (renderedIndexes.length) {
    const first = Math.min(...renderedIndexes)
    const last = Math.max(...renderedIndexes)
    const position = sessionHistoryRailScrollPosition(input)
    return Math.round(first + position * (last - first))
  }

  if (rendered.length) {
    const lastRenderedIndex = Math.min(input.turnIDs.length - 1, renderedStart + rendered.length - 1)
    const position = sessionHistoryRailScrollPosition(input)
    return Math.round(renderedStart + position * (lastRenderedIndex - renderedStart))
  }

  const position = sessionHistoryRailScrollPosition(input)
  return Math.round(position * (input.turnIDs.length - 1))
}

export function stepSessionHistoryRailIndex(input: {
  index: number | undefined
  key: "Home" | "End" | "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown"
  length: number
  pageSize?: number
}) {
  if (input.length <= 0) return

  const current = Math.min(input.length - 1, Math.max(0, Math.trunc(input.index ?? 0)))
  const pageSize = Math.max(1, Math.trunc(input.pageSize ?? 5))
  if (input.key === "Home") return 0
  if (input.key === "End") return input.length - 1
  if (input.key === "ArrowUp") return Math.max(0, current - 1)
  if (input.key === "ArrowDown") return Math.min(input.length - 1, current + 1)
  if (input.key === "PageUp") return Math.max(0, current - pageSize)
  return Math.min(input.length - 1, current + pageSize)
}
