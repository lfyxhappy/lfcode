import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { mockTuiRuntime } from "../../fixture/tui-runtime"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("runs onDispose callbacks with aborted signal and is idempotent", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "marker.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.lifecycle",
  tui: async (api, options) => {
    api.event.on("event.test", () => {})
    api.route.register([{ name: "lifecycle.route", render: () => null }])
    api.lifecycle.onDispose(async () => {
      const prev = await Bun.file(options.marker).text().catch(() => "")
      await Bun.write(options.marker, prev + "custom\\n")
    })
    api.lifecycle.onDispose(async () => {
      const prev = await Bun.file(options.marker).text().catch(() => "")
      await Bun.write(options.marker, prev + "aborted:" + String(api.lifecycle.signal.aborted) + "\\n")
    })
  },
}
`,
      )

      return { spec, marker }
    },
  })

  const { config, restore } = mockTuiRuntime(tmp.path, [[tmp.extra.spec, { marker: tmp.extra.marker }]])

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await TuiPluginRuntime.dispose()

    const marker = await fs.readFile(tmp.extra.marker, "utf8")
    expect(marker).toContain("custom")
    expect(marker).toContain("aborted:true")

    // second dispose is a no-op
    await TuiPluginRuntime.dispose()
    const after = await fs.readFile(tmp.extra.marker, "utf8")
    expect(after).toBe(marker)
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})

test("rolls back failed plugin and continues loading next", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const bad = path.join(dir, "bad-plugin.ts")
      const good = path.join(dir, "good-plugin.ts")
      const badSpec = pathToFileURL(bad).href
      const goodSpec = pathToFileURL(good).href
      const badMarker = path.join(dir, "bad-cleanup.txt")
      const goodMarker = path.join(dir, "good-called.txt")

      await Bun.write(
        bad,
        `export default {
  id: "demo.bad",
  tui: async (api, options) => {
    api.route.register([{ name: "bad.route", render: () => null }])
    api.lifecycle.onDispose(async () => {
      await Bun.write(options.bad_marker, "cleaned")
    })
    throw new Error("bad plugin")
  },
}
`,
      )

      await Bun.write(
        good,
        `export default {
  id: "demo.good",
  tui: async (_api, options) => {
    await Bun.write(options.good_marker, "called")
  },
}
`,
      )

      return { badSpec, goodSpec, badMarker, goodMarker }
    },
  })

  const { config, restore } = mockTuiRuntime(tmp.path, [
    [tmp.extra.badSpec, { bad_marker: tmp.extra.badMarker }],
    [tmp.extra.goodSpec, { good_marker: tmp.extra.goodMarker }],
  ])

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    // bad plugin's onDispose ran during rollback
    await expect(fs.readFile(tmp.extra.badMarker, "utf8")).resolves.toBe("cleaned")
    // good plugin still loaded
    await expect(fs.readFile(tmp.extra.goodMarker, "utf8")).resolves.toBe("called")
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})

test("registers declared trusted TUI slots and removes them on deactivate", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "slot-plugin")
      const file = path.join(plugin, "plugin.ts")
      const spec = pathToFileURL(plugin).href
      const marker = path.join(dir, "slot-setup.txt")

      await fs.mkdir(plugin, { recursive: true })
      await Bun.write(
        path.join(plugin, "package.json"),
        JSON.stringify({
          name: "demo-slot-plugin",
          type: "module",
          lfcode: {
            apiVersion: "2",
            id: "demo.slot",
            category: "ui",
            trust: "dev-local",
            entrypoints: { tui: "./plugin.ts" },
            uiContributions: [{ slot: "tui-slot" }],
          },
        }),
      )

      await Bun.write(
        file,
        `import fs from "fs"

const mark = (label) => {
  fs.appendFileSync(${JSON.stringify(marker)}, label + "\\n")
}

export default {
  id: "demo.slot",
  tui: async (api) => {
    const one = api.slots.register({
      id: 1,
      setup: () => { mark("one") },
      slots: { home_logo() { return null } },
    })
    const two = api.slots.register({
      id: 2,
      setup: () => { mark("two") },
      dispose: () => { mark("disposed") },
      slots: { home_bottom() { return null } },
    })
    mark("id:" + one)
    mark("id:" + two)
  },
}
`,
      )

      return { spec, marker }
    },
  })

  const { config, restore } = mockTuiRuntime(tmp.path, [tmp.extra.spec])
  const err = spyOn(console, "error").mockImplementation(() => {})

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })

    const marker = await fs.readFile(tmp.extra.marker, "utf8")
    expect(marker).toContain("one")
    expect(marker).toContain("two")
    expect(marker).toContain("id:demo.slot")
    expect(marker).toContain("id:demo.slot:1")

    // no initialization failures
    const hit = err.mock.calls.find(
      (item) => typeof item[0] === "string" && item[0].includes("failed to initialize tui plugin"),
    )
    expect(hit).toBeUndefined()

    await expect(TuiPluginRuntime.deactivatePlugin("demo.slot")).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toContain("disposed")
  } finally {
    await TuiPluginRuntime.dispose()
    err.mockRestore()
    restore()
  }
})

test("blocks undeclared and external TUI UI contributions without disabling their plugin", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const makePlugin = async (name: string, trust: "external" | "dev-local", declare: boolean, slot: string) => {
        const plugin = path.join(dir, name)
        const marker = path.join(dir, `${name}.txt`)
        await fs.mkdir(plugin, { recursive: true })
        await Bun.write(
          path.join(plugin, "package.json"),
          JSON.stringify({
            name,
            type: "module",
            lfcode: {
              apiVersion: "2",
              id: `demo.${name}`,
              category: "ui",
              trust,
              entrypoints: { tui: "./plugin.ts" },
              ...(declare ? { uiContributions: [{ slot: "tui-slot" }] } : {}),
            },
          }),
        )
        await Bun.write(
          path.join(plugin, "plugin.ts"),
          `import fs from "fs"
export default {
  tui: async (api) => {
    api.slots.register({
      setup: () => fs.appendFileSync(${JSON.stringify(marker)}, "mounted\\n"),
      slots: { ${slot}() { return null } },
    })
    fs.appendFileSync(${JSON.stringify(marker)}, "continued\\n")
  },
}
`,
        )
        return { spec: pathToFileURL(plugin).href, marker }
      }

      const external = await makePlugin("external-ui", "external", true, "home_bottom")
      const undeclared = await makePlugin("undeclared-ui", "dev-local", false, "home_bottom")
      const unsafe = await makePlugin("unsafe-ui", "dev-local", true, "session_prompt")
      return { external, undeclared, unsafe }
    },
  })

  const { config, restore } = mockTuiRuntime(tmp.path, [
    tmp.extra.external.spec,
    tmp.extra.undeclared.spec,
    tmp.extra.unsafe.spec,
  ])

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })

    for (const item of [tmp.extra.external, tmp.extra.undeclared, tmp.extra.unsafe]) {
      await expect(fs.readFile(item.marker, "utf8")).resolves.toBe("continued\n")
    }
    expect(TuiPluginRuntime.list().every((item) => item.active)).toBe(true)
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})

test(
  "times out hanging plugin cleanup on dispose",
  async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "timeout-plugin.ts")
        const spec = pathToFileURL(file).href

        await Bun.write(
          file,
          `export default {
  id: "demo.timeout",
  tui: async (api) => {
    api.lifecycle.onDispose(() => new Promise(() => {}))
  },
}
`,
        )

        return { spec }
      },
    })

    const { config, restore } = mockTuiRuntime(tmp.path, [tmp.extra.spec])

    try {
      await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })

      const done = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), 7000)
        void TuiPluginRuntime.dispose().then(() => {
          clearTimeout(timer)
          resolve("done")
        })
      })
      expect(done).toBe("done")
    } finally {
      await TuiPluginRuntime.dispose()
      restore()
    }
  },
  { timeout: 15000 },
)
