export const OPENCODE_GO_PROVIDER_ID = "opencode-go"
export const OPENCODE_GO_PRESET_ID = "opencode-go"
export const OPENCODE_GO_NAME = "OpenCode Go"
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1"
export const OPENCODE_GO_MODELS_URL = `${OPENCODE_GO_BASE_URL}/models`
export const OPENCODE_GO_USAGE_URL = `${OPENCODE_GO_BASE_URL}/usage`
export const OPENCODE_GO_ENV = ["OPENCODE_GO_API_KEY"]
export const OPENCODE_GO_CONTEXT_LIMIT = 262_144
export const OPENCODE_GO_OUTPUT_LIMIT = 32_768

export const OPENCODE_GO_MODELS = [
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "kimi-k2.5",
  "glm-5.2",
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.1",
  "glm-5",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "qwen3.7-max",
  "qwen3.8-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "mimo-v2-pro",
  "mimo-v2-omni",
  "mimo-v2.5-pro",
  "mimo-v2.5",
  "hy3",
  "hy3-preview",
  "gpt-5.6-luna",
  "grok-4.5",
  "muse-spark-1.2-contributor",
] as const
