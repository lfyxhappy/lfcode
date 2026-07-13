import { app } from "electron"
import log from "electron-log/main.js"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { CHANNEL } from "./constants"
import { getStore } from "./store"

const TAURI_MIGRATED_KEY = "tauriMigrated"

function tauriDir(id: string) {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id)
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id)
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id)
  }
}

const TAURI_APP_IDS: Record<string, string> = {
  stable: "com.lfyxhappy.lfcode",
}

function tauriAppId() {
  return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : "com.lfyxhappy.lfcode.dev"
}

function migrateFile(datPath: string, filename: string) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(datPath, "utf-8"))
  } catch (error) {
    log.warn("tauri migration: failed to parse", filename, error)
    return
  }

  const storeName = filename === "lfcode.settings.dat" ? "lfcode.settings" : filename
  const target = getStore(storeName)
  const migrated: string[] = []
  const skipped: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (target.has(key)) {
      skipped.push(key)
      continue
    }
    target.set(key, value)
    migrated.push(key)
  }
  log.log("tauri migration: migrated", filename, "to", storeName, { migrated, skipped })
}

export function migrate() {
  if (getStore().get(TAURI_MIGRATED_KEY)) return
  const directory = tauriDir(tauriAppId())
  log.log("tauri migration: starting", { directory })
  if (!existsSync(directory)) {
    log.log("tauri migration: no data directory found, nothing to migrate")
    getStore().set(TAURI_MIGRATED_KEY, true)
    return
  }
  for (const filename of readdirSync(directory)) {
    if (!filename.endsWith(".dat")) continue
    migrateFile(join(directory, filename), filename)
  }
  log.log("tauri migration: complete")
  getStore().set(TAURI_MIGRATED_KEY, true)
}
