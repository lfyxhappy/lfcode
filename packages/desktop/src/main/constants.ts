import { app } from "electron"

type Channel = "stable"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "stable" ? raw : "stable"

export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const UPDATER_ENABLED = app.isPackaged
