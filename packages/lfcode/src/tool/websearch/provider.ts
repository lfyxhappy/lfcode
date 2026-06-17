export const XIAOMI_WEBSEARCH_PROVIDER_IDS = new Set([
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
])

export function supportsXiaomiWebsearch(providerID: string) {
  return XIAOMI_WEBSEARCH_PROVIDER_IDS.has(providerID)
}
