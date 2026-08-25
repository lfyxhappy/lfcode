export const OPENCODE_PROVIDER_ID = "opencode"
export const OPENCODE_PRESET_ID = "opencode"
export const OPENCODE_NAME = "OpenCode Zen"
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1"
export const OPENCODE_MODELS_URL = `${OPENCODE_BASE_URL}/models`
// OpenCode does not currently document a public quota endpoint. Keep this
// explicit so a future endpoint can be enabled without mixing it with Go.
export const OPENCODE_USAGE_URL = `${OPENCODE_BASE_URL}/usage`
export const OPENCODE_ENV = ["OPENCODE_API_KEY"]
export const OPENCODE_CONTEXT_LIMIT = 262_144
export const OPENCODE_OUTPUT_LIMIT = 32_768
