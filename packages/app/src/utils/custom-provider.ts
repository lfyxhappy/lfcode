import type { Config } from "@lfcode-ai/sdk/v2/client"

export function isCustomProviderConfig(config: Config, providerID: string) {
  const provider = config.provider?.[providerID]
  if (!provider) return false
  if (provider.npm !== "@ai-sdk/openai-compatible") return false
  if (typeof provider.options?.baseURL !== "string" || provider.options.baseURL.length === 0) return false
  if (!provider.models || Object.keys(provider.models).length === 0) return false
  return true
}
