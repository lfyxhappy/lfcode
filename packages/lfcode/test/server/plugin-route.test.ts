import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import path from "path"

import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
  delete process.env.LFCODE_PLUGIN_LIBRARY_DIR
})

describe("plugin routes", () => {
  test("POST /plugin/library/preview and GET /plugin/library use the managed plugin library", async () => {
    await using tmp = await tmpdir()
    const plugin = path.join(tmp.path, "plugin")
    const previous = process.env.LFCODE_PLUGIN_LIBRARY_DIR
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = path.join(tmp.path, "library")

    try {
      await createPlugin(plugin)

      const previewResponse = await Server.Default().app.request("/plugin/library/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ source: "directory", path: plugin }),
      })

      await expectOk(previewResponse)
      const preview = await readPreview(previewResponse)
      expect(preview.token).toMatch(/^[0-9a-f-]{36}$/i)
      expect(preview.report).toMatchObject({
        id: "demo.managed",
        category: "tool",
        operation: "install",
        source: { type: "directory" },
      })
      if (!isRecord(preview.report.source) || typeof preview.report.source.digest !== "string") {
        throw new Error("Plugin preview response has an invalid source")
      }
      expect(preview.report.source.digest).toHaveLength(64)

      const listResponse = await Server.Default().app.request("/plugin/library", {
        method: "GET",
        headers: { "x-lfcode-directory": tmp.path },
      })

      await expectOk(listResponse)
      expect(await listResponse.json()).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.LFCODE_PLUGIN_LIBRARY_DIR
      else process.env.LFCODE_PLUGIN_LIBRARY_DIR = previous
      await Instance.provide({
        directory: tmp.path,
        fn: () => Instance.dispose(),
      }).catch(() => undefined)
      Bun.gc(true)
      await sleep(200)
    }
  })

  test("managed plugin routes commit, toggle, and uninstall a preview", async () => {
    await using tmp = await tmpdir()
    const plugin = path.join(tmp.path, "plugin")
    const previous = process.env.LFCODE_PLUGIN_LIBRARY_DIR
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = path.join(tmp.path, "library")

    try {
      await createPlugin(plugin)
      const previewResponse = await Server.Default().app.request("/plugin/library/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ source: "directory", path: plugin }),
      })
      await expectOk(previewResponse)
      const preview = await readPreview(previewResponse)

      const commitResponse = await Server.Default().app.request("/plugin/library/commit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ token: preview.token }),
      })
      await expectOk(commitResponse)
      expect(await commitResponse.json()).toMatchObject({
        spec: "lfplugin:demo.managed",
        enabled: true,
        category: "tool",
      })

      const installedResponse = await Server.Default().app.request("/plugin/library", {
        headers: { "x-lfcode-directory": tmp.path },
      })
      await expectOk(installedResponse)
      const installed: unknown = await installedResponse.json()
      if (!Array.isArray(installed) || !isRecord(installed[0])) throw new Error("Managed plugin list is invalid")
      expect(installed).toMatchObject([{ spec: "lfplugin:demo.managed", enabled: true, category: "tool" }])
      expect(installed[0]).not.toHaveProperty("directory")

      const genericToggleResponse = await Server.Default().app.request("/plugin/toggle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ spec: "lfplugin:demo.managed", enabled: false }),
      })
      await expectOk(genericToggleResponse)
      expect(await genericToggleResponse.json()).toEqual({ spec: "lfplugin:demo.managed", enabled: false })

      const disabledResponse = await Server.Default().app.request("/plugin/library", {
        headers: { "x-lfcode-directory": tmp.path },
      })
      await expectOk(disabledResponse)
      expect(await disabledResponse.json()).toMatchObject([{ spec: "lfplugin:demo.managed", enabled: false }])

      const toggleResponse = await Server.Default().app.request("/plugin/library/toggle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ spec: "lfplugin:demo.managed", enabled: true }),
      })
      await expectOk(toggleResponse)

      const uninstallResponse = await Server.Default().app.request("/plugin/library/uninstall", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ spec: "lfplugin:demo.managed" }),
      })
      await expectOk(uninstallResponse)
      expect(await uninstallResponse.json()).toEqual({ spec: "lfplugin:demo.managed", uninstalled: true })

      const emptyResponse = await Server.Default().app.request("/plugin/library", {
        headers: { "x-lfcode-directory": tmp.path },
      })
      await expectOk(emptyResponse)
      expect(await emptyResponse.json()).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.LFCODE_PLUGIN_LIBRARY_DIR
      else process.env.LFCODE_PLUGIN_LIBRARY_DIR = previous
      await Instance.provide({
        directory: tmp.path,
        fn: () => Instance.dispose(),
      }).catch(() => undefined)
      Bun.gc(true)
      await sleep(200)
    }
  })
})

async function createPlugin(dir: string) {
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "managed-demo",
      version: "1.0.0",
      lfcode: {
        apiVersion: 2,
        id: "demo.managed",
        name: "Managed Demo",
        version: "1.0.0",
        description: "Managed plugin route fixture",
        category: "tool",
        capabilities: ["tool"],
        entrypoints: { location: "./index.ts" },
      },
    }),
  )
  await Bun.write(path.join(dir, "index.ts"), 'export default { id: "demo.managed", server: async () => ({}) }')
}

async function expectOk(response: Response) {
  if (response.status === 200) return
  throw new Error(await response.text())
}

async function readPreview(response: Response) {
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.token !== "string" || !isRecord(body.report)) {
    throw new Error("Plugin preview response has an invalid shape")
  }
  return { token: body.token, report: body.report }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
