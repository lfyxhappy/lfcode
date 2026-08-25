import { describe, expect, test } from "bun:test"
import { isPluginProjectRoute } from "./plugin-project-route"

describe("isPluginProjectRoute", () => {
  test("routes a managed Tavern project root without a session", () => {
    expect(
      isPluginProjectRoute({
        projectExtension: { pluginID: "lfcode-tavern", type: "tavern" },
        pluginID: "lfcode-tavern",
        type: "tavern",
      }),
    ).toBe(true)
  })

  test("routes a plugin session from its session extension", () => {
    expect(
      isPluginProjectRoute({
        sessionID: "ses_tavern",
        sessionExtension: { pluginID: "lfcode-tavern", type: "tavern" },
        pluginID: "lfcode-tavern",
        type: "tavern",
      }),
    ).toBe(true)
  })

  test("does not route an unmarked project as a plugin page", () => {
    expect(
      isPluginProjectRoute({
        projectExtension: { pluginID: "lfcode-imagemaker", type: "imagemaker" },
        pluginID: "lfcode-tavern",
        type: "tavern",
      }),
    ).toBe(false)
  })
})
