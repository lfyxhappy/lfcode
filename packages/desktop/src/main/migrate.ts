import { app } from "electron"
import log from "electron-log/main.js"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { CHANNEL } from "./constants"
import { mergeLegacyStoreValue, renameLegacyStore } from "./legacy-store"
import { getStore } from "./store"

const TAURI_MIGRATED_KEY = "tauriMigrated"
const LEGACY_ELECTRON_STORE_MIGRATED_KEY = "legacyElectronStoreMigratedV2"

// Resolve the directory where Tauri stored its .dat files for the given app identifier.
// Mirrors Tauri's AppLocalData / AppData resolution per OS.
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

function migrateLegacyStoreFile(sourceFile: string, sourceName: string, targetName: string) {
  let sourceData: Record<string, unknown>
  try {
    sourceData = JSON.parse(readFileSync(sourceFile, "utf-8"))
  } catch (err) {
    log.warn("legacy electron migration: failed to parse", sourceName, err)
    return
  }

  const target = getStore(targetName)
  const migrated: string[] = []
  const merged: string[] = []
  const skipped: string[] = []

  for (const [key, legacyValue] of Object.entries(sourceData)) {
    const next = mergeLegacyStoreValue(key, target.get(key), legacyValue)
    const previous = target.get(key)
    if (previous === next) {
      skipped.push(key)
      continue
    }
    target.set(key, next)
    if (previous === undefined) migrated.push(key)
    else merged.push(key)
  }

  log.log("legacy electron migration: migrated", sourceName, "→", targetName, { merged, migrated, skipped })
}

function migrateLegacyElectronStores() {
  if (getStore().get(LEGACY_ELECTRON_STORE_MIGRATED_KEY)) {
    log.log("legacy electron migration: already done, skipping")
    return
  }

  const dir = app.getPath("userData")
  log.log("legacy electron migration: starting", { dir })

  if (!existsSync(dir)) {
    log.log("legacy electron migration: no userData directory found, nothing to migrate")
    getStore().set(LEGACY_ELECTRON_STORE_MIGRATED_KEY, true)
    return
  }

  for (const filename of readdirSync(dir)) {
    const target = renameLegacyStore(filename)
    if (!target) continue
    migrateLegacyStoreFile(join(dir, filename), filename, target)
  }

  log.log("legacy electron migration: complete")
  getStore().set(LEGACY_ELECTRON_STORE_MIGRATED_KEY, true)
}

// Migrate a single Tauri .dat file into the corresponding electron-store.
// `lfcode.settings.dat` is special: it maps to the `lfcode.settings` store
// (the electron-store name without the `.dat` extension). All other .dat files
// keep their full filename as the electron-store name so they match what the
// renderer already passes via IPC (e.g. `"default.dat"`, `"lfcode.global.dat"`).
function migrateFile(datPath: string, filename: string) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(datPath, "utf-8"))
  } catch (err) {
    log.warn("tauri migration: failed to parse", filename, err)
    return
  }

  // lfcode.settings.dat → the electron settings store ("lfcode.settings").
  // All other .dat files keep their full filename as the store name so they match
  // what the renderer passes via IPC (e.g. "default.dat", "lfcode.global.dat").
  const storeName = filename === "lfcode.settings.dat" ? "lfcode.settings" : filename
  const target = getStore(storeName)
  const migrated: string[] = []
  const skipped: string[] = []

  for (const [key, value] of Object.entries(data)) {
    // Don't overwrite values the user has already set in the Electron app.
    if (target.has(key)) {
      skipped.push(key)
      continue
    }
    target.set(key, value)
    migrated.push(key)
  }

  log.log("tauri migration: migrated", filename, "→", storeName, { migrated, skipped })
}

export function migrate() {
  if (!getStore().get(TAURI_MIGRATED_KEY)) {
    const dir = tauriDir(tauriAppId())
    log.log("tauri migration: starting", { dir })

    if (!existsSync(dir)) {
      log.log("tauri migration: no tauri data directory found, nothing to migrate")
      getStore().set(TAURI_MIGRATED_KEY, true)
    } else {
      for (const filename of readdirSync(dir)) {
        if (!filename.endsWith(".dat")) continue
        migrateFile(join(dir, filename), filename)
      }

      log.log("tauri migration: complete")
      getStore().set(TAURI_MIGRATED_KEY, true)
    }
  }

  migrateLegacyElectronStores()
}
