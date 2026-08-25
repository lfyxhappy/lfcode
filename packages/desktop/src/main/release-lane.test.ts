import { describe, expect, test } from "bun:test"
import { isUpdaterEnabled } from "./release-lane"

describe("release lane", () => {
  test("keeps updates enabled for packaged production builds", () => {
    expect(isUpdaterEnabled({ isPackaged: true, preRelease: false })).toBe(true)
  })

  test("disables updates for pre-release and unpackaged builds", () => {
    expect(isUpdaterEnabled({ isPackaged: true, preRelease: true })).toBe(false)
    expect(isUpdaterEnabled({ isPackaged: false, preRelease: false })).toBe(false)
  })
})
