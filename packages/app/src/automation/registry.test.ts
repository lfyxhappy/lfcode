import { afterEach, describe, expect, test } from "bun:test"
import { UiAutomationRegistry } from "./registry"

const cleanup: Array<() => void> = []

afterEach(() => {
  cleanup.splice(0).reverse().forEach((dispose) => dispose())
})

describe("UI automation registry", () => {
  test("reports token availability and the operations exposed by its active provider", () => {
    cleanup.push(
      UiAutomationRegistry.register({
        id: "layout",
        tokens: ["settings.toggle"],
        query: (input) => ({ token: input.token, found: true, visible: true }),
        click: async (input) => ({ token: input.token, found: true, visible: true }),
        readText: () => "Settings",
      }),
    )

    expect(UiAutomationRegistry.catalog()).toContainEqual({
      token: "settings.toggle",
      available: true,
      source: "layout",
      operations: ["query", "click", "readText"],
    })
    expect(UiAutomationRegistry.catalog()).toContainEqual({
      token: "settings.app-control.save",
      available: false,
      operations: [],
    })
  })

  test("uses the most recently registered matching provider and restores the prior provider on cleanup", async () => {
    cleanup.push(
      UiAutomationRegistry.register({
        id: "first",
        tokens: ["settings.toggle"],
        query: (input) => ({ token: input.token, found: true, visible: true, text: "first" }),
      }),
    )
    const disposeLatest = UiAutomationRegistry.register({
      id: "latest",
      tokens: ["settings.toggle"],
      query: (input) => ({ token: input.token, found: true, visible: true, text: "latest" }),
    })

    expect(UiAutomationRegistry.query({ token: "settings.toggle" }).text).toBe("latest")
    disposeLatest()
    expect(UiAutomationRegistry.query({ token: "settings.toggle" }).text).toBe("first")
  })

  test("rejects unavailable semantic operations without falling back to a different token", async () => {
    cleanup.push(
      UiAutomationRegistry.register({
        id: "read-only",
        tokens: ["settings.dialog"],
        query: (input) => ({ token: input.token, found: true, visible: true }),
      }),
    )

    await expect(UiAutomationRegistry.click({ token: "settings.dialog" })).rejects.toThrow(
      "UI token does not support click: settings.dialog",
    )
  })
})
