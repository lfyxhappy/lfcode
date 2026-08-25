import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "node:path"
import {
  createRootLayout,
  migrateRootLayout,
  prepareDesktopBootstrap,
  resolveDesktopBootstrap,
  resolveBootstrapTarget,
  resolveCodegraphBootstrap,
  resolveManagedRootDirectory,
} from "./bootstrap"

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-desktop-bootstrap-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe("desktop bootstrap paths", () => {
  const playwrightLegacyCommand = ["cmd", "/c", "npx", "-y", "@playwright/mcp@0.0.73", "--browser", "chrome"]
  const playwrightRemoteConfig = {
    type: "remote",
    url: "{env:LFCODE_SERVER_URL}/global/mcp/playwright",
    headers: {
      authorization: "{env:LFCODE_SERVER_AUTH}",
    },
    enabled: true,
  }
  const windowsComputerUseCommand = ["{env:LFCODE_BUNDLED_NODE}", "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js"]
  const windowsComputerUseConfig = {
    type: "local",
    command: windowsComputerUseCommand,
    environment: {
      ELECTRON_RUN_AS_NODE: "1",
    },
    enabled: true,
  }
  const defaultRootConfig = {
    $schema: "https://lfcode.ai/config.json",
    lsp: true,
    mcp: {
      playwright: playwrightRemoteConfig,
      "windows-computer-use": windowsComputerUseConfig,
    },
  }
  const legacyWindowsComputerUseCommand = [
    "cmd",
    "/c",
    "node",
    "\"%LFCODE_CONFIG_DIR%\\resources\\mcp\\windows-computer-use-mcp\\bundle\\index.js\"",
  ]
  const previousWindowsComputerUseCommand = ["node", "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js"]
  const brokenWindowsComputerUseCommand = [
    "cmd",
    "/c",
    "node",
    "\"{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js\"",
  ]

  test("resolves the managed packaged root under the user home directory", () => {
    expect(
      resolveManagedRootDirectory({
        homeDir: "C:\\Users\\liangfeng",
        isPackaged: true,
        platform: "win32",
      }),
    ).toBe("C:\\Users\\liangfeng\\.lfcode")
  })

  test("maps a Windows program root to root-level config and data directories", () => {
    expect(createRootLayout("C:\\Lfcode\\win-unpacked", "com.lfyxhappy.lfcode.dev")).toEqual({
      root: "C:\\Lfcode\\win-unpacked",
      configDir: "C:\\Lfcode\\win-unpacked",
      configFile: "C:\\Lfcode\\win-unpacked\\lfcode.jsonc",
      dataDir: "C:\\Lfcode\\win-unpacked\\data",
      stateDir: "C:\\Lfcode\\win-unpacked\\state",
      cacheDir: "C:\\Lfcode\\win-unpacked\\cache",
      userDataDir: "C:\\Lfcode\\win-unpacked\\state\\electron\\com.lfyxhappy.lfcode.dev",
      migrationMarker: "C:\\Lfcode\\win-unpacked\\state\\migration.json",
    })
  })

  test("sets LFCODE_HOME to the root layout so profile-scoped resources stay isolated", () => {
    const state = resolveBootstrapTarget({
      appId: "com.lfyxhappy.lfcode.pre",
      appName: "Lfcode Pre",
      legacyUserDataDir: "C:\\Users\\liangfeng\\AppData\\Roaming\\com.lfyxhappy.lfcode.pre",
      root: "C:\\Users\\liangfeng\\.lfcodepre",
      rootKind: "portable",
      rootWritable: true,
    })

    expect(state.mode).toBe("root")
    expect(state.env).toMatchObject({
      LFCODE_HOME: "C:\\Users\\liangfeng\\.lfcodepre",
      LFCODE_CONFIG_DIR: "C:\\Users\\liangfeng\\.lfcodepre",
      LFCODE_DATA_DIR: "C:\\Users\\liangfeng\\.lfcodepre\\data",
    })
  })

  test("prepares a supplied bootstrap state without resolving the input again", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    const input = {
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      codegraphMode: "shim" as const,
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    }
    const state = resolveDesktopBootstrap(input)

    const prepared = await prepareDesktopBootstrap(
      {
        ...input,
        platform: "linux",
        portableRoot: undefined,
      },
      state,
    )

    expect(prepared.mode).toBe("root")
    expect(await fs.stat(path.join(root, "data"))).toBeDefined()
  })

  test("falls back to legacy mode when the managed desktop root is not writable", () => {
    const state = resolveBootstrapTarget({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      legacyUserDataDir: "C:\\Users\\liangfeng\\AppData\\Roaming\\com.lfyxhappy.lfcode.dev",
      root: "C:\\Users\\liangfeng\\.lfcode",
      rootKind: "managed",
      rootWritable: false,
    })

    expect(state.mode).toBe("legacy")
    expect(state.userDataDir).toBe("C:\\Users\\liangfeng\\AppData\\Roaming\\com.lfyxhappy.lfcode.dev")
    expect(state.fallbackReason).toBe("desktop root is not writable: C:\\Users\\liangfeng\\.lfcode")
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
    await fs.writeFile(path.join(sources.configDir, "lfcode.json"), "{\"providers\":{\"legacy\":true}}")
    await fs.writeFile(path.join(sources.configDir, "unrecognized-config.jsonc"), "{\"providers\":{\"ignored\":true}}")
    await fs.writeFile(path.join(sources.configDir, "themes", "ocean.json"), "{\"name\":\"ocean\"}")
    await fs.writeFile(path.join(sources.dataDir, "auth.json"), "legacy-data")
    await fs.writeFile(path.join(sources.stateDir, "session-cache.db"), "legacy-db")
    await fs.writeFile(path.join(sources.cacheDir, "blob.txt"), "legacy-cache")
    await fs.writeFile(path.join(sources.userDataDir, "settings.json"), "{\"from\":\"legacy\"}")
    await fs.writeFile(layout.configFile, "{\"providers\":{\"root\":true}}")
    await fs.writeFile(path.join(layout.dataDir, "auth.json"), "root-data")

    const migration = await migrateRootLayout(layout, {
      appId: "com.lfyxhappy.lfcode.dev",
      sources: [sources],
    })

    expect(migration.performed).toBe(true)
    expect(await fs.readFile(layout.configFile, "utf8")).toBe("{\"providers\":{\"root\":true}}")
    expect(await fs.readFile(path.join(layout.root, "themes", "ocean.json"), "utf8")).toBe("{\"name\":\"ocean\"}")
    expect(await fs.stat(path.join(layout.root, "unrecognized-config.jsonc")).then(() => true, () => false)).toBe(false)
    expect(await fs.readFile(path.join(layout.dataDir, "auth.json"), "utf8")).toBe("root-data")
    expect(await fs.readFile(path.join(layout.stateDir, "session-cache.db"), "utf8")).toBe("legacy-db")
    expect(await fs.readFile(path.join(layout.cacheDir, "blob.txt"), "utf8")).toBe("legacy-cache")
    expect(await fs.readFile(path.join(layout.userDataDir, "settings.json"), "utf8")).toBe("{\"from\":\"legacy\"}")
    expect(JSON.parse(await fs.readFile(layout.migrationMarker, "utf8"))).toMatchObject({
      copiedEntries: expect.any(Number),
      preservedEntries: expect.any(Number),
      scope: "lfcode-root-layout",
      version: 1,
    })
    expect(JSON.parse(await fs.readFile(layout.migrationMarker, "utf8")).copied).toBeUndefined()
    expect(JSON.parse(await fs.readFile(layout.migrationMarker, "utf8")).preserved).toBeUndefined()
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
      sources: [sources],
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
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [migrationSources],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual(defaultRootConfig)
  })

  test("recognizes an existing Windows x64 CodeGraph runtime without trusting other platforms", async () => {
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, "codegraph.exe")
    await fs.writeFile(executable, "MZ")

    expect(
      resolveCodegraphBootstrap({
        appId: "com.lfyxhappy.lfcode",
        appName: "Lfcode",
        arch: "x64",
        codegraphMode: "bundled",
        codegraphPath: executable,
        execPath: path.join(tmp.path, "Lfcode.exe"),
        isPackaged: true,
        legacyUserDataDir: path.join(tmp.path, "legacy"),
        platform: "win32",
      }),
    ).toEqual({ kind: "bundled", entry: executable, platformDir: tmp.path })
    expect(
      resolveCodegraphBootstrap({
        appId: "com.lfyxhappy.lfcode",
        appName: "Lfcode",
        arch: "arm64",
        codegraphMode: "bundled",
        codegraphPath: executable,
        execPath: path.join(tmp.path, "Lfcode.exe"),
        isPackaged: true,
        legacyUserDataDir: path.join(tmp.path, "legacy"),
        platform: "win32",
      }),
    ).toEqual({ kind: "external" })
  })

  test("does not treat a CodeGraph directory as a bundled executable", async () => {
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, "codegraph.exe")
    await fs.mkdir(executable, { recursive: true })

    expect(
      resolveCodegraphBootstrap({
        appId: "com.lfyxhappy.lfcode",
        appName: "Lfcode",
        arch: "x64",
        codegraphMode: "bundled",
        codegraphPath: executable,
        execPath: path.join(tmp.path, "Lfcode.exe"),
        isPackaged: true,
        legacyUserDataDir: path.join(tmp.path, "legacy"),
        platform: "win32",
      }),
    ).toEqual({ kind: "external" })
  })

  test("recognizes the official CodeGraph Node launcher layout", async () => {
    await using tmp = await tmpdir()
    const nodePath = path.join(tmp.path, "node.exe")
    const entry = path.join(tmp.path, "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])

    expect(
      resolveCodegraphBootstrap({
        appId: "com.lfyxhappy.lfcode",
        appName: "Lfcode",
        arch: "x64",
        codegraphMode: "bundled",
        codegraphNodePath: nodePath,
        codegraphEntryPath: entry,
        execPath: path.join(tmp.path, "Lfcode.exe"),
        isPackaged: true,
        legacyUserDataDir: path.join(tmp.path, "legacy"),
        platform: "win32",
      }),
    ).toEqual({ kind: "bundled", entry, nodePath, platformDir: tmp.path })
  })

  test("does not write codegraph MCP config when the bundled platform runtime is unavailable", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      codegraphMode: "shim",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(state.codegraph).toEqual({ kind: "external" })
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual(defaultRootConfig)
  })

  test("writes the managed CodeGraph command only for an available bundled runtime", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    const executable = path.join(tmp.path, "resources", "codegraph", "codegraph.exe")
    await fs.mkdir(path.dirname(executable), { recursive: true })
    await fs.writeFile(executable, "MZ")

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      arch: "x64",
      codegraphMode: "bundled",
      codegraphPath: executable,
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    })

    expect(state.codegraph).toEqual({ kind: "bundled", entry: executable, platformDir: path.dirname(executable) })
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8")).mcp.codegraph).toEqual({
      type: "local",
      command: ["{env:LFCODE_CODEGRAPH_EXE}", "serve", "--mcp"],
      enabled: true,
    })
    expect(JSON.parse(await fs.readFile(path.join(root, "state", "migration.json"), "utf8"))).toMatchObject({
      codegraphMcpVersion: 2,
    })
  })

  test("writes the managed Node launcher command for the official bundled runtime", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    const nodePath = path.join(tmp.path, "resources", "codegraph", "node.exe")
    const entry = path.join(tmp.path, "resources", "codegraph", "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await fs.mkdir(root, { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      arch: "x64",
      codegraphMode: "bundled",
      codegraphNodePath: nodePath,
      codegraphEntryPath: entry,
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    })

    expect(state.codegraph).toEqual({ kind: "bundled", entry, nodePath, platformDir: path.dirname(nodePath) })
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8")).mcp.codegraph).toEqual({
      type: "local",
      command: ["{env:LFCODE_CODEGRAPH_NODE_EXE}", "{env:LFCODE_CODEGRAPH_ENTRY}", "serve", "--mcp"],
      enabled: true,
    })
  })

  test("migrates the prior managed executable command to the Node launcher", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    const nodePath = path.join(tmp.path, "resources", "codegraph", "node.exe")
    const entry = path.join(tmp.path, "resources", "codegraph", "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await fs.mkdir(root, { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify({ mcp: { codegraph: { type: "local", command: ["{env:LFCODE_CODEGRAPH_EXE}", "serve", "--mcp"], enabled: true } } }),
    )

    await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      arch: "x64",
      codegraphMode: "bundled",
      codegraphNodePath: nodePath,
      codegraphEntryPath: entry,
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    })

    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8")).mcp.codegraph.command).toEqual([
      "{env:LFCODE_CODEGRAPH_NODE_EXE}",
      "{env:LFCODE_CODEGRAPH_ENTRY}",
      "serve",
      "--mcp",
    ])
  })

  test("preserves an enabled custom CodeGraph command when the Node launcher is bundled", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    const nodePath = path.join(tmp.path, "resources", "codegraph", "node.exe")
    const entry = path.join(tmp.path, "resources", "codegraph", "lib", "dist", "bin", "codegraph.js")
    const custom = ["C:\\tools\\custom-codegraph.cmd", "serve", "--mcp"]
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await fs.mkdir(root, { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])
    await fs.writeFile(path.join(root, "lfcode.jsonc"), JSON.stringify({ mcp: { codegraph: { type: "local", command: custom, enabled: true } } }))

    await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      arch: "x64",
      codegraphMode: "bundled",
      codegraphNodePath: nodePath,
      codegraphEntryPath: entry,
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    })

    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8")).mcp.codegraph.command).toEqual(custom)
  })

  test("preserves an explicitly disabled CodeGraph configuration", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    const executable = path.join(tmp.path, "resources", "codegraph", "codegraph.exe")
    await fs.mkdir(path.dirname(executable), { recursive: true })
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(executable, "MZ")
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify({ mcp: { codegraph: { type: "local", command: ["custom-codegraph", "serve", "--mcp"], enabled: false } } }),
    )

    await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      arch: "x64",
      codegraphMode: "bundled",
      codegraphPath: executable,
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      platform: "win32",
      portableRoot: root,
    })

    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8")).mcp.codegraph).toEqual({
      type: "local",
      command: ["custom-codegraph", "serve", "--mcp"],
      enabled: false,
    })
  })

  test("adds bundled MCP defaults to a migrated legacy config without mcp entries", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify(
        {
          $schema: "https://lfcode.ai/config.json",
          providers: {
            test: {
              npm: "@ai-sdk/openai-compatible",
            },
          },
        },
        null,
        2,
      ),
    )

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      ...defaultRootConfig,
      providers: {
        test: {
          npm: "@ai-sdk/openai-compatible",
        },
      },
    })
    expect(JSON.parse(await fs.readFile(path.join(root, "state", "migration.json"), "utf8"))).toMatchObject({
      bundledMcpVersion: 3,
    })
  })

  test("upgrades the shipped mcp config without touching other MCPs", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify(
        {
          $schema: "https://lfcode.ai/config.json",
          mcp: {
            markitdown: {
              type: "local",
              command: ["C:\\tools\\markitdown-mcp\\.venv\\Scripts\\markitdown-mcp.exe"],
              enabled: true,
            },
            codegraph: {
              type: "local",
              command: ["codegraph", "serve", "--mcp"],
              enabled: true,
            },
            playwright: {
              type: "local",
              command: playwrightLegacyCommand,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      lsp: true,
      mcp: {
        markitdown: {
          type: "local",
          command: ["C:\\tools\\markitdown-mcp\\.venv\\Scripts\\markitdown-mcp.exe"],
          enabled: true,
        },
        codegraph: {
          type: "local",
          command: ["codegraph", "serve", "--mcp"],
          enabled: true,
        },
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
  })

  test("leaves a customized playwright config unchanged while adding missing bundled MCP defaults", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    const customPlaywright = {
      type: "local",
      command: playwrightLegacyCommand,
      enabled: true,
      timeout: 12345,
      environment: { DEBUG: "1" },
    }
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify(
        {
          $schema: "https://lfcode.ai/config.json",
          mcp: {
            playwright: customPlaywright,
          },
        },
        null,
        2,
      ),
    )

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      lsp: true,
      mcp: {
        playwright: customPlaywright,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
  })

  test("upgrades a legacy windows-computer-use config to the bundled node launcher", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify(
        {
          $schema: "https://lfcode.ai/config.json",
          mcp: {
            "windows-computer-use": {
              type: "local",
              command: legacyWindowsComputerUseCommand,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual(defaultRootConfig)
  })

  test("upgrades the previous shipped windows-computer-use config to the bundled node launcher", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify(
        {
          $schema: "https://lfcode.ai/config.json",
          mcp: {
            "windows-computer-use": {
              type: "local",
              command: previousWindowsComputerUseCommand,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual(defaultRootConfig)
  })

  test("upgrades the broken cmd-wrapped windows-computer-use config", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "root")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "lfcode.jsonc"),
      JSON.stringify(
        {
          $schema: "https://lfcode.ai/config.json",
          mcp: {
            "windows-computer-use": {
              type: "local",
              command: brokenWindowsComputerUseCommand,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(root, "Lfcode Dev.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: root,
    })

    expect(state.mode).toBe("root")
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual(defaultRootConfig)
  })

  test("migrates an existing Lfcode installed-root layout into the managed home root", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const installedRoot = path.join(tmp.path, "Program Files", "Lfcode")
    const execPath = path.join(installedRoot, "Lfcode.exe")
    const managedRoot = path.join(home, ".lfcode")

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(installedRoot, "data"), { recursive: true })
    await fs.mkdir(path.join(installedRoot, "state", "electron", "com.lfyxhappy.lfcode.dev"), { recursive: true })
    await fs.writeFile(path.join(installedRoot, "lfcode.jsonc"), "{\"providers\":{\"root\":true}}")
    await fs.writeFile(path.join(installedRoot, "data", "auth.json"), "legacy-root-data")
    await fs.writeFile(path.join(installedRoot, "state", "electron", "com.lfyxhappy.lfcode.dev", "settings.json"), "{\"from\":\"root\"}")

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath,
      homeDir: home,
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
    })

    expect(state.mode).toBe("root")
    expect(state.rootKind).toBe("managed")
    expect(state.layout?.root).toBe(managedRoot)
    expect(JSON.parse(await fs.readFile(path.join(managedRoot, "lfcode.jsonc"), "utf8"))).toEqual({
      providers: { root: true },
      lsp: true,
      mcp: defaultRootConfig.mcp,
    })
    expect(await fs.readFile(path.join(managedRoot, "data", "auth.json"), "utf8")).toBe("legacy-root-data")
    expect(await fs.readFile(path.join(managedRoot, "state", "electron", "com.lfyxhappy.lfcode.dev", "settings.json"), "utf8")).toBe(
      "{\"from\":\"root\"}",
    )
  })

  test("ignores unrecognized root config files", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const managedRoot = path.join(home, ".lfcode")

    await fs.mkdir(path.join(managedRoot, "state"), { recursive: true })
    await fs.writeFile(path.join(managedRoot, "unrecognized-config.jsonc"), "{\"providers\":{\"ignored\":true}}")
    await fs.writeFile(path.join(managedRoot, "state", "migration.json"), "{\"version\":1}")

    const state = await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(tmp.path, "Program Files", "Lfcode", "Lfcode.exe"),
      homeDir: home,
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
    })

    expect(state.mode).toBe("root")
    expect(state.rootKind).toBe("managed")
    expect(state.layout?.root).toBe(managedRoot)
    expect(JSON.parse(await fs.readFile(path.join(managedRoot, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      lsp: true,
      mcp: {
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
    expect(await fs.readFile(path.join(managedRoot, "unrecognized-config.jsonc"), "utf8")).toBe(
      "{\"providers\":{\"ignored\":true}}",
    )
  })

  test("compacts historical migration paths into Lfcode-only audit counts", async () => {
    await using tmp = await tmpdir()
    const layout = createRootLayout(path.join(tmp.path, "root"), "com.lfyxhappy.lfcode.dev")

    await fs.mkdir(layout.stateDir, { recursive: true })
    await fs.writeFile(
      layout.migrationMarker,
      JSON.stringify({
        copied: ["C:\\previous-root\\old-config.jsonc"],
        deprecatedConfigMigrationVersion: 1,
        preserved: ["C:\\previous-root\\settings.json"],
        version: 1,
      }),
    )

    await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(tmp.path, "Program Files", "Lfcode", "Lfcode.exe"),
      homeDir: path.join(tmp.path, "home"),
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
      portableRoot: layout.root,
    })

    const marker = JSON.parse(await fs.readFile(layout.migrationMarker, "utf8"))
    expect(marker).toMatchObject({
      copiedEntries: 1,
      preservedEntries: 1,
      scope: "lfcode-root-layout",
      version: 1,
    })
    expect(marker.copied).toBeUndefined()
    expect(marker.preserved).toBeUndefined()
    expect(marker.deprecatedConfigMigrationVersion).toBeUndefined()
  })

  test("normalizes stale loopback playwright remote config back to env placeholders", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const managedRoot = path.join(home, ".lfcode")

    await fs.mkdir(path.join(managedRoot, "state"), { recursive: true })
    await fs.writeFile(
      path.join(managedRoot, "lfcode.jsonc"),
      JSON.stringify(
        {
          mcp: {
            playwright: {
              type: "remote",
              url: "http://127.0.0.1:8131/global/mcp/playwright",
              headers: {
                authorization: "Basic stale-token",
              },
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )
    await fs.writeFile(path.join(managedRoot, "state", "migration.json"), "{\"version\":1,\"bundledMcpVersion\":3}")

    await prepareDesktopBootstrap({
      appId: "com.lfyxhappy.lfcode.dev",
      appName: "Lfcode Dev",
      execPath: path.join(tmp.path, "Program Files", "Lfcode", "Lfcode.exe"),
      homeDir: home,
      isPackaged: true,
      legacyUserDataDir: path.join(tmp.path, "legacy-user-data"),
      migrationSources: [],
      codegraphMode: "bundled",
      platform: "win32",
    })

    expect(JSON.parse(await fs.readFile(path.join(managedRoot, "lfcode.jsonc"), "utf8"))).toEqual({
      lsp: true,
      mcp: {
        playwright: playwrightRemoteConfig,
      },
    })
  })
})
