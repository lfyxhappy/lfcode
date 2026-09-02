import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "resize-handle.tsx"), "utf8")
const styles = readFileSync(join(import.meta.dir, "resize-handle.css"), "utf8")

test("captures the pointer and batches visual resize updates", () => {
  expect(source).toContain("target.setPointerCapture(e.pointerId)")
  expect(source).toContain("target.releasePointerCapture(e.pointerId)")
  expect(source).toContain("window.requestAnimationFrame(flush)")
  expect(source).toContain("window.cancelAnimationFrame(frame)")
  expect(source).toContain("local.onResizeEnd?.(scheduledSize)")
  expect(source).toContain('data-dragging={dragging()}')
})

test("cleans up pointer cancellation and restores document interaction state", () => {
  expect(source).toContain('document.addEventListener("pointercancel", onPointerUp)')
  expect(source).toContain('document.removeEventListener("pointercancel", onPointerUp)')
  expect(source).toContain("document.body.style.userSelect = previousUserSelect")
  expect(source).toContain("document.body.style.overflow = previousOverflow")
})

test("keeps the sidebar handle discoverable with a 16px grab area", () => {
  expect(styles).toContain("&.sidebar-resize-handle[data-direction=\"horizontal\"]")
  expect(styles).toContain("width: 16px")
  expect(styles).toContain("cursor: col-resize")
  expect(styles).toContain('[data-dragging="true"]::after')
})
