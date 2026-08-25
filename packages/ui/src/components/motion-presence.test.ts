import { afterEach, describe, expect, test } from "bun:test"
import { MOTION_CHANGE_EVENT, motionEnabled, motionMode, useMotionEnabled } from "./motion-presence"

afterEach(() => {
  delete document.documentElement.dataset.motionMode
  delete document.documentElement.dataset.motionReduced
  window.dispatchEvent(new window.Event(MOTION_CHANGE_EVENT))
})

describe("motion mode", () => {
  test("defaults to full motion", () => {
    expect(motionMode()).toBe("full")
    expect(motionEnabled()).toBe(true)
  })

  test("uses the configured mode", () => {
    document.documentElement.dataset.motionMode = "standard"
    expect(motionMode()).toBe("standard")

    document.documentElement.dataset.motionMode = "off"
    expect(motionMode()).toBe("off")
    expect(motionEnabled()).toBe(false)
  })

  test("system reduced motion overrides the configured mode", () => {
    document.documentElement.dataset.motionMode = "full"
    document.documentElement.dataset.motionReduced = "true"

    expect(motionMode()).toBe("off")
    expect(motionEnabled()).toBe(false)
  })

  test("uses the system preference when no explicit override exists", () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })) as typeof window.matchMedia

    expect(motionMode()).toBe("off")
    expect(motionEnabled()).toBe(false)

    window.matchMedia = original
  })

  test("shares the live motion setting without a listener per component", () => {
    const enabled = useMotionEnabled()
    expect(enabled()).toBe(true)

    document.documentElement.dataset.motionMode = "off"
    window.dispatchEvent(new window.Event(MOTION_CHANGE_EVENT))
    expect(enabled()).toBe(false)
  })
})
