import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"

import { readPluginManifest } from "../../src/plugin/install"
import { createPluginEntry, resolvePluginId } from "../../src/plugin/shared"
import { tmpdir } from "../fixture/fixture"
import { readLfcodePluginManifest } from "@lfcode-ai/plugin"

async function createPluginPackage(root: string, json: Record<string, unknown>) {
  const dir = path.join(root, "plugin")
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, "package.json"), JSON.stringify(json, null, 2))
  return dir
}

describe("plugin manifest entrypoints", () => {
  test("reads skill requirements and constrained UI contribution declarations", () => {
    const manifest = readLfcodePluginManifest(
      {
        apiVersion: 2,
        entrypoints: {},
        skillRequirements: [
          { id: "office-documents", purpose: "Validate generated Office documents" },
          { id: "optional-style-guide", required: false },
        ],
        uiContributions: [{ slot: "desktop-settings-panel", title: "Office settings" }],
      },
      "manifest-contract",
    )

    expect(manifest?.skillRequirements).toEqual([
      { id: "office-documents", purpose: "Validate generated Office documents" },
      { id: "optional-style-guide", required: false },
    ])
    expect(manifest?.uiContributions).toEqual([{ slot: "desktop-settings-panel", title: "Office settings" }])
  })

  test("rejects UI contribution slots outside the host allowlist", () => {
    expect(() =>
      readLfcodePluginManifest(
        { apiVersion: 2, entrypoints: {}, uiContributions: [{ slot: "editor-dom" }] },
        "unsafe-ui-plugin",
      ),
    ).toThrow("invalid lfcode.uiContributions[].slot")
  })

  test("readPluginManifest prefers lfcode manifest entrypoints over legacy exports", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = await createPluginPackage(dir, {
          name: "manifest-demo",
          version: "1.0.0",
          main: "./legacy-server.js",
          exports: {
            "./server": "./legacy-server.js",
            "./tui": "./legacy-tui.js",
          },
          lfcode: {
            apiVersion: 2,
            id: "manifest-demo",
            name: "Manifest Demo",
            entrypoints: {
              location: {
                path: "./manifest-server.js",
                config: {
                  channel: "stable",
                },
              },
              tui: "./manifest-tui.js",
            },
          },
        })
        return { plugin }
      },
    })

    const manifest = await readPluginManifest(tmp.extra.plugin)
    expect(manifest).toEqual({
      ok: true,
      targets: [
        {
          kind: "server",
          opts: {
            channel: "stable",
          },
        },
        {
          kind: "tui",
          opts: undefined,
        },
      ],
    })
  })

  test("readPluginManifest does not fall back to legacy exports when manifest only declares unsupported targets", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = await createPluginPackage(dir, {
          name: "desktop-only-plugin",
          version: "1.0.0",
          main: "./legacy-server.js",
          exports: {
            "./server": "./legacy-server.js",
          },
          lfcode: {
            apiVersion: 2,
            entrypoints: {
              desktop: "./desktop.js",
            },
          },
        })
        return { plugin }
      },
    })

    const manifest = await readPluginManifest(tmp.extra.plugin)
    expect(manifest.ok).toBe(false)
    if (manifest.ok) return
    expect(manifest.code).toBe("manifest_no_targets")
  })

  test("createPluginEntry resolves manifest location and tui entrypoint paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = await createPluginPackage(dir, {
          name: "manifest-entry",
          version: "1.0.0",
          lfcode: {
            apiVersion: 2,
            id: "manifest-entry",
            entrypoints: {
              location: "./server-entry.js",
              tui: "./tui-entry.js",
            },
          },
        })
        await Bun.write(path.join(plugin, "server-entry.js"), "export default {}")
        await Bun.write(path.join(plugin, "tui-entry.js"), "export default {}")
        return { plugin }
      },
    })

    const server = await createPluginEntry("manifest-entry", tmp.extra.plugin, "server")
    const tui = await createPluginEntry("manifest-entry", tmp.extra.plugin, "tui")

    expect(server.entry).toBe(pathToFileURL(path.join(tmp.extra.plugin, "server-entry.js")).href)
    expect(tui.entry).toBe(pathToFileURL(path.join(tmp.extra.plugin, "tui-entry.js")).href)
  })

  test("resolvePluginId prefers manifest id for path plugins", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = await createPluginPackage(dir, {
          name: "legacy-file-plugin",
          version: "1.0.0",
          lfcode: {
            apiVersion: 2,
            id: "manifest.file.plugin",
            entrypoints: {
              location: "./server-entry.js",
            },
          },
        })
        await Bun.write(path.join(plugin, "server-entry.js"), "export default {}")
        return { plugin }
      },
    })

    await expect(resolvePluginId("file", tmp.extra.plugin, tmp.extra.plugin, undefined)).resolves.toBe("manifest.file.plugin")
  })

  test("resolvePluginId prefers manifest id over package name for npm plugins", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = await createPluginPackage(dir, {
          name: "legacy-package-name",
          version: "1.0.0",
          lfcode: {
            apiVersion: 2,
            id: "manifest.package.plugin",
            entrypoints: {
              tui: "./tui-entry.js",
            },
          },
        })
        await Bun.write(path.join(plugin, "tui-entry.js"), "export default {}")
        return { plugin }
      },
    })

    await expect(resolvePluginId("npm", "legacy-package-name", tmp.extra.plugin, undefined)).resolves.toBe("manifest.package.plugin")
  })
})
