import { getUserShell, loadShellEnv } from "./shell-env"

const ROOT_ENV_KEYS = [
  "LFCODE_HOME",
  "LFCODE_CONFIG_DIR",
  "LFCODE_DATA_DIR",
  "LFCODE_STATE_DIR",
  "LFCODE_CACHE_DIR",
] as const

export function prepareServerEnv(password: string, url: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? (loadShellEnv(shell) ?? {}) : {}
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...shellEnv,
    LFCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    LFCODE_EXPERIMENTAL_FILEWATCHER: "true",
    LFCODE_CLIENT: "desktop",
    // The packaged catalog is the desktop source of truth. Updating it is an
    // explicit build-time operation through sync:models-catalog.
    LFCODE_DISABLE_MODELS_FETCH: "true",
    LFCODE_SERVER_USERNAME: "lfcode",
    LFCODE_SERVER_PASSWORD: password,
    LFCODE_SERVER_URL: url,
    LFCODE_SERVER_AUTH: `Basic ${Buffer.from(`lfcode:${password}`).toString("base64")}`,
    // LAN browsers must receive the packaged Web UI from this sidecar. The
    // Electron renderer has its own bundled entrypoint, so its historical
    // remote-UI flag must not disable the sidecar's embedded assets.
    LFCODE_DISABLE_EMBEDDED_WEB_UI: "false",
  }
  for (const key of ROOT_ENV_KEYS) {
    const value = process.env[key]
    if (!value) continue
    env[key] = value
  }
  Object.assign(process.env, env)
}
