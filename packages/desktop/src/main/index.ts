import { homedir } from "node:os"
import { join } from "node:path"
import { app } from "electron"
import { applyBootstrapState, prepareDesktopBootstrap, resolveDesktopBootstrap } from "./bootstrap"
import { registerRendererScheme } from "./windows"

// on macOS apps run in `/` which can cause issues with ripgrep
try {
  process.chdir(homedir())
} catch {}

process.env.LFCODE_DISABLE_EMBEDDED_WEB_UI = "true"

const APP_NAME = "Lfcode"
const APP_ID = "com.lfyxhappy.lfcode"
const rawChannel = import.meta.env.LFCODE_CHANNEL
const channel = rawChannel === "stable" ? rawChannel : "stable"

async function start() {
  registerRendererScheme()
  const appId = app.isPackaged ? APP_ID : `${APP_ID}.dev`
  const appName = APP_NAME
  const input = {
    appId,
    appName,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    legacyUserDataDir: join(app.getPath("appData"), appId),
    platform: process.platform,
    portableRoot: process.env.LFCODE_PORTABLE_ROOT,
  }
  applyBootstrapState(app, resolveDesktopBootstrap(input))
  await prepareDesktopBootstrap(input)
  await import("./runtime")
}

void start().catch((error) => {
  console.error("desktop bootstrap failed", error)
  app.exit(1)
})
