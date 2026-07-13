import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const LFCODE_EXPERIMENTAL = truthy("LFCODE_EXPERIMENTAL")

const LFCODE_DISABLE_CLAUDE_CODE_ENV = truthy("LFCODE_DISABLE_CLAUDE_CODE")
const LFCODE_DISABLE_CLAUDE_CODE = LFCODE_DISABLE_CLAUDE_CODE_ENV

const LFCODE_DISABLE_EXTERNAL_SKILLS = truthy("LFCODE_DISABLE_EXTERNAL_SKILLS")
const LFCODE_DISABLE_CLAUDE_CODE_SKILLS =
  LFCODE_DISABLE_EXTERNAL_SKILLS || LFCODE_DISABLE_CLAUDE_CODE || truthy("LFCODE_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["LFCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  LFCODE_AUTO_SHARE: truthy("LFCODE_AUTO_SHARE"),
  LFCODE_AUTO_HEAP_SNAPSHOT: truthy("LFCODE_AUTO_HEAP_SNAPSHOT"),
  LFCODE_GIT_BASH_PATH: process.env["LFCODE_GIT_BASH_PATH"],
  LFCODE_CONFIG: process.env["LFCODE_CONFIG"],
  LFCODE_CONFIG_CONTENT: process.env["LFCODE_CONFIG_CONTENT"],

  LFCODE_DISABLE_AUTOUPDATE: truthy("LFCODE_DISABLE_AUTOUPDATE"),

  // Defaults to true (analytics enabled). Set LFCODE_ENABLE_ANALYSIS=false
  // to opt out of POSTing model_call/tool_call/agent_request metrics.
  LFCODE_ENABLE_ANALYSIS: !falsy("LFCODE_ENABLE_ANALYSIS"),
  LFCODE_ALWAYS_NOTIFY_UPDATE: truthy("LFCODE_ALWAYS_NOTIFY_UPDATE"),
  LFCODE_DISABLE_PRUNE: truthy("LFCODE_DISABLE_PRUNE"),
  LFCODE_DISABLE_TERMINAL_TITLE: truthy("LFCODE_DISABLE_TERMINAL_TITLE"),
  LFCODE_SHOW_TTFD: truthy("LFCODE_SHOW_TTFD"),
  LFCODE_PERMISSION: process.env["LFCODE_PERMISSION"],
  LFCODE_DISABLE_DEFAULT_PLUGINS: truthy("LFCODE_DISABLE_DEFAULT_PLUGINS"),
  LFCODE_DISABLE_LSP_DOWNLOAD: truthy("LFCODE_DISABLE_LSP_DOWNLOAD"),
  LFCODE_ENABLE_EXPERIMENTAL_MODELS: truthy("LFCODE_ENABLE_EXPERIMENTAL_MODELS"),
  LFCODE_DISABLE_AUTOCOMPACT: truthy("LFCODE_DISABLE_AUTOCOMPACT"),
  LFCODE_DISABLE_MODELS_FETCH: truthy("LFCODE_DISABLE_MODELS_FETCH"),
  LFCODE_DISABLE_MOUSE: truthy("LFCODE_DISABLE_MOUSE"),
  LFCODE_OUTPUT_LENGTH_CONTINUATION_LIMIT: number("LFCODE_OUTPUT_LENGTH_CONTINUATION_LIMIT") ?? 3,
  LFCODE_INVALID_OUTPUT_CONTINUATION_LIMIT: number("LFCODE_INVALID_OUTPUT_CONTINUATION_LIMIT") ?? 2,

  // Caps applied to image attachments before a prompt is sent. Both default to
  // undefined (no limit). LFCODE_MAX_PROMPT_IMAGES bounds how many images may
  // be sent per request (oldest excess images are dropped); LFCODE_MAX_PROMPT_IMAGE_SIZE
  // bounds the decoded byte size of a single image. Values must be positive integers.
  LFCODE_MAX_PROMPT_IMAGES: number("LFCODE_MAX_PROMPT_IMAGES"),
  LFCODE_MAX_PROMPT_IMAGE_SIZE: number("LFCODE_MAX_PROMPT_IMAGE_SIZE"),
  LFCODE_DISABLE_PROVIDER_ENV: truthy("LFCODE_DISABLE_PROVIDER_ENV"),
  LFCODE_DISABLE_CLAUDE_CODE,
  get LFCODE_DISABLE_CLAUDE_CODE_MCP() {
    return LFCODE_DISABLE_CLAUDE_CODE_ENV || truthy("LFCODE_DISABLE_CLAUDE_CODE_MCP")
  },
  LFCODE_DISABLE_CLAUDE_CODE_PROMPT: LFCODE_DISABLE_CLAUDE_CODE || truthy("LFCODE_DISABLE_CLAUDE_CODE_PROMPT"),
  // Defaults to false (enabled): markdown commands under ~/.claude/commands and
  // {project}/.claude/commands load as slash commands. Set
  // LFCODE_DISABLE_CLAUDE_CODE_COMMANDS=true to disable.
  LFCODE_DISABLE_CLAUDE_CODE_COMMANDS: truthy("LFCODE_DISABLE_CLAUDE_CODE_COMMANDS"),
  LFCODE_DISABLE_CLAUDE_CODE_SKILLS,
  LFCODE_DISABLE_EXTERNAL_SKILLS,
  LFCODE_DISABLE_CODEX_SKILLS: LFCODE_DISABLE_EXTERNAL_SKILLS || truthy("LFCODE_DISABLE_CODEX_SKILLS"),
  get LFCODE_DISABLE_LFCODE_SKILLS() {
    return LFCODE_DISABLE_EXTERNAL_SKILLS || truthy("LFCODE_DISABLE_LFCODE_SKILLS")
  },
  LFCODE_FAKE_VCS: process.env["LFCODE_FAKE_VCS"],

  // When enabled, skips all git subprocess calls during project discovery
  // (which git, rev-parse --git-common-dir, rev-parse --show-toplevel) and
  // branch detection. The project is treated as a non-git directory rooted at
  // the working directory. Use to avoid touching git in restricted/sandboxed
  // environments or where git startup probing is undesirable.
  LFCODE_DISABLE_GIT: truthy("LFCODE_DISABLE_GIT"),
  LFCODE_SERVER_PASSWORD: process.env["LFCODE_SERVER_PASSWORD"],
  LFCODE_SERVER_USERNAME: process.env["LFCODE_SERVER_USERNAME"],
  LFCODE_ENABLE_QUESTION_TOOL: truthy("LFCODE_ENABLE_QUESTION_TOOL"),

  // Experimental
  LFCODE_EXPERIMENTAL,
  LFCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("LFCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  LFCODE_EXPERIMENTAL_ICON_DISCOVERY: LFCODE_EXPERIMENTAL || truthy("LFCODE_EXPERIMENTAL_ICON_DISCOVERY"),
  LFCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("LFCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  LFCODE_ENABLE_EXA: truthy("LFCODE_ENABLE_EXA") || LFCODE_EXPERIMENTAL || truthy("LFCODE_EXPERIMENTAL_EXA"),
  LFCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("LFCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  LFCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("LFCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  LFCODE_EXPERIMENTAL_OXFMT: LFCODE_EXPERIMENTAL || truthy("LFCODE_EXPERIMENTAL_OXFMT"),
  LFCODE_EXPERIMENTAL_LSP_TY: truthy("LFCODE_EXPERIMENTAL_LSP_TY"),
  LFCODE_EXPERIMENTAL_LSP_TOOL: LFCODE_EXPERIMENTAL || truthy("LFCODE_EXPERIMENTAL_LSP_TOOL"),
  LFCODE_EXPERIMENTAL_WORKFLOW_TOOL: LFCODE_EXPERIMENTAL || truthy("LFCODE_EXPERIMENTAL_WORKFLOW_TOOL"),
  LFCODE_EXPERIMENTAL_MARKDOWN: !falsy("LFCODE_EXPERIMENTAL_MARKDOWN"),
  LFCODE_MODELS_URL: process.env["LFCODE_MODELS_URL"],
  LFCODE_MODELS_PATH: process.env["LFCODE_MODELS_PATH"],
  LFCODE_DISABLE_EMBEDDED_WEB_UI: truthy("LFCODE_DISABLE_EMBEDDED_WEB_UI"),
  LFCODE_DB: process.env["LFCODE_DB"],

  // Defaults to true — all channels share a single lfcode.db. The per-channel
  // DB isolation (lfcode-{channel}.db) is unnecessary for lfcode since we
  // don't ship multiple release channels yet. Use LFCODE_HOME to isolate dev
  // environments instead. Set LFCODE_DISABLE_CHANNEL_DB=false to restore
  // per-channel isolation.
  LFCODE_DISABLE_CHANNEL_DB: !falsy("LFCODE_DISABLE_CHANNEL_DB"),
  LFCODE_SKIP_MIGRATIONS: truthy("LFCODE_SKIP_MIGRATIONS"),
  LFCODE_STRICT_CONFIG_DEPS: truthy("LFCODE_STRICT_CONFIG_DEPS"),

  LFCODE_WORKSPACE_ID: process.env["LFCODE_WORKSPACE_ID"],
  LFCODE_EXPERIMENTAL_HTTPAPI: truthy("LFCODE_EXPERIMENTAL_HTTPAPI"),
  LFCODE_EXPERIMENTAL_WORKSPACES: LFCODE_EXPERIMENTAL || truthy("LFCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get LFCODE_DISABLE_COMPOSE_SKILLS() {
    return truthy("LFCODE_DISABLE_COMPOSE_SKILLS")
  },
  get LFCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("LFCODE_DISABLE_PROJECT_CONFIG")
  },
  get LFCODE_TUI_CONFIG() {
    return process.env["LFCODE_TUI_CONFIG"]
  },
  get LFCODE_CONFIG_DIR() {
    return process.env["LFCODE_CONFIG_DIR"]
  },
  get LFCODE_HOME() {
    return process.env["LFCODE_HOME"]
  },
  get LFCODE_PURE() {
    return truthy("LFCODE_PURE")
  },
  get LFCODE_PLUGIN_META_FILE() {
    return process.env["LFCODE_PLUGIN_META_FILE"]
  },
  get LFCODE_CLIENT() {
    return process.env["LFCODE_CLIENT"] ?? "cli"
  },
}
