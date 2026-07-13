import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"

const disableDefault = process.env.LFCODE_DISABLE_DEFAULT_PLUGINS
process.env.LFCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Config } = await import("../../src/config")
const { Instance } = await import("../../src/project/instance")

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.LFCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.LFCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

async function project(source: string, enabled = true) {
  return tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      const spec = pathToFileURL(file).href
      await Bun.write(file, source)
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify(
          {
            $schema: "https://lfcode.ai/config.json",
            plugin: [spec],
            ...(enabled ? {} : { plugin_enabled: { [spec]: false } }),
          },
          null,
          2,
        ),
      )
    },
  })
}

describe("plugin.trigger", () => {
  test("runs synchronous hooks without crashing", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = { system: [] as string[] }
          yield* plugin.trigger(
            "experimental.chat.system.transform",
            {
              model: {
                providerID: "anthropic",
                modelID: "claude-sonnet-4-6",
              } as any,
            },
            out,
          )
          return out
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out.system).toEqual(["sync"])
  })

  test("awaits asynchronous hooks", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": async (_input, output) => {',
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = { system: [] as string[] }
          yield* plugin.trigger(
            "experimental.chat.system.transform",
            {
              model: {
                providerID: "anthropic",
                modelID: "claude-sonnet-4-6",
              } as any,
            },
            out,
          )
          return out
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(out.system).toEqual(["async"])
  })

  test("does not activate a plugin disabled by its canonical spec", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("disabled")',
        "  },",
        "})",
        "",
      ].join("\n"),
      false,
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = { system: [] as string[] }
          yield* plugin.trigger(
            "experimental.chat.system.transform",
            {
              model: {
                providerID: "anthropic",
                modelID: "claude-sonnet-4-6",
              } as any,
            },
            out,
          )
          return { out, status: yield* plugin.status() }
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(result.out.system).toEqual([])
    expect(result.status.find((item) => item.spec.endsWith("plugin.ts"))?.lifecycle).toBe("disabled")
  })

  test("rebuilds only the current plugin state when a plugin is disabled", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("live")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const config = yield* Config.Service
          const input = {
            model: {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-6",
            } as any,
          }
          const before = { system: [] as string[] }
          yield* plugin.trigger("experimental.chat.system.transform", input, before)
          const spec = pathToFileURL(path.join(tmp.path, "plugin.ts")).href
          yield* config.updatePluginEnabled(spec, false)
          yield* plugin.reload()
          const after = { system: [] as string[] }
          yield* plugin.trigger("experimental.chat.system.transform", input, after)
          return { before, after, status: yield* plugin.status() }
        }).pipe(Effect.provide(Layer.mergeAll(Plugin.defaultLayer, Config.defaultLayer)), Effect.runPromise),
    })

    expect(result.before.system).toEqual(["live"])
    expect(result.after.system).toEqual([])
    expect(result.status.find((item) => item.spec.endsWith("plugin.ts"))?.lifecycle).toBe("disabled")
  })
})
