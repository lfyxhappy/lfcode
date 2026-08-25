import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { app } from "electron"
import { applyBootstrapState, prepareDesktopBootstrap, resolveDesktopBootstrap } from "./bootstrap"
import { registerRendererScheme } from "./windows"

// on macOS apps run in `/` which can cause issues with ripgrep
try {
  process.chdir(homedir())
} catch {}

// The sidecar serves the packaged Web UI to authenticated LAN browsers.
// Electron's renderer has its own entrypoint, so it does not need this asset
// provider disabled during module initialization.
process.env.LFCODE_DISABLE_EMBEDDED_WEB_UI = "false"

const APP_NAME = "Lfcode"
const APP_ID = "com.lfyxhappy.lfcode"
const PRE_APP_NAME = "Lfcode Pre"
const PRE_APP_ID = "com.lfyxhappy.lfcode.pre"
const rawChannel = import.meta.env.LFCODE_CHANNEL
const channel = rawChannel === "stable" ? rawChannel : "stable"

function isPackagedPreRelease() {
  return app.isPackaged && basename(dirname(process.execPath)).toLowerCase() === "lfcodepre"
}

function resolvePackagedPortableRoot() {
  if (process.env.LFCODE_PORTABLE_ROOT) return process.env.LFCODE_PORTABLE_ROOT
  if (!isPackagedPreRelease()) return undefined
  return join(homedir(), ".lfcodepre")
}

async function start() {
  registerRendererScheme()
  const preRelease = isPackagedPreRelease()
  const appId = app.isPackaged ? (preRelease ? PRE_APP_ID : APP_ID) : `${APP_ID}.dev`
  const appName = preRelease ? PRE_APP_NAME : APP_NAME
  const input = {
    appId,
    appName,
    execPath: process.execPath,
    arch: process.arch,
    codegraphMode: "bundled" as const,
    codegraphPath:
      process.env.LFCODE_CODEGRAPH_PATH ??
      join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "codegraph", "codegraph.exe"),
    codegraphNodePath:
      process.env.LFCODE_CODEGRAPH_NODE_PATH ??
      join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "codegraph", "node.exe"),
    codegraphEntryPath:
      process.env.LFCODE_CODEGRAPH_ENTRY_PATH ??
      join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "codegraph", "lib", "dist", "bin", "codegraph.js"),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    legacyUserDataDir: join(app.getPath("appData"), appId),
    legacyUserDataOverride: process.env.LFCODE_USER_DATA_DIR,
    platform: process.platform,
    portableRoot: resolvePackagedPortableRoot(),
  }
  const bootstrap = resolveDesktopBootstrap(input)
  applyBootstrapState(app, bootstrap)
  await prepareDesktopBootstrap(input, bootstrap)
  await import("./runtime")
}

void start().catch((error) => {
  console.error("desktop bootstrap failed", error)
  app.exit(1)
})
