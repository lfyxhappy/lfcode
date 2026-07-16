import { beforeEach, describe, expect, test } from "bun:test"
import { shouldRestoreMenuTrigger } from "./dropdown-menu-focus"

describe("shouldRestoreMenuTrigger", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("restores the trigger only for Escape close without a user focus change", () => {
    const trigger = document.createElement("button")
    document.body.append(trigger)

    expect(shouldRestoreMenuTrigger({ closedWithEscape: true, trigger, activeElement: undefined })).toBe(true)
    expect(shouldRestoreMenuTrigger({ closedWithEscape: true, trigger, activeElement: trigger })).toBe(true)
    expect(shouldRestoreMenuTrigger({ closedWithEscape: false, trigger, activeElement: undefined })).toBe(false)
  })

  test("does not override another editable surface selected by the user", () => {
    const trigger = document.createElement("button")
    const composer = document.createElement("div")
    composer.contentEditable = "true"
    document.body.append(trigger, composer)

    expect(shouldRestoreMenuTrigger({ closedWithEscape: true, trigger, activeElement: composer })).toBe(false)
  })
})
