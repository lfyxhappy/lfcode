import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["LFCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["LFCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("LFCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  LFCODE_AUTO_HEAP_SNAPSHOT: truthy("LFCODE_AUTO_HEAP_SNAPSHOT"),
  LFCODE_GIT_BASH_PATH: process.env["LFCODE_GIT_BASH_PATH"],
  LFCODE_CONFIG: process.env["LFCODE_CONFIG"],
  LFCODE_CONFIG_CONTENT: process.env["LFCODE_CONFIG_CONTENT"],
  LFCODE_DISABLE_AUTOUPDATE: truthy("LFCODE_DISABLE_AUTOUPDATE"),
  LFCODE_ALWAYS_NOTIFY_UPDATE: truthy("LFCODE_ALWAYS_NOTIFY_UPDATE"),
  LFCODE_DISABLE_PRUNE: truthy("LFCODE_DISABLE_PRUNE"),
  LFCODE_DISABLE_TERMINAL_TITLE: truthy("LFCODE_DISABLE_TERMINAL_TITLE"),
  LFCODE_SHOW_TTFD: truthy("LFCODE_SHOW_TTFD"),
  LFCODE_DISABLE_AUTOCOMPACT: truthy("LFCODE_DISABLE_AUTOCOMPACT"),
  LFCODE_DISABLE_MODELS_FETCH: truthy("LFCODE_DISABLE_MODELS_FETCH"),
  LFCODE_DISABLE_MOUSE: truthy("LFCODE_DISABLE_MOUSE"),
  LFCODE_FAKE_VCS: process.env["LFCODE_FAKE_VCS"],
  LFCODE_SERVER_PASSWORD: process.env["LFCODE_SERVER_PASSWORD"],
  LFCODE_SERVER_USERNAME: process.env["LFCODE_SERVER_USERNAME"],
  LFCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("LFCODE_DISABLE_FFF"),

  // Experimental
  LFCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("LFCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  LFCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("LFCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  LFCODE_MODELS_URL: process.env["LFCODE_MODELS_URL"],
  LFCODE_MODELS_PATH: process.env["LFCODE_MODELS_PATH"],
  LFCODE_DB: process.env["LFCODE_DB"],

  LFCODE_WORKSPACE_ID: process.env["LFCODE_WORKSPACE_ID"],
  LFCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("LFCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get LFCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("LFCODE_DISABLE_PROJECT_CONFIG")
  },
  get LFCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("LFCODE_EXPERIMENTAL_REFERENCES")
  },
  get LFCODE_TUI_CONFIG() {
    return process.env["LFCODE_TUI_CONFIG"]
  },
  get LFCODE_CONFIG_DIR() {
    return process.env["LFCODE_CONFIG_DIR"]
  },
  get LFCODE_PURE() {
    return truthy("LFCODE_PURE")
  },
  get LFCODE_PERMISSION() {
    return process.env["LFCODE_PERMISSION"]
  },
  get LFCODE_PLUGIN_META_FILE() {
    return process.env["LFCODE_PLUGIN_META_FILE"]
  },
  get LFCODE_CLIENT() {
    return process.env["LFCODE_CLIENT"] ?? "cli"
  },
}
