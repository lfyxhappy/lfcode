import type { Config } from "@lfcode-ai/sdk/v2/client"

export function isCustomProviderConfig(config: Config, providerID: string) {
  const provider = config.provider?.[providerID]
  if (!provider) return false
  const knownCustomPackages = new Set([
    "@ai-sdk/openai-compatible",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
  ])
  if (provider.npm && !knownCustomPackages.has(provider.npm)) return false
  if (typeof provider.options?.baseURL !== "string" || provider.options.baseURL.length === 0) return false
  if (!provider.models || Object.keys(provider.models).length === 0) return false
  return true
}
