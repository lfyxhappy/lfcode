import type { Tool as AITool } from "ai"
import type { Provider } from "@/provider"

export type NativeWebSearchProvider = "openai" | "anthropic" | "xai"

export function nativeWebSearchProvider(model: Pick<Provider.Model, "api" | "capabilities">): NativeWebSearchProvider | undefined {
  if (!model.capabilities.native_web) return
  if (model.api.npm === "@ai-sdk/openai") return "openai"
  if (model.api.npm === "@ai-sdk/anthropic") return "anthropic"
  if (model.api.npm === "@ai-sdk/xai") return "xai"
}

/**
 * Provider tools retain their provider-specific shape at runtime. They are
 * only cast at the AI SDK boundary so the session tool map can contain both
 * local executable tools and provider-executed search tools.
 */
export async function nativeWebSearchTool(model: Pick<Provider.Model, "api" | "capabilities">): Promise<AITool | undefined> {
  const provider = nativeWebSearchProvider(model)
  if (provider === "openai") {
    const mod = await import("@ai-sdk/openai/internal")
    return mod.webSearchPreview({ searchContextSize: "medium" }) as unknown as AITool
  }
  if (provider === "anthropic") {
    const mod = await import("@ai-sdk/anthropic/internal")
    return mod.anthropicTools.webSearch_20260209({ maxUses: 5 }) as unknown as AITool
  }
  if (provider === "xai") {
    const mod = await import("@ai-sdk/xai")
    return mod.webSearch() as unknown as AITool
  }
}
