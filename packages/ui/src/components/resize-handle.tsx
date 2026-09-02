import { createSignal, splitProps, type JSX } from "solid-js"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onResizeEnd?: (size: number) => void
  onCollapse?: () => void
  collapseThreshold?: number
  collapseWhen?: "below" | "above"
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onResizeEnd",
    "onCollapse",
    "collapseThreshold",
    "collapseWhen",
    "class",
    "classList",
  ])
  const [dragging, setDragging] = createSignal(false)

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const target = e.currentTarget as HTMLElement
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const startSize = local.size
    let current = startSize
    let scheduledSize = startSize
    let frame: number | undefined
    const previousUserSelect = document.body.style.userSelect
    const previousOverflow = document.body.style.overflow

    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is unavailable in a few embedded webviews.
    }

    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    const flush = () => {
      frame = undefined
      local.onResize(scheduledSize)
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== e.pointerId) return
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : edge === "start"
            ? start - pos
            : pos - start
      current = startSize + delta
      const clamped = Math.min(local.max, Math.max(local.min, current))
      scheduledSize = clamped
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(flush)
    }

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== e.pointerId) return
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame)
        flush()
      }
      local.onResizeEnd?.(scheduledSize)
      setDragging(false)
      document.body.style.userSelect = previousUserSelect
      document.body.style.overflow = previousOverflow
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
      document.removeEventListener("pointercancel", onPointerUp)
      try {
        target.releasePointerCapture(e.pointerId)
      } catch {}

      const threshold = local.collapseThreshold ?? 0
      const shouldCollapse = local.collapseWhen === "above" ? current > threshold : current < threshold
      if (local.onCollapse && threshold > 0 && shouldCollapse) {
        local.onCollapse()
      }
    }

    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("pointercancel", onPointerUp)
  }

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      data-dragging={dragging()}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onPointerDown={handlePointerDown}
    />
  )
}
