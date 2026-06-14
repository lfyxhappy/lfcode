import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "node:path"
import { createRootLayout, migrateRootLayout, prepareDesktopBootstrap, resolveBootstrapTarget, resolveWindowsRootDirectory } from "./bootstrap"

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-bootstrap-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe("desktop bootstrap paths", () => {
  test("resolves the packaged win-unpacked root from process.execPath", () => {
    expect(
      resolveWindowsRootDirectory({
        execPath: "C:\\Lfcode\\win-unpacked\\Lfcode Dev.exe",
        isPackaged: true,
        platform: "win32",
      }),
    ).toBe("C:\\Lfcode\\win-unpacked")
  })

  test("resolves the installed executable root from process.execPath", () => {
    expect(
      resolveWindowsRootDirectory({
        execPath: "C:\\Program Files\\Lfcode\\Lfcode.exe",
        isPackaged: true,
        platform: "win32",
      }),
    ).toBe("C:\\Program Files\\Lfcode")
  })

  test("maps a Windows program root to root-level config and data directories", () => {
    expect(createRootLayout("C:\\Lfcode\\win-unpacked", "com.lfyxhappy.lfcode.dev")).toEqual({
      root: "C:\\Lfcode\\win-unpacked",
      configDir: "C:\\Lfcode\\win-unpacked",
      configFile: "C:\\Lfcode\\win-unpacked\\opencode.jsonc",
      dataDir: "C:\\Lfcode\\win-unpacked\\data",
      stateDir: "C:\\Lfcode\\win-unpacked\\state",
      cacheDir: "C:\\Lfcode\\win-unpacked\\cache",
      userDataDir: "C:\\Lfcode\\win-unpacked\\state\\electron\\com.lfyxhappy.lfcode.dev",
      migrationMarker: "C:\\Lfcode\\win-unpacked\\state\\migration.json",
    })
  })

  test("falls back to legacy mode when the program root is not writable", () => {
    const state = resolveBootstrapTarget({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      legacyUserDataDir: "C:\\Users\\liangfeng\\AppData\\Roaming\\com.lfyxhappy.lfcode.dev",
      root: "C:\\Program Files\\Lfcode",
      rootWritable: false,
    })

    expect(state.mode).toBe("legacy")
    expect(state.userDataDir).toBe("C:\\Users\\liangfeng\\AppData\\Roaming\\com.lfyxhappy.lfcode.dev")
    expect(state.fallbackReason).toBe("program root is not writable: C:\\Program Files\\Lfcode")
  })

  test("copies missing legacy files into the root layout without overwriting existing files", async () => {
    await using tmp = await tmpdir()
    const layout = createRootLayout(path.join(tmp.path, "root"), "com.lfyxhappy.lfcode.dev")
    const sources = {
      configDir: path.join(tmp.path, "legacy-config"),
      dataDir: path.join(tmp.path, "legacy-data"),
      stateDir: path.join(tmp.path, "legacy-state"),
      cacheDir: path.join(tmp.path, "legacy-cache"),
      userDataDir: path.join(tmp.path, "legacy-electron"),
    }

    await fs.mkdir(path.join(sources.configDir, "themes"), { recursive: true })
    await fs.mkdir(sources.dataDir, { recursive: true })
    await fs.mkdir(sources.stateDir, { recursive: true })
    await fs.mkdir(sources.cacheDir, { recursive: true })
    await fs.mkdir(sources.userDataDir, { recursive: true })
    await fs.mkdir(layout.dataDir, { recursive: true })
    await fs.mkdir(layout.stateDir, { recursive: true })
    await fs.writeFile(path.join(sources.configDir, "opencode.json"), "{\"providers\":{\"legacy\":true}}")
    await fs.writeFile(path.join(sources.configDir, "themes", "ocean.json"), "{\"name\":\"ocean\"}")
    await fs.writeFile(path.join(sources.dataDir, "auth.json"), "legacy-data")
    await fs.writeFile(path.join(sources.stateDir, "opencode.db"), "legacy-db")
    await fs.writeFile(path.join(sources.cacheDir, "blob.txt"), "legacy-cache")
    await fs.writeFile(path.join(sources.userDataDir, "settings.json"), "{\"from\":\"legacy\"}")
    await fs.writeFile(layout.configFile, "{\"providers\":{\"root\":true}}")
    await fs.writeFile(path.join(layout.dataDir, "auth.json"), "root-data")

    const migration = await migrateRootLayout(layout, {
      appId: "com.lfyxhappy.lfcode.dev",
      sources,
    })

    expect(migration.performed).toBe(true)
    expect(await fs.readFile(layout.configFile, "utf8")).toBe("{\"providers\":{\"root\":true}}")
    expect(await fs.readFile(path.join(layout.root, "themes", "ocean.json"), "utf8")).toBe("{\"name\":\"ocean\"}")
    expect(await fs.readFile(path.join(layout.dataDir, "auth.json"), "utf8")).toBe("root-data")
    expect(await fs.readFile(path.join(layout.stateDir, "opencode.db"), "utf8")).toBe("legacy-db")
    expect(await fs.readFile(path.join(layout.cacheDir, "blob.txt"), "utf8")).toBe("legacy-cache")
    expect(await fs.readFile(path.join(layout.userDataDir, "settings.json"), "utf8")).toBe("{\"from\":\"legacy\"}")
    expect(JSON.parse(await fs.readFile(layout.migrationMarker, "utf8"))).toMatchObject({ version: 1 })
  })

  test("skips repeated full migration when the marker already exists", async () => {
    await using tmp = await tmpdir()
    const layout = createRootLayout(path.join(tmp.path, "root"), "com.lfyxhappy.lfcode.dev")
    const sources = {
      configDir: path.join(tmp.path, "legacy-config"),
      dataDir: path.join(tmp.path, "legacy-data"),
      stateDir: path.join(tmp.path, "legacy-state"),
      cacheDir: path.join(tmp.path, "legacy-cache"),
      userDataDir: path.join(tmp.path, "legacy-electron"),
    }

    await fs.mkdir(layout.stateDir, { recursive: true })
    await fs.mkdir(sources.dataDir, { recursive: true })
    await fs.writeFile(path.join(sources.dataDir, "auth.json"), "legacy-data")
    await fs.writeFile(layout.migrationMarker, "{\"version\":1}")

    const migration = await migrateRootLayout(layout, {
      appId: "com.lfyxhappy.lfcode.dev",
      sources,
    })

    expect(migration.performed).toBe(false)
    expect(migration.reason).toBe("marker exists")
    const copied = await fs.stat(path.join(layout.dataDir, "auth.json")).then(
      () => true,
      () => false,
    )
    expect(copied).toBe(false)
  })

  test("creates a root config file when root mode starts without legacy config", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    const migrationSources = {
      configDir: path.join(tmp.path, "missing-config"),
      dataDir: path.join(tmp.path, "missing-data"),
      stateDir: path.join(tmp.path, "missing-state"),
      cacheDir: path.join(tmp.path, "missing-cache"),
      userDataDir: path.join(tmp.path, "missing-electron"),
    }

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources,
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(await fs.readFile(path.join(root, "opencode.jsonc"), "utf8")).toBe(
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
    )
  })
})
