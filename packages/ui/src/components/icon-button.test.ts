import { describe, expect, test } from "bun:test"
import { getIconButtonTitle } from "./icon-button"

describe("IconButton title", () => {
  test("falls back to the accessible label", () => {
    expect(getIconButtonTitle({ "aria-label": "Clear search" })).toBe("Clear search")
  })

  test("preserves an explicit title", () => {
    expect(getIconButtonTitle({ "aria-label": "Accessible label", title: "Visible hint" })).toBe("Visible hint")
    expect(getIconButtonTitle({ "aria-label": "Accessible label", title: "" })).toBe("")
  })
})
