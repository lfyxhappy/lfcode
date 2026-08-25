import { app } from "electron"
import { isUpdaterEnabled } from "./release-lane"

type Channel = "stable"
const raw = import.meta.env.LFCODE_CHANNEL
export const CHANNEL: Channel = raw === "stable" ? raw : "stable"
export const PRE_RELEASE = import.meta.env.LFCODE_PRE_RELEASE === "true"

export const SETTINGS_STORE = "lfcode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
// Fast pre-release packages are directory builds without app-update.yml. They
// must never start the production updater or fall through to its network fallback.
export const UPDATER_ENABLED = isUpdaterEnabled({ isPackaged: app.isPackaged, preRelease: PRE_RELEASE })
