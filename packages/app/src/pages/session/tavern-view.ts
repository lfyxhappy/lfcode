export type TavernViewSettings = {
  immersive: boolean
  dualView: boolean
}

export function normalizeTavernViewSettings(input: unknown): TavernViewSettings {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
  return {
    immersive: value.immersive === true,
    dualView: value.dualView === true,
  }
}
