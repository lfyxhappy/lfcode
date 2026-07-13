import { afterEach, describe, expect, test } from "bun:test"
import { motionEnabled, motionMode } from "./motion-presence"

afterEach(() => {
  delete document.documentElement.dataset.motionMode
  delete document.documentElement.dataset.motionReduced
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
})
