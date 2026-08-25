export const quotaProviderIDs = new Set(["opencode", "opencode-go", "minimax", "minimax-cn-coding-plan"])

export function quotaAuthProviderID(providerID: string) {
  if (providerID === "minimax-cn-coding-plan") return "minimax"
  return providerID
}

export function supportedQuotaProviderIDs(input: readonly { id: string }[]) {
  return input.flatMap((provider) => (quotaProviderIDs.has(provider.id) ? [provider.id] : []))
}
