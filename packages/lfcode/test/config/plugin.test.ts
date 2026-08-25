import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigPaths } from "@/config/paths"
import { AppFileSystem } from "@/filesystem"
import { Global } from "@/global"
import { PluginPath } from "@/plugin/path"

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-plugin-config-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function withProfileRoot<T>(root: string, fn: () => Promise<T>) {
  const config = Object.getOwnPropertyDescriptor(Global.Path, "config")
  const data = Object.getOwnPropertyDescriptor(Global.Path, "data")
  if (!config || !data) throw new Error("Global plugin paths are unavailable")
  Object.defineProperties(Global.Path, {
    config: { ...config, value: path.join(root, "config") },
    data: { ...data, value: path.join(root, "data") },
  })
  try {
    return await fn()
  } finally {
    Object.defineProperties(Global.Path, { config, data })
  }
}

describe("local plugin discovery", () => {
  test("uses the Node-compatible manifest read path", async () => {
    await using tmp = await tmpdir()
    const plugin = path.join(tmp.path, "plugins", "example")
    await fs.mkdir(plugin, { recursive: true })
    await fs.writeFile(
      path.join(plugin, "package.json"),
      JSON.stringify({
        name: "example",
        lfcode: {
          apiVersion: 2,
          id: "example",
          entrypoints: { location: "./index.js" },
        },
      }),
    )

    const source = await fs.readFile(new URL("../../src/config/plugin.ts", import.meta.url), "utf8")
    expect(source).toContain('from "node:fs/promises"')
    expect(source).not.toContain("Bun.")
    await expect(ConfigPlugin.load(tmp.path)).resolves.toEqual([pathToFileURL(plugin).href])
  })
})

describe("legacy plugin directory migration", () => {
  test("migrates a legacy-only profile before directory discovery", async () => {
    await using tmp = await tmpdir()
    const plugin = path.join(tmp.path, "config", "plugins", "discovered")
    await fs.mkdir(plugin, { recursive: true })
    await fs.writeFile(
      path.join(plugin, "package.json"),
      JSON.stringify({
        name: "discovered",
        lfcode: {
          apiVersion: 2,
          id: "discovered",
          entrypoints: { location: "./index.js" },
        },
      }),
    )

    await withProfileRoot(tmp.path, async () => {
      const directories = await Effect.runPromise(
        ConfigPaths.pluginDirectories(tmp.path).pipe(Effect.provide(AppFileSystem.defaultLayer)),
      )
      expect(directories).toContain(tmp.path)
      await expect(fs.readFile(path.join(tmp.path, "plugins", "discovered", "package.json"), "utf8")).resolves.toContain(
        '"discovered"',
      )
      await expect(ConfigPlugin.load(tmp.path)).resolves.toEqual([pathToFileURL(path.join(tmp.path, "plugins", "discovered")).href])
    })
  })

  test("migrates the current profile before root-level discovery", async () => {
    await using tmp = await tmpdir()
    const plugin = path.join(tmp.path, "config", "plugins", "migrated")
    await fs.mkdir(plugin, { recursive: true })
    await fs.writeFile(
      path.join(plugin, "package.json"),
      JSON.stringify({
        name: "migrated",
        lfcode: {
          apiVersion: 2,
          id: "migrated",
          entrypoints: { location: "./index.js" },
        },
      }),
    )

    await withProfileRoot(tmp.path, async () => {
      await expect(ConfigPlugin.load(tmp.path)).resolves.toEqual([pathToFileURL(path.join(tmp.path, "plugins", "migrated")).href])
    })
    await expect(fs.readFile(path.join(tmp.path, "plugins", "migrated", "package.json"), "utf8")).resolves.toContain('"migrated"')
  })

  test("adds only missing legacy files and remains idempotent", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "config", "plugins")
    const target = path.join(tmp.path, "plugins")
    const sourceData = path.join(source, "sample", "data")
    const targetData = path.join(target, "sample", "data")
    await fs.mkdir(sourceData, { recursive: true })
    await fs.mkdir(targetData, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(source, "sample", "package.json"), "legacy-manifest"),
      fs.writeFile(path.join(sourceData, "keep.txt"), "legacy-value"),
      fs.writeFile(path.join(sourceData, "missing.txt"), "copied-value"),
      fs.writeFile(path.join(targetData, "keep.txt"), "user-value"),
    ])

    const first = await PluginPath.migrateLegacyPlugins({ source, target })
    const second = await PluginPath.migrateLegacyPlugins({ source, target })

    expect(await fs.readFile(path.join(targetData, "keep.txt"), "utf8")).toBe("user-value")
    expect(await fs.readFile(path.join(targetData, "missing.txt"), "utf8")).toBe("copied-value")
    expect(await fs.readFile(path.join(target, "sample", "package.json"), "utf8")).toBe("legacy-manifest")
    expect(first.copied).toContain(path.join(targetData, "missing.txt"))
    expect(first.preserved).toContain(path.join(targetData, "keep.txt"))
    expect(second.copied).toEqual([])
  })

  test("preserves file and directory conflicts", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "config", "plugins")
    const target = path.join(tmp.path, "plugins")
    await fs.mkdir(path.join(source, "directory-source"), { recursive: true })
    await fs.mkdir(path.join(target, "file-source"), { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(source, "directory-source", "entry.js"), "source-file"),
      fs.writeFile(path.join(source, "file-source"), "source-file"),
      fs.writeFile(path.join(target, "directory-source"), "user-file"),
      fs.writeFile(path.join(target, "file-source", "entry.js"), "user-file"),
    ])

    const result = await PluginPath.migrateLegacyPlugins({ source, target })

    expect(await fs.readFile(path.join(target, "directory-source"), "utf8")).toBe("user-file")
    expect(await fs.readFile(path.join(target, "file-source", "entry.js"), "utf8")).toBe("user-file")
    expect(result.copied).toEqual([])
    expect(result.preserved).toEqual(expect.arrayContaining([path.join(target, "directory-source"), path.join(target, "file-source")]))
  })
})
