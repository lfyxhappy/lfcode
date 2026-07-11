import { acquireSessionCacheLease } from "@/context/session-cache-lease"
import { coolSessionVirtualCaches } from "./session-virtual-cache"
import { coolSessionTimelineVisualSnapshots } from "./session-timeline-visual-cache"
import type { SessionSurface } from "./session-view-state"

export type SessionViewportRegistration = {
  key: string
  flush: () => void
  snapshot?: () => void
}

export type SessionSurfacePhase = "active" | "frozen" | "preparing" | "cold"

export type SessionViewSurfaceRegistration = {
  key: string
  sessionID: string
  surface: SessionSurface
  phase: SessionSurfacePhase
  freeze?: () => void
  resume?: () => void
  cool?: () => void
  estimateWeight?: () => number
}

const MAX_HOT_SURFACES = 8
const MEMORY_COOL_THRESHOLD_KB = 512 * 1024
const MEMORY_RESUME_THRESHOLD_KB = 448 * 1024
const surfaces = new Map<string, SessionViewSurfaceRegistration & { usedAt: number; releaseLease: () => void }>()

function isLeased(phase: SessionSurfacePhase) {
  return phase === "active" || phase === "frozen" || phase === "preparing"
}

function updateLease(surface: SessionViewSurfaceRegistration & { releaseLease: () => void }) {
  surface.releaseLease()
  surface.releaseLease = isLeased(surface.phase)
    ? acquireSessionCacheLease({ sessionID: surface.sessionID, owner: surface.key })
    : () => {}
}

function coolLeastRecentlyUsed() {
  const hot = [...surfaces.values()].filter((surface) => surface.phase !== "cold")
  if (hot.length <= MAX_HOT_SURFACES) return
  const candidate = hot
    .filter((surface) => surface.phase !== "active" && surface.phase !== "preparing")
    .sort((a, b) => a.usedAt - b.usedAt)[0]
  if (!candidate) return
  candidate.cool?.()
  candidate.phase = "cold"
  candidate.usedAt = Date.now()
  updateLease(candidate)
}

export function registerSessionViewSurface(registration: SessionViewSurfaceRegistration) {
  const existing = surfaces.get(registration.key)
  existing?.releaseLease()
  const surface = {
    ...registration,
    usedAt: Date.now(),
    releaseLease: () => {},
  }
  surfaces.set(registration.key, surface)
  updateLease(surface)
  coolLeastRecentlyUsed()
  return () => {
    if (surfaces.get(registration.key) !== surface) return
    surface.releaseLease()
    surfaces.delete(registration.key)
  }
}

export function transitionSessionViewSurface(key: string, phase: SessionSurfacePhase) {
  const surface = surfaces.get(key)
  if (!surface || surface.phase === phase) return
  surface.phase = phase
  surface.usedAt = Date.now()
  if (phase === "frozen") surface.freeze?.()
  if (phase === "active") surface.resume?.()
  if (phase === "cold") surface.cool?.()
  updateLease(surface)
  coolLeastRecentlyUsed()
}

export function activateSessionViewSurface(key: string) {
  const target = surfaces.get(key)
  if (!target) return
  for (const [candidateKey, surface] of surfaces) {
    // Main and side-chat surfaces are independently visible. Only competing
    // surfaces of the same kind are mutually exclusive.
    if (candidateKey === key || surface.surface !== target.surface || surface.phase !== "active") continue
    transitionSessionViewSurface(candidateKey, "frozen")
  }
  transitionSessionViewSurface(key, "active")
}

export function coolSessionViewSurfaces(input?: { max?: number }) {
  const keep = input?.max ?? 0
  const hot = [...surfaces.values()]
    .filter((surface) => surface.phase === "frozen")
    .sort((a, b) => a.usedAt - b.usedAt)
  for (const surface of hot.slice(0, Math.max(0, hot.length - keep))) {
    transitionSessionViewSurface(surface.key, "cold")
  }
}

export function sessionViewSurfaceDiagnostics() {
  return [...surfaces.values()].map((surface) => ({
    key: surface.key,
    sessionID: surface.sessionID,
    surface: surface.surface,
    phase: surface.phase,
    usedAt: surface.usedAt,
    weight: surface.estimateWeight?.() ?? 0,
  }))
}

export function startSessionViewMemoryGuard(readMemory: () => Promise<{ private: number; shared: number }>) {
  let stopped = false
  let cooling = false
  const check = async () => {
    const memory = await readMemory().catch(() => undefined)
    if (!memory || stopped) return
    const used = memory.private + memory.shared
    if (used >= MEMORY_COOL_THRESHOLD_KB) {
      cooling = true
      coolSessionViewSurfaces({ max: 0 })
      coolSessionVirtualCaches({ max: 0 })
      coolSessionTimelineVisualSnapshots({ max: 0 })
      return
    }
    if (cooling && used <= MEMORY_RESUME_THRESHOLD_KB) cooling = false
  }
  void check()
  const timer = window.setInterval(() => void check(), 15_000)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}

let active: SessionViewportRegistration | undefined

export function registerSessionViewport(registration: SessionViewportRegistration) {
  active = registration
  return () => {
    if (active === registration) active = undefined
  }
}

export function flushActiveSessionViewport() {
  active?.flush()
}

export function installSessionViewportNavigationBridge() {
  if (typeof window === "undefined") return () => {}

  const history = window.history
  const pushState = history.pushState
  const replaceState = history.replaceState
  const flush = () => flushActiveSessionViewport()
  const freeze = () => active?.snapshot?.()
  const leave = () => {
    freeze()
    flush()
  }
  const isNavigationTarget = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest("a[href]")
  const onPointerDown = (event: PointerEvent) => {
    if (isNavigationTarget(event.target)) leave()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (isNavigationTarget(event.target)) leave()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") return
    flush()
  }

  const wrappedPushState = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
    leave()
    return pushState.call(history, data, unused, url)
  }
  const wrappedReplaceState = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
    leave()
    return replaceState.call(history, data, unused, url)
  }
  history.pushState = wrappedPushState
  history.replaceState = wrappedReplaceState
  window.addEventListener("pointerdown", onPointerDown, true)
  window.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("popstate", leave)
  window.addEventListener("pagehide", leave)
  document.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    if (history.pushState === wrappedPushState) history.pushState = pushState
    if (history.replaceState === wrappedReplaceState) history.replaceState = replaceState
    window.removeEventListener("pointerdown", onPointerDown, true)
    window.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("popstate", leave)
    window.removeEventListener("pagehide", leave)
    document.removeEventListener("visibilitychange", onVisibilityChange)
  }
}
