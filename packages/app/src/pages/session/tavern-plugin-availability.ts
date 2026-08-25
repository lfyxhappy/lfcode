export type TavernPluginAvailability =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "unavailable"; reason: "missing" | "disabled" | "degraded" | "unreachable" }

type TavernPluginInspect = {
  enabled: boolean
  manifest?: { id?: string }
  server: { status: "ready" | "missing" | "unresolved" | "error" }
  runtime?: { lifecycle: "active" | "disabled" | "degraded" }
}

export function resolveTavernPluginAvailability(input: {
  pending?: boolean
  error?: unknown
  plugins?: TavernPluginInspect[]
}): TavernPluginAvailability {
  if (input.pending) return { kind: "checking" }
  if (input.error) return { kind: "unavailable", reason: "unreachable" }

  const plugin = input.plugins?.find((item) => item.manifest?.id === "lfcode-tavern")
  if (!plugin) return { kind: "unavailable", reason: "missing" }
  if (!plugin.enabled || plugin.runtime?.lifecycle === "disabled") return { kind: "unavailable", reason: "disabled" }
  if (plugin.server.status !== "ready" || plugin.runtime?.lifecycle !== "active") return { kind: "unavailable", reason: "degraded" }
  return { kind: "ready" }
}
