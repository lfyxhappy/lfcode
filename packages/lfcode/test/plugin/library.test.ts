import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"

import {
  commitImport,
  discardImportPreview,
  exportPlugin,
  listInstalledPlugins,
  listManagedPluginSpecs,
  previewDirectoryImport,
  previewGeneratedImport,
  previewNpmImport,
  previewZipImport,
  resolveManagedPluginTarget,
  setPluginEnabled,
  uninstallPlugin,
} from "../../src/plugin/library"
import { createPluginEntry, pluginSource, resolvePluginTarget } from "../../src/plugin/shared"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  delete process.env.LFCODE_PLUGIN_LIBRARY_DIR
})

async function createPlugin(dir: string, version = "1.0.0") {
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "managed-demo",
      version,
      lfcode: {
        apiVersion: 2,
        id: "demo.managed",
        name: "Managed Demo",
        version,
        description: "Managed plugin fixture",
        category: "tool",
        capabilities: ["tool"],
        entrypoints: { location: "./index.ts" },
      },
    }),
  )
  await Bun.write(path.join(dir, "index.ts"), 'export default { id: "demo.managed", server: async () => ({}) }')
}

describe("managed plugin library", () => {
  test("previews, commits, resolves, and consumes a token once", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        await createPlugin(plugin)
        return { plugin, library }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    const preview = await previewDirectoryImport({ directory: tmp.extra.plugin })
    expect(preview.report).toMatchObject({
      id: "demo.managed",
      category: "tool",
      operation: "install",
      source: { type: "directory" },
    })
    expect(preview.report.source.digest).toHaveLength(64)

    const record = await commitImport(preview.token)
    expect(record.spec).toBe("lfplugin:demo.managed")
    expect(await listManagedPluginSpecs()).toEqual(["lfplugin:demo.managed"])
    expect(pluginSource(record.spec)).toBe("managed")
    expect(await resolveManagedPluginTarget(record.spec)).toBe(record.directory)
    expect(await resolvePluginTarget(record.spec)).toBe(record.directory)
    expect((await createPluginEntry(record.spec, record.directory, "server")).entry).toBe(
      new URL(`file://${path.join(record.directory, "index.ts").replaceAll("\\", "/")}`).href,
    )
    await expect(commitImport(preview.token)).rejects.toThrow()
  })

  test("materializes npm specs into the reviewed managed library", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        await createPlugin(plugin)
        return { plugin, library }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    const preview = await previewNpmImport({ spec: `file:${tmp.extra.plugin}` })
    expect(preview.report).toMatchObject({
      id: "demo.managed",
      source: { type: "npm", label: `file:${tmp.extra.plugin}` },
      operation: "install",
    })
    const record = await commitImport(preview.token)
    expect(record).toMatchObject({ spec: "lfplugin:demo.managed", source: { type: "npm" } })
  })

  test("deduplicates unchanged imports and switches current on replacement", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        await createPlugin(plugin)
        return { plugin, library }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    await commitImport((await previewDirectoryImport({ directory: tmp.extra.plugin })).token)
    expect((await previewDirectoryImport({ directory: tmp.extra.plugin })).report.operation).toBe("unchanged")

    await createPlugin(tmp.extra.plugin, "2.0.0")
    const replacement = await previewDirectoryImport({ directory: tmp.extra.plugin })
    expect(replacement.report.operation).toBe("replace")
    const record = await commitImport(replacement.token)
    expect(record.version).toBe("2.0.0")
    expect(await Bun.file(path.join(record.directory, "package.json")).json()).toMatchObject({ version: "2.0.0" })
  })

  test("rejects symlinks and expired preview tokens", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        await createPlugin(plugin)
        return { plugin, library }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    const expired = await previewDirectoryImport({ directory: tmp.extra.plugin, ttlMs: -1 })
    await expect(commitImport(expired.token)).rejects.toThrow("expired")

    const changed = await previewDirectoryImport({ directory: tmp.extra.plugin })
    await Bun.write(
      path.join(tmp.extra.library, "previews", changed.token, "snapshot", "index.ts"),
      "export default {}",
    )
    await expect(commitImport(changed.token)).rejects.toThrow("contents changed")
    await expect(commitImport(changed.token)).rejects.toThrow()

    const sourceChanged = await previewDirectoryImport({ directory: tmp.extra.plugin })
    await Bun.write(path.join(tmp.extra.plugin, "index.ts"), "export default {}")
    await expect(commitImport(sourceChanged.token)).rejects.toThrow("source contents changed")
    await expect(commitImport(sourceChanged.token)).rejects.toThrow()

    const abandoned = await previewDirectoryImport({ directory: tmp.extra.plugin, ttlMs: -1 })
    const next = await previewDirectoryImport({ directory: tmp.extra.plugin })
    expect(await Bun.file(path.join(tmp.extra.library, "previews", abandoned.token, "preview.json")).exists()).toBe(
      false,
    )
    await discardImportPreview(next.token)

    const link = path.join(tmp.extra.plugin, "linked.ts")
    const symlink = await fs.symlink(path.join(tmp.extra.plugin, "index.ts"), link).then(
      () => true,
      () => false,
    )
    if (symlink) await expect(previewDirectoryImport({ directory: tmp.extra.plugin })).rejects.toThrow("symbolic link")
  })

  test("loads enabled managed plugins into every location runtime", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const project = path.join(dir, "project")
        const library = path.join(dir, "library")
        const mark = path.join(dir, "loaded.txt")
        await createPlugin(plugin)
        await fs.mkdir(project, { recursive: true })
        await Bun.write(
          path.join(plugin, "index.ts"),
          [
            "export default {",
            '  id: "demo.managed",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "loaded")`,
            "    return {}",
            "  },",
            "}",
          ].join("\n"),
        )
        return { plugin, project, library, mark }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library
    await commitImport((await previewDirectoryImport({ directory: tmp.extra.plugin })).token)

    const status = await Instance.provide({
      directory: tmp.extra.project,
      fn: () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          yield* plugin.list()
          return yield* plugin.status()
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(await Bun.file(tmp.extra.mark).text()).toBe("loaded")
    expect(status).toContainEqual({
      id: "demo.managed",
      spec: "lfplugin:demo.managed",
      source: "managed",
      lifecycle: "active",
    })
  })

  test("materializes the author SDK and loads generated plugins", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const project = path.join(dir, "project")
        const library = path.join(dir, "library")
        const mark = path.join(dir, "generated-loaded.txt")
        await createPlugin(plugin)
        await fs.mkdir(project, { recursive: true })
        await Bun.write(
          path.join(plugin, "index.ts"),
          [
            'import { defineServerPlugin } from "@lfcode-ai/plugin"',
            "",
            "export default defineServerPlugin({",
            '  id: "demo.managed",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "loaded")`,
            "    return {}",
            "  },",
            "})",
          ].join("\n"),
        )
        return { plugin, project, library, mark }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    const preview = await previewGeneratedImport({ directory: tmp.extra.plugin })
    expect(preview.report.source.type).toBe("generated")
    expect(preview.report.dependencies).toContainEqual({
      name: "@lfcode-ai/plugin",
      requested: "file:.lfcode-author-sdk",
      version: "0.1.0",
      optional: false,
    })
    const record = await commitImport(preview.token)
    expect(await Filesystem.isDir(path.join(record.directory, "node_modules", "@lfcode-ai", "plugin"))).toBe(true)

    const status = await Instance.provide({
      directory: tmp.extra.project,
      fn: () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          yield* plugin.list()
          return yield* plugin.status()
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(await Bun.file(tmp.extra.mark).text()).toBe("loaded")
    expect(status).toContainEqual({
      id: "demo.managed",
      spec: "lfplugin:demo.managed",
      source: "managed",
      lifecycle: "active",
    })
  })

  test("rejects generated categories and non-registry dependencies outside the authoring contract", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        await createPlugin(plugin)
        return { plugin, library }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    const pkg = await Bun.file(path.join(tmp.extra.plugin, "package.json")).json()
    pkg.lfcode.category = "provider"
    await Bun.write(path.join(tmp.extra.plugin, "package.json"), JSON.stringify(pkg))
    await expect(previewGeneratedImport({ directory: tmp.extra.plugin })).rejects.toThrow(
      "Generated plugins must use category tool or integration",
    )

    const forged = await previewDirectoryImport({ directory: tmp.extra.plugin })
    const previewFile = path.join(tmp.extra.library, "previews", forged.token, "preview.json")
    const state = await Bun.file(previewFile).json()
    state.report.source.type = "generated"
    await Bun.write(previewFile, JSON.stringify(state))
    await expect(commitImport(forged.token)).rejects.toThrow("Generated plugins must use category tool or integration")

    pkg.lfcode.category = "tool"
    pkg.dependencies = { unsafe: "file:../unsafe" }
    await Bun.write(path.join(tmp.extra.plugin, "package.json"), JSON.stringify(pkg))
    await expect(previewDirectoryImport({ directory: tmp.extra.plugin })).rejects.toThrow("must use a registry version")
  })

  test("previews ZIP packages with a single top-level directory and re-exports deterministically", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        const archive = path.join(dir, "demo.lfplugin.zip")
        const outputA = path.join(dir, "a.lfplugin.zip")
        const outputB = path.join(dir, "b.lfplugin.zip")
        await createPlugin(plugin)
        await createZip(archive, [
          ["managed-demo/package.json", await Bun.file(path.join(plugin, "package.json")).text()],
          ["managed-demo/index.ts", await Bun.file(path.join(plugin, "index.ts")).text()],
        ])
        return { library, archive, outputA, outputB }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    const preview = await previewZipImport({ file: tmp.extra.archive })
    expect(preview.report.source.type).toBe("zip")
    const record = await commitImport(preview.token)
    await exportPlugin(record.spec, tmp.extra.outputA)
    await exportPlugin(record.spec, tmp.extra.outputB)
    expect(await Bun.file(tmp.extra.outputA).arrayBuffer()).toEqual(await Bun.file(tmp.extra.outputB).arrayBuffer())
    const reimport = await previewZipImport({ file: tmp.extra.outputA })
    expect(reimport.report).toMatchObject({
      id: "demo.managed",
      operation: "unchanged",
      source: { type: "zip" },
    })
    expect((await commitImport(reimport.token)).source.type).toBe("zip")
    expect((await listInstalledPlugins())[0]?.source.type).toBe("zip")
  })

  test("lists, disables, enables, and uninstalls managed plugins", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        const library = path.join(dir, "library")
        await createPlugin(plugin)
        return { plugin, library }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library
    const record = await commitImport((await previewDirectoryImport({ directory: tmp.extra.plugin })).token)

    expect(await listInstalledPlugins()).toMatchObject([{ spec: record.spec, enabled: true, category: "tool" }])
    expect(await setPluginEnabled(record.spec, false)).toEqual({ spec: record.spec, enabled: false })
    expect(await listManagedPluginSpecs()).toEqual([])
    expect(await listInstalledPlugins()).toMatchObject([{ spec: record.spec, enabled: false }])
    await setPluginEnabled(record.spec, true)
    expect(await listManagedPluginSpecs()).toEqual([record.spec])
    expect(await uninstallPlugin(record.spec)).toEqual({ spec: record.spec, uninstalled: true })
    expect(await listInstalledPlugins()).toEqual([])
  })

  test("rejects unsafe ZIP paths, executable payloads, and duplicate case-folded names", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => ({ library: path.join(dir, "library"), dir }),
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = tmp.extra.library

    for (const [name, entries, message] of [
      ["traversal.zip", [["../package.json", "{}"]], "invalid path"],
      ["absolute.zip", [["C:/package.json", "{}"]], "absolute path"],
      [
        "executable.zip",
        [
          ["package.json", "{}"],
          ["run.exe", "x"],
        ],
        "executable",
      ],
      [
        "native.zip",
        [
          ["package.json", "{}"],
          ["addon.node", "x"],
        ],
        "executable",
      ],
      [
        "duplicate.zip",
        [
          ["package.json", "{}"],
          ["Index.ts", "a"],
          ["index.ts", "b"],
        ],
        "duplicate path",
      ],
    ] as const) {
      const file = path.join(tmp.extra.dir, name)
      await createZip(file, entries)
      await expect(previewZipImport({ file })).rejects.toThrow(message)
    }
  })
})

async function createZip(file: string, entries: readonly (readonly [string, string])[]) {
  const zip = await import("@zip.js/zip.js")
  const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter())
  for (const [name, content] of entries) {
    await writer.add(name, new zip.TextReader(content), { lastModDate: new Date(0) })
  }
  await Bun.write(file, await writer.close())
}
