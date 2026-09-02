export type QuotaProviderCapability = {
  query: boolean
  docsURL?: string
}

export const QUOTA_CACHE_TTL_MS = 30_000

export type QuotaWindow = {
  id: string
  percent?: number
  resetsAt?: string
  status?: "ok" | "rate-limited"
  scope?: "account" | "model"
  modelName?: string
  usedPercent?: number
  remainingPercent?: number
  resetInSeconds?: number
  resetPeriod?: string
  remaining?: number
  total?: number
  used?: number
  currency?: string
  unit?: "requests" | "tokens" | "unknown"
}

export type QuotaBalance = {
  available: number
  currency: string
  granted?: number
  cash?: number
  voucher?: number
  isAvailable?: boolean
  total?: number
}

export type QuotaUsage = {
  balance?: QuotaBalance
  windows: QuotaWindow[]
  fetchedAt?: string
  source?: string
}

export type QuotaResult =
  | { ok: true; usage: QuotaUsage }
  | { ok: false; error: "missing_api_key" | "unauthorized" | "rate_limited" | "invalid_response" | "network" }

export type QuotaBalanceField = {
  id: "available" | "total" | "granted" | "cash" | "voucher"
  value: number
}

const quotaProviderCapabilityRegistry = {
  opencode: { query: true },
  "opencode-go": { query: true },
  minimax: { query: true },
  "minimax-cn-coding-plan": { query: true },
  deepseek: { query: true },
  moonshotai: { query: true },
  siliconflow: { query: true },
  openrouter: { query: true },
  anthropic: { query: false, docsURL: "https://console.anthropic.com/settings/billing" },
  openai: { query: false, docsURL: "https://platform.openai.com/usage" },
  google: { query: false, docsURL: "https://aistudio.google.com/usage" },
  zai: { query: false, docsURL: "https://www.z.ai/manage-apikey" },
  zhipuai: { query: false, docsURL: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys" },
  alibaba: { query: false, docsURL: "https://bailian.console.aliyun.com/" },
  "alibaba-cn": { query: false, docsURL: "https://bailian.console.aliyun.com/" },
} as const satisfies Record<string, QuotaProviderCapability>

export const quotaProviderIDs = new Set(Object.keys(quotaProviderCapabilityRegistry))

export function quotaProviderCapability(providerID: string): QuotaProviderCapability | undefined {
  return quotaProviderCapabilityRegistry[providerID as keyof typeof quotaProviderCapabilityRegistry]
}

export function quotaProviderDocsURL(providerID: string) {
  return quotaProviderCapability(providerID)?.docsURL
}

export function supportsQuotaQuery(providerID: string) {
  return quotaProviderCapability(providerID)?.query === true
}

export function quotaAuthProviderID(providerID: string) {
  if (providerID === "minimax-cn-coding-plan") return "minimax"
  return providerID
}

export function supportedQuotaProviderIDs(input: readonly { id: string }[]) {
  return input.flatMap((provider) => (supportsQuotaQuery(provider.id) ? [provider.id] : []))
}

export function shouldRefreshQuota(input: { cachedAt?: number; force?: boolean; now?: number }) {
  if (input.force) return true
  if (input.cachedAt === undefined) return true
  return (input.now ?? Date.now()) - input.cachedAt >= QUOTA_CACHE_TTL_MS
}

export function quotaBalanceFields(balance: QuotaBalance): QuotaBalanceField[] {
  return [
    { id: "available", value: balance.available },
    ...(balance.total !== undefined && balance.total !== balance.available ? [{ id: "total" as const, value: balance.total }] : []),
    ...(balance.granted === undefined ? [] : [{ id: "granted" as const, value: balance.granted }]),
    ...(balance.cash === undefined ? [] : [{ id: "cash" as const, value: balance.cash }]),
    ...(balance.voucher === undefined ? [] : [{ id: "voucher" as const, value: balance.voucher }]),
  ]
}

export function quotaRefreshResult(input: { cached?: Extract<QuotaResult, { ok: true }>; next: QuotaResult }) {
  if (input.next.ok) return { result: input.next, refreshError: undefined }
  return { result: input.cached ?? input.next, refreshError: input.next.error }
}

export function visibleQuotaWindows(windows: QuotaWindow[]) {
  return windows.filter((quota) => quota.modelName !== "video" && !quota.id.startsWith("video:"))
}
