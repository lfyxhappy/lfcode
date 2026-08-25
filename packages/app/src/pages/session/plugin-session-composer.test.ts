import { describe, expect, test } from "bun:test"
import { findPluginSessionComposer } from "./plugin-session-composer"

const tavernPlugin = {
  enabled: true,
  compatible: true,
  runtime: { lifecycle: "active" as const },
  manifest: {
    id: "lfcode-tavern",
    uiContributions: [
      {
        slot: "desktop-session-composer",
        title: "酒馆对话输入框",
        sessionComposer: { type: "tavern", mode: "replace" as const, renderer: "conversation" as const },
      },
    ],
  },
}

describe("findPluginSessionComposer", () => {
  test("matches a running plugin to its owned session type", () => {
    expect(
      findPluginSessionComposer({
        session: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        project: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        plugins: [tavernPlugin],
      }),
    ).toMatchObject({ pluginID: "lfcode-tavern", type: "tavern", mode: "replace" })
  })

  test("falls back when the matching plugin is disabled or degraded", () => {
    expect(
      findPluginSessionComposer({
        session: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        project: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        plugins: [{ ...tavernPlugin, runtime: { lifecycle: "degraded" as const } }],
      }),
    ).toBeUndefined()
  })

  test("uses the managed project extension before its first session exists", () => {
    expect(
      findPluginSessionComposer({
        project: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        plugins: [tavernPlugin],
      }),
    ).toMatchObject({ pluginID: "lfcode-tavern", type: "tavern" })
  })

  test("does not apply a project composer to an explicit normal session", () => {
    expect(
      findPluginSessionComposer({
        session: {},
        project: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        plugins: [tavernPlugin],
      }),
    ).toBeUndefined()
  })

  test("does not apply Tavern outside its managed project", () => {
    expect(
      findPluginSessionComposer({
        session: { extension: { pluginID: "lfcode-tavern", type: "tavern" } },
        project: {},
        plugins: [tavernPlugin],
      }),
    ).toBeUndefined()
  })
})
