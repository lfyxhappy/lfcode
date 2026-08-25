import { For, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import {
  buildSessionHistoryRailNodes,
  nearestSessionHistoryRailNode,
  resolveSessionHistoryRailTurnIndex,
  stepSessionHistoryRailIndex,
} from "./session-history-rail-model"

export type SessionHistoryRailKey = "Home" | "End" | "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown"

export type SessionHistoryRailProps = {
  turnIDs: Accessor<readonly string[]>
  renderedTurnIDs?: Accessor<readonly string[]>
  turnStart?: Accessor<number>
  readingTurnID?: Accessor<string | undefined>
  viewport?: Accessor<HTMLDivElement | undefined>
  ariaLabel: string
  onSelect: (turnID: string) => void
}

export function sessionHistoryRailKeyboardIndex(input: {
  index: number | undefined
  key: SessionHistoryRailKey
  length: number
  pageSize?: number
}) {
  return stepSessionHistoryRailIndex(input)
}

export function sessionHistoryRailTurnAtPosition(turnIDs: readonly string[], position: number) {
  return nearestSessionHistoryRailNode(buildSessionHistoryRailNodes(turnIDs), position)?.turnID
}

export function SessionHistoryRail(props: SessionHistoryRailProps) {
  const [scrollVersion, setScrollVersion] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)
  const [hoverIndex, setHoverIndex] = createSignal<number>()
  const nodes = createMemo(() => buildSessionHistoryRailNodes(props.turnIDs()))

  createEffect(() => {
    const root = props.viewport?.()
    if (!root) return

    const onScroll = () => setScrollVersion((value) => value + 1)
    root.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => root.removeEventListener("scroll", onScroll))
  })

  const readingTurnID = createMemo(() => {
    const explicit = props.readingTurnID?.()
    if (explicit) return explicit

    scrollVersion()
    const root = props.viewport?.()
    if (!root) return

    const rootTop = root.getBoundingClientRect().top
    return Array.from(root.querySelectorAll<HTMLElement>("[data-viewport-turn]"))
      .map((element) => ({
        id: element.dataset.viewportTurn,
        bottom: element.getBoundingClientRect().bottom,
      }))
      .find((element) => element.id && element.bottom > rootTop + 1)?.id
  })

  const currentIndex = createMemo(() => {
    const root = props.viewport?.()
    return resolveSessionHistoryRailTurnIndex({
      turnIDs: props.turnIDs(),
      currentTurnID: readingTurnID(),
      renderedTurnIDs: props.renderedTurnIDs?.(),
      turnStart: props.turnStart?.(),
      scrollTop: root?.scrollTop,
      scrollHeight: root?.scrollHeight,
      viewportHeight: root?.clientHeight,
    })
  })

  let track: HTMLDivElement | undefined
  let railViewport: HTMLDivElement | undefined
  let pointerStartY: number | undefined
  let dragMoved = false
  let suppressClick = false

  createEffect(() => {
    if (!nodes().length) return
    queueMicrotask(() => {
      if (railViewport) railViewport.scrollTop = railViewport.scrollHeight
    })
  })

  const selectIndex = (index: number | undefined) => {
    if (index === undefined) return
    const node = nodes()[index]
    if (node) props.onSelect(node.turnID)
  }

  const nodeAtPosition = (clientY: number) => {
    const targets = Array.from(railViewport?.querySelectorAll<HTMLElement>("[data-history-rail-node]") ?? []).flatMap(
      (element) => {
        const turnID = element.dataset.historyRailNode
        if (!turnID) return []
        const rect = element.getBoundingClientRect()
        return [{ turnID, center: rect.top + rect.height / 2 }]
      },
    )
    return targets.reduce((candidate, target) => {
      if (!candidate) return target
      return Math.abs(target.center - clientY) < Math.abs(candidate.center - clientY) ? target : candidate
    }, targets[0])
  }

  const updateHover = (clientY: number) => {
    const target = nodeAtPosition(clientY)
    if (target) {
      const index = nodes().findIndex((node) => node.turnID === target.turnID)
      setHoverIndex(index >= 0 ? index : undefined)
      return
    }

    const rect = track?.getBoundingClientRect()
    if (!rect || rect.height <= 0) {
      setHoverIndex(undefined)
      return
    }
    const turnID = sessionHistoryRailTurnAtPosition(props.turnIDs(), (clientY - rect.top) / rect.height)
    const index = turnID === undefined ? -1 : nodes().findIndex((node) => node.turnID === turnID)
    setHoverIndex(index >= 0 ? index : undefined)
  }

  const tickWidth = (index: number) => {
    const focus = hoverIndex()
    if (focus === undefined) return 8
    const distance = Math.abs(index - focus)
    if (distance === 0) return 24
    if (distance === 1) return 20
    if (distance === 2) return 16
    if (distance === 3) return 12
    return 8
  }

  const selectPosition = (clientY: number) => {
    const nearest = nodeAtPosition(clientY)
    if (nearest) return props.onSelect(nearest.turnID)

    const rect = track?.getBoundingClientRect()
    if (!rect || rect.height <= 0) return
    const turnID = sessionHistoryRailTurnAtPosition(props.turnIDs(), (clientY - rect.top) / rect.height)
    if (turnID !== undefined) props.onSelect(turnID)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    updateHover(event.clientY)
    event.preventDefault()
    event.stopPropagation()
    pointerStartY = event.clientY
    dragMoved = false
    suppressClick = false
    setDragging(true)
    track?.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    updateHover(event.clientY)
    if (!dragging()) return
    if (pointerStartY !== undefined && Math.abs(event.clientY - pointerStartY) > 2) dragMoved = true
    if (dragMoved) selectPosition(event.clientY)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging()) return
    if (!dragMoved && event.target === track) {
      selectPosition(event.clientY)
      suppressClick = true
    } else {
      suppressClick = dragMoved
    }
    track?.releasePointerCapture?.(event.pointerId)
    pointerStartY = undefined
    setDragging(false)
  }

  const onPointerLeave = () => {
    if (dragging()) return
    setHoverIndex(undefined)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key
    if (!(["Home", "End", "ArrowUp", "ArrowDown", "PageUp", "PageDown"] as const).includes(key as never)) return
    event.preventDefault()
    event.stopPropagation()
    selectIndex(
      sessionHistoryRailKeyboardIndex({
        index: currentIndex(),
        key: key as SessionHistoryRailKey,
        length: nodes().length,
      }),
    )
  }

  return (
    <div
      data-component="session-history-rail"
      class="pointer-events-none absolute inset-y-0 left-0 z-40 hidden w-[44px] md:block"
      aria-hidden={nodes().length === 0}
    >
      <div
        ref={(element) => (track = element)}
        role="slider"
        aria-label={props.ariaLabel}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, nodes().length - 1)}
        aria-valuenow={currentIndex() ?? 0}
        tabIndex={nodes().length >= 2 ? 0 : -1}
        class="pointer-events-auto relative h-full w-full touch-none outline-none"
        classList={{ "cursor-grab": !dragging(), "cursor-grabbing": dragging() }}
        onPointerEnter={(event) => updateHover(event.clientY)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onClick={(event) => {
          if (suppressClick) {
            suppressClick = false
            return
          }
          if (event.target === event.currentTarget) selectPosition(event.clientY)
        }}
        onKeyDown={onKeyDown}
      >
        <div
          ref={(element) => (railViewport = element)}
          class="no-scrollbar absolute inset-x-0 top-1/2 h-2/3 -translate-y-1/2 overflow-y-auto"
        >
          <div class="flex min-h-full flex-col justify-center">
            <For each={nodes()}>
              {(node) => (
                <button
                  type="button"
                  tabIndex={-1}
                  data-history-rail-node={node.turnID}
                  aria-label={props.ariaLabel}
                  aria-current={currentIndex() === node.index ? "true" : undefined}
                  class="group flex h-[9px] w-full shrink-0 items-center border-0 bg-transparent p-0 pl-[13px] opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                  onPointerDown={onPointerDown}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!suppressClick) selectIndex(node.index)
                    suppressClick = false
                  }}
                >
                  <span
                    aria-hidden="true"
                    class="block rounded-[1px] transition-[width,height] duration-150"
                    style={{
                      width: `${tickWidth(node.index)}px`,
                      height: `${hoverIndex() === node.index || currentIndex() === node.index ? 3 : 2}px`,
                      "background-color":
                        hoverIndex() === node.index
                          ? "var(--text-strong)"
                          : "color-mix(in srgb, var(--text-weak) 72%, transparent)",
                    }}
                  />
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}
