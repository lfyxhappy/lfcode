import { createEffect, createSignal, onCleanup } from "solid-js"

const TEXT_RENDER_PACE_MS = 24
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

export function pacedTextStepSize(size: number) {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(24, Math.ceil(size / 8))
}

export function nextPacedTextBoundary(text: string, start: number) {
  const end = Math.min(text.length, start + pacedTextStepSize(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? "")) return i + 1
  }
  return end
}

export function createPacedTextValue(getValue: () => string, live?: () => boolean) {
  const [value, setValue] = createSignal(getValue())
  let shown = getValue()
  let timeout: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (!timeout) return
    clearTimeout(timeout)
    timeout = undefined
  }

  const sync = (text: string) => {
    shown = text
    setValue(text)
  }

  const run = () => {
    timeout = undefined
    const text = getValue()
    if (!live?.()) {
      sync(text)
      return
    }
    if (!text.startsWith(shown) || text.length <= shown.length) {
      sync(text)
      return
    }
    const end = nextPacedTextBoundary(text, shown.length)
    sync(text.slice(0, end))
    if (end < text.length) timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  }

  createEffect(() => {
    const text = getValue()
    if (!live?.()) {
      clear()
      sync(text)
      return
    }
    if (!text.startsWith(shown) || text.length < shown.length) {
      clear()
      sync(text)
      return
    }
    if (text.length === shown.length || timeout) return
    timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  })

  onCleanup(() => {
    clear()
  })

  return value
}
