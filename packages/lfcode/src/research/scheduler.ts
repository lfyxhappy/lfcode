import { createHash } from "node:crypto"
import {
  countProjectObservationsSince,
  getSubscription,
  listDueSubscriptions,
  recordObservation,
} from "./persistence"
import type { SourceSubscription } from "./schema"

const DEFAULT_INTERVAL_MS = 60_000
const MAX_CONCURRENT_REFRESHES = 2
const DAILY_REQUEST_LIMIT = 20
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export type SourceRefreshSchedulerOptions = {
  intervalMs?: number
  maxConcurrent?: number
  dailyRequestLimit?: number
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => number
}

export type SourceRefreshResult = {
  subscriptionID: string
  status: "updated" | "unchanged" | "failed" | "skipped"
  nextCheckAt?: number
  reason?: string
}

/**
 * Lightweight local-only scheduler. It deliberately imports neither model nor
 * browser services: subscriptions are public HTTP polling only.
 */
export class SourceRefreshScheduler {
  #timer: ReturnType<typeof setInterval> | undefined
  #run: Promise<SourceRefreshResult[]> | undefined

  constructor(private options: SourceRefreshSchedulerOptions = {}) {}

  start() {
    if (this.#timer) return
    void this.runOnce()
    this.#timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS)
  }

  stop() {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  async runOnce() {
    if (this.#run) return this.#run
    this.#run = this.#refreshDue().finally(() => {
      this.#run = undefined
    })
    return this.#run
  }

  async refreshSubscription(subscriptionID: string) {
    const subscription = getSubscription(subscriptionID)
    if (!subscription) return { subscriptionID, status: "skipped" as const, reason: "subscription not found" }
    return this.#refresh(subscription)
  }

  async #refreshDue() {
    const now = this.now()
    const due = listDueSubscriptions(now)
    const eligible = Object.values(Object.groupBy(due, (subscription) => subscription.projectID)).flatMap((subscriptions) => {
      if (!subscriptions) return []
      const used = countProjectObservationsSince(subscriptions[0]!.projectID, startOfDay(now))
      return subscriptions.slice(0, Math.max(0, (this.options.dailyRequestLimit ?? DAILY_REQUEST_LIMIT) - used))
    })
    return runWithConcurrency(eligible, this.options.maxConcurrent ?? MAX_CONCURRENT_REFRESHES, (subscription) => this.#refresh(subscription))
  }

  async #refresh(subscription: SourceSubscription): Promise<SourceRefreshResult> {
    const now = this.now()
    if (!isPublicSourceURL(subscription.url)) {
      recordObservation({
        subscriptionID: subscription.id,
        changed: false,
        checkedAt: now,
        nextCheckAt: nextCheck(subscription.kind, now, 24 * 60 * 60 * 1000),
        failureSummary: "Source URL is not a public HTTP endpoint.",
      })
      return { subscriptionID: subscription.id, status: "skipped", reason: "source is not public" }
    }
    try {
      const headers: Record<string, string> = { Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, application/json;q=0.7", "User-Agent": "lfcode-research-monitor/1" }
      if (subscription.etag) headers["If-None-Match"] = subscription.etag
      if (subscription.lastModified) headers["If-Modified-Since"] = subscription.lastModified
      const response = await (this.options.fetcher ?? fetch)(subscription.url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) })
      if (response.status === 304) {
        recordObservation({
          subscriptionID: subscription.id,
          changed: false,
          checkedAt: now,
          nextCheckAt: nextCheck(subscription.kind, now),
          etag: response.headers.get("etag") ?? subscription.etag,
          lastModified: response.headers.get("last-modified") ?? subscription.lastModified,
        })
        return { subscriptionID: subscription.id, status: "unchanged", nextCheckAt: nextCheck(subscription.kind, now) }
      }
      if (!response.ok) throw new RefreshError(`HTTP ${response.status}`, response.status)
      const body = await response.text()
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new RefreshError("response exceeds 5MB")
      if (/<input[^>]+type=["']password/i.test(body)) throw new RefreshError("authentication required")
      const contentHash = createHash("sha256").update(body, "utf8").digest("hex")
      const changed = subscription.contentHash !== undefined && subscription.contentHash !== contentHash
      const item = parseSubscriptionItem(body, subscription.url)
      const nextCheckAt = nextCheck(subscription.kind, now)
      recordObservation({
        subscriptionID: subscription.id,
        changed,
        checkedAt: now,
        nextCheckAt,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        contentHash,
        title: item.title,
        url: item.url,
        detail: { kind: subscription.kind, public: true },
      })
      return { subscriptionID: subscription.id, status: changed ? "updated" : "unchanged", nextCheckAt }
    } catch (error) {
      const attempt = failureAttempt(subscription.failureSummary) + 1
      const reason = error instanceof Error ? error.message : String(error)
      const nextCheckAt = nextCheck(subscription.kind, now, retryDelay(attempt, error))
      recordObservation({
        subscriptionID: subscription.id,
        changed: false,
        checkedAt: now,
        nextCheckAt,
        failureSummary: `attempt=${attempt}; ${reason.slice(0, 900)}`,
      })
      return { subscriptionID: subscription.id, status: "failed", nextCheckAt, reason }
    }
  }

  private now() {
    return this.options.now?.() ?? Date.now()
  }
}

export function nextCheck(kind: SourceSubscription["kind"], now = Date.now(), retryMs?: number) {
  if (retryMs !== undefined) return now + retryMs
  if (kind === "rss" || kind === "atom" || kind === "release") return now + 6 * 60 * 60 * 1000
  if (kind === "sitemap") return now + 24 * 60 * 60 * 1000
  return now + 7 * 24 * 60 * 60 * 1000
}

export function retryDelay(attempt: number, error?: unknown) {
  const status = error instanceof RefreshError ? error.status : undefined
  const timeout = error instanceof Error && /abort|timeout|timed out/i.test(error.name + error.message)
  if (status !== 429 && (status === undefined || status < 500) && !timeout) return 24 * 60 * 60 * 1000
  return Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempt - 1))
}

export function isPublicSourceURL(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false
    if (/^(127|10)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return false
    return true
  } catch {
    return false
  }
}

function startOfDay(now: number) {
  const value = new Date(now)
  value.setHours(0, 0, 0, 0)
  return value.getTime()
}

function failureAttempt(value: string | undefined) {
  const match = /^attempt=(\d+);/.exec(value ?? "")
  return match ? Number(match[1]) : 0
}

function parseSubscriptionItem(body: string, fallbackURL: string) {
  const scope = body.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/i)?.[0] ?? body
  const title = scope.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  const url = scope.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? scope.match(/<link[^>]*>(https?:\/\/[^<\s]+)/i)?.[1] ?? fallbackURL
  return { title, url: isPublicSourceURL(url) ? url : fallbackURL }
}

class RefreshError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

async function runWithConcurrency<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results: R[] = []
  const pending = [...items]
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), pending.length) }, async () => {
    while (pending.length > 0) {
      const item = pending.shift()
      if (item === undefined) return
      results.push(await fn(item))
    }
  })
  await Promise.all(workers)
  return results
}
