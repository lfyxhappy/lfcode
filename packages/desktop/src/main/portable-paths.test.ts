import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "node:path"
import { createRootLayout, migrateRootLayout, prepareDesktopBootstrap, resolveBootstrapTarget, resolveManagedRootDirectory } from "./bootstrap"

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
  const codegraphCommand = [
    "{env:LFCODE_CODEGRAPH_NODE_EXE}",
    "--liftoff-only",
    "{env:LFCODE_CODEGRAPH_ENTRY}",
    "serve",
    "--mcp",
  ]
  const codegraphConfig = {
    type: "local",
    command: codegraphCommand,
    environment: {
      NODE_PATH: "{env:LFCODE_CODEGRAPH_NODE_PATH}",
    },
    enabled: true,
  }
  const shimCodegraphConfig = {
    type: "local",
    command: codegraphCommand,
    environment: {
      ELECTRON_RUN_AS_NODE: "1",
      CODEGRAPH_INSTALL_DIR: "{env:LFCODE_CACHE_DIR}/codegraph",
    },
    enabled: true,
  }
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
    await fs.writeFile(path.join(sources.configDir, "themes", "ocean.json"), "{\"name\":\"ocean\"}")
    await fs.writeFile(path.join(sources.dataDir, "auth.json"), "legacy-data")
    await fs.writeFile(path.join(sources.stateDir, "opencode.db"), "legacy-db")
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
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      mcp: {
        codegraph: codegraphConfig,
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
  })

  test("writes shim codegraph config when the bundled platform runtime is unavailable", async () => {
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
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      mcp: {
        codegraph: shimCodegraphConfig,
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
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
      $schema: "https://lfcode.ai/config.json",
      providers: {
        test: {
          npm: "@ai-sdk/openai-compatible",
        },
      },
      mcp: {
        codegraph: codegraphConfig,
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
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
      mcp: {
        markitdown: {
          type: "local",
          command: ["C:\\tools\\markitdown-mcp\\.venv\\Scripts\\markitdown-mcp.exe"],
          enabled: true,
        },
        codegraph: {
          ...codegraphConfig,
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
      mcp: {
        codegraph: codegraphConfig,
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
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      mcp: {
        codegraph: codegraphConfig,
        "windows-computer-use": windowsComputerUseConfig,
        playwright: playwrightRemoteConfig,
      },
    })
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
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      mcp: {
        codegraph: codegraphConfig,
        "windows-computer-use": windowsComputerUseConfig,
        playwright: playwrightRemoteConfig,
      },
    })
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
    expect(JSON.parse(await fs.readFile(path.join(root, "lfcode.jsonc"), "utf8"))).toEqual({
      $schema: "https://lfcode.ai/config.json",
      mcp: {
        codegraph: codegraphConfig,
        "windows-computer-use": windowsComputerUseConfig,
        playwright: playwrightRemoteConfig,
      },
    })
  })

  test("migrates an existing installed-root layout into the managed home root", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const installedRoot = path.join(tmp.path, "Program Files", "Lfcode")
    const execPath = path.join(installedRoot, "Lfcode.exe")
    const managedRoot = path.join(home, ".lfcode")

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(installedRoot, "data"), { recursive: true })
    await fs.mkdir(path.join(installedRoot, "state", "electron", "com.lfyxhappy.lfcode.dev"), { recursive: true })
    await fs.writeFile(path.join(installedRoot, "opencode.jsonc"), "{\"providers\":{\"root\":true}}")
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
      mcp: {
        codegraph: codegraphConfig,
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
    expect(
      await fs.stat(path.join(managedRoot, "opencode.jsonc")).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(await fs.readFile(path.join(managedRoot, "data", "auth.json"), "utf8")).toBe("legacy-root-data")
    expect(await fs.readFile(path.join(managedRoot, "state", "electron", "com.lfyxhappy.lfcode.dev", "settings.json"), "utf8")).toBe(
      "{\"from\":\"root\"}",
    )
  })

  test("imports a managed-root opencode.jsonc once and removes the deprecated source", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const managedRoot = path.join(home, ".lfcode")

    await fs.mkdir(path.join(managedRoot, "state"), { recursive: true })
    await fs.writeFile(path.join(managedRoot, "opencode.jsonc"), "{\"providers\":{\"legacy\":true}}")
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
      providers: { legacy: true },
      mcp: {
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
    expect(await fs.stat(path.join(managedRoot, "opencode.jsonc")).then(() => true, () => false)).toBe(false)
  })

  test("does not resurrect a deprecated config after its one-time import completed", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const managedRoot = path.join(home, ".lfcode")

    await fs.mkdir(path.join(managedRoot, "state"), { recursive: true })
    await fs.writeFile(path.join(managedRoot, "opencode.jsonc"), "{\"providers\":{\"legacy\":true}}")
    await fs.writeFile(
      path.join(managedRoot, "state", "migration.json"),
      JSON.stringify({ deprecatedConfigMigrationVersion: 1 }),
    )

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
      $schema: "https://lfcode.ai/config.json",
      mcp: {
        playwright: playwrightRemoteConfig,
        "windows-computer-use": windowsComputerUseConfig,
      },
    })
    expect(await fs.stat(path.join(managedRoot, "opencode.jsonc")).then(() => true, () => false)).toBe(true)
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
      mcp: {
        playwright: playwrightRemoteConfig,
      },
    })
  })
})
