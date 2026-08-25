import z from "zod"

const ProviderCatalog = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      models: z.record(
        z.string(),
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
    }),
  ),
  default: z.record(z.string(), z.string()),
})

const AgentCatalog = z.array(
  z.object({
    name: z.string(),
    mode: z.enum(["subagent", "primary", "all"]),
    hidden: z.boolean().optional(),
  }),
)

export type LanModelOption = {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  modelRef: string
  default: boolean
}

export type LanAgentOption = {
  name: string
}

/**
 * Project the sidecar's provider response into the small, non-secret catalog
 * needed by the LAN console. Do not expose provider keys, headers, options, or
 * full model capability payloads through the LAN boundary.
 */
export function lanModelOptions(value: unknown): LanModelOption[] {
  const parsed = ProviderCatalog.safeParse(value)
  if (!parsed.success) return []
  return parsed.data.providers.flatMap((provider) =>
    Object.values(provider.models).map((model) => ({
      providerID: provider.id,
      providerName: provider.name,
      modelID: model.id,
      modelName: model.name,
      modelRef: `${provider.id}/${model.id}`,
      default: parsed.data.default[provider.id] === model.id,
    })),
  )
}

/**
 * The desktop prompt selector only permits visible primary/all agents. Keep
 * the LAN console on the same surface and expose only their names. Agent
 * descriptions, prompts, permissions, model defaults, and options remain local.
 */
export function lanAgentOptions(value: unknown): LanAgentOption[] {
  const parsed = AgentCatalog.safeParse(value)
  if (!parsed.success) return []
  return parsed.data
    .filter((agent) => agent.mode !== "subagent" && agent.hidden !== true)
    .map((agent) => ({ name: agent.name }))
}
