import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"

export type MotionMode = "full" | "standard" | "off"
export type MotionChannel = "micro" | "content" | "surface"
export type MotionPreset = "micro" | "content" | "surface-scale" | "surface-slide"
export type MotionPresencePhase = "entering" | "entered" | "exiting"
export const MOTION_CHANGE_EVENT = "lfcode:motion-change"

const [sharedMotionEnabled, setSharedMotionEnabled] = createSignal(motionEnabled())
const [sharedPageVisible, setSharedPageVisible] = createSignal(
  typeof document === "undefined" || document.visibilityState === "visible",
)
let motionStateObserved = false
let pageVisibilityObserved = false

export type MotionPresenceProps = {
  present: boolean
  channel?: MotionChannel
  /** A shared spatial treatment. `channel` remains available for existing callers. */
  preset?: MotionPreset
  children: JSX.Element
  class?: string
  style?: JSX.CSSProperties
  ref?: (element: HTMLDivElement | undefined) => void
  onPointerDown?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>
  onExitComplete?: () => void
}

let active = 0
let cancelled = 0

function publish(phase?: MotionPresencePhase) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.motionActive = String(active)
  root.dataset.motionCancelled = String(cancelled)
  if (phase) root.dataset.motionPresencePhase = phase
}

export function motionMode(): MotionMode {
  if (typeof document === "undefined") return "off"
  if (document.documentElement.dataset.motionReduced === "true") return "off"
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "off"
  const value = document.documentElement.dataset.motionMode
  if (value === "standard" || value === "off") return value
  return "full"
}

export function motionEnabled() {
  return motionMode() !== "off"
}

export function useMotionEnabled() {
  observeMotionState()
  return sharedMotionEnabled
}

export function usePageVisible() {
  observePageVisibility()
  return sharedPageVisible
}

function observeMotionState() {
  if (motionStateObserved || typeof window === "undefined") return
  const sync = () => setSharedMotionEnabled(motionEnabled())
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)")
  sync()
  window.addEventListener(MOTION_CHANGE_EVENT, sync)
  query?.addEventListener("change", sync)
  motionStateObserved = true
}

function observePageVisibility() {
  if (pageVisibilityObserved || typeof document === "undefined") return
  const sync = () => setSharedPageVisible(document.visibilityState === "visible")
  sync()
  document.addEventListener("visibilitychange", sync)
  pageVisibilityObserved = true
}

export function MotionPresence(props: MotionPresenceProps) {
  const preset = () => props.preset ?? (props.channel === "micro" ? "micro" : props.channel === "surface" ? "surface-slide" : "content")
  const channel = () => (preset() === "micro" ? "micro" : preset() === "content" ? "content" : "surface")
  const [mounted, setMounted] = createSignal(props.present)
  const [phase, setPhase] = createSignal<MotionPresencePhase>(props.present ? "entered" : "exiting")
  let root: HTMLDivElement | undefined
  let timer: number | undefined
  let run = 0
  let counted = props.present

  if (counted) {
    active += 1
    publish("entered")
  }

  const cancel = () => {
    if (timer === undefined || typeof window === "undefined") return
    window.clearTimeout(timer)
    timer = undefined
    cancelled += 1
    publish(phase())
  }

  const completeExit = (current: number) => {
    if (current !== run || props.present) return
    cancel()
    setMounted(false)
    if (counted) {
      counted = false
      active = Math.max(0, active - 1)
    }
    publish("exiting")
    props.onExitComplete?.()
  }

  const duration = () => {
    if (!motionEnabled() || !root) return 0
    const value = getComputedStyle(root).getPropertyValue("--motion-presence-duration").trim()
    const match = /^(\d+(?:\.\d+)?)m?s$/.exec(value)
    if (!match) return 240
    return value.endsWith("ms") ? Number(match[1]) : Number(match[1]) * 1000
  }

  const enter = () => {
    cancel()
    run += 1
    if (!counted) {
      counted = true
      active += 1
    }
    setMounted(true)
    setPhase("entering")
    publish("entering")
    if (typeof requestAnimationFrame !== "function") {
      setPhase("entered")
      return
    }
    requestAnimationFrame(() => {
      if (!props.present) return
      setPhase("entered")
      publish("entered")
    })
  }

  const exit = () => {
    cancel()
    const current = ++run
    if (!mounted()) return
    setPhase("exiting")
    publish("exiting")
    const wait = duration()
    if (wait === 0 || typeof window === "undefined") {
      completeExit(current)
      return
    }
    timer = window.setTimeout(() => {
      timer = undefined
      completeExit(current)
    }, wait + 40)
  }

  const settleForMotionChange = () => {
    if (motionEnabled()) return
    if (props.present) {
      cancel()
      setMounted(true)
      setPhase("entered")
      publish("entered")
      return
    }
    completeExit(run)
  }

  if (typeof window !== "undefined") {
    window.addEventListener(MOTION_CHANGE_EVENT, settleForMotionChange)
    onCleanup(() => window.removeEventListener(MOTION_CHANGE_EVENT, settleForMotionChange))
  }

  createEffect(() => {
    if (props.present) {
      enter()
      return
    }
    exit()
  })

  onCleanup(() => {
    cancel()
    if (counted) {
      active = Math.max(0, active - 1)
      publish()
    }
    props.ref?.(undefined)
  })

  return (
    <Show when={mounted()}>
      <div
        ref={(element) => {
          root = element
          props.ref?.(element)
        }}
        data-component="motion-presence"
        data-channel={channel()}
        data-preset={preset()}
        data-phase={phase()}
        class={props.class}
        aria-hidden={phase() === "exiting" ? "true" : undefined}
        inert={phase() === "exiting"}
        style={{ ...props.style, "pointer-events": phase() === "exiting" ? "none" : undefined }}
        onPointerDown={props.onPointerDown}
        onTransitionEnd={(event) => {
          if (event.currentTarget !== event.target || phase() !== "exiting") return
          completeExit(run)
        }}
      >
        {props.children}
      </div>
    </Show>
  )
}
