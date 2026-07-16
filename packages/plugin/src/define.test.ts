import { describe, expect, test } from "bun:test"
import { definePlugin, defineServerPlugin, type Hooks, type PluginInput } from "./index.js"
import { defineTuiPlugin, type TuiPluginApi, type TuiPluginMeta } from "./tui.js"

describe("plugin define helpers", () => {
  test("definePlugin preserves mixed server+tui modules", () => {
    const server = async (_input: PluginInput): Promise<Hooks> => ({})
    const tui = async (_api: TuiPluginApi, _options: Record<string, unknown> | undefined, _meta: TuiPluginMeta) => {}
    const plugin = definePlugin({
      id: "demo.mixed",
      server,
      tui,
    })

    expect(plugin.id).toBe("demo.mixed")
    expect(plugin.server).toBe(server)
    expect(plugin.tui).toBe(tui)
  })

  test("defineServerPlugin preserves server-only modules", () => {
    const server = async (_input: PluginInput): Promise<Hooks> => ({})
    const plugin = defineServerPlugin({
      id: "demo.server",
      server,
    })

    expect(plugin.id).toBe("demo.server")
    expect(plugin.server).toBe(server)
  })

  test("defineTuiPlugin preserves tui-only modules", () => {
    const tui = async (_api: TuiPluginApi, _options: Record<string, unknown> | undefined, _meta: TuiPluginMeta) => {}
    const plugin = defineTuiPlugin({
      id: "demo.tui",
      tui,
    })

    expect(plugin.id).toBe("demo.tui")
    expect(plugin.tui).toBe(tui)
  })
})
