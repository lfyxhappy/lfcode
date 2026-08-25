import { describe, expect, test } from "bun:test"
import { clearProjectResearch, getSubscription, upsertSubscription } from "../../src/research/persistence"
import { isPublicSourceURL, nextCheck, retryDelay, SourceRefreshScheduler } from "../../src/research/scheduler"

describe("source refresh scheduler", () => {
  test("uses public HTTP only and preserves the planned intervals", () => {
    const now = Date.UTC(2026, 6, 19)
    expect(isPublicSourceURL("https://example.test/feed.xml")).toBe(true)
    expect(isPublicSourceURL("http://127.0.0.1/private")).toBe(false)
    expect(isPublicSourceURL("https://user:pass@example.test/feed")).toBe(false)
    expect(nextCheck("rss", now) - now).toBe(6 * 60 * 60 * 1000)
    expect(nextCheck("sitemap", now) - now).toBe(24 * 60 * 60 * 1000)
    expect(nextCheck("document", now) - now).toBe(7 * 24 * 60 * 60 * 1000)
    expect(retryDelay(1, new Error("request timed out"))).toBe(60_000)
  })

  test("uses conditional public fetches and identifies changed content", async () => {
    const projectID = "scheduler-project"
    clearProjectResearch(projectID)
    const subscription = upsertSubscription({
      projectID,
      url: "https://monitor.example.test/feed.xml",
      kind: "rss",
      enabled: true,
    })
    const now = Date.UTC(2026, 6, 19, 9)
    let calls = 0
    const scheduler = new SourceRefreshScheduler({
      now: () => now,
      fetcher: async (_url, init) => {
        calls++
        if (calls === 2) expect(new Headers(init?.headers).get("if-none-match")).toBe('"v1"')
        return new Response(`<rss><channel><item><title>Release ${calls}</title><link>https://monitor.example.test/r/${calls}</link></item></channel></rss>`, {
          headers: { ETag: calls === 1 ? '"v1"' : '"v2"' },
        })
      },
    })
    expect(await scheduler.refreshSubscription(subscription.id)).toMatchObject({ status: "unchanged" })
    expect(await scheduler.refreshSubscription(subscription.id)).toMatchObject({ status: "updated" })
    expect(calls).toBe(2)
    expect(getSubscription(subscription.id)?.contentHash).toBeDefined()
  })

  test("backs off retryable HTTP failures without invoking model or browser services", async () => {
    const projectID = "scheduler-failure-project"
    clearProjectResearch(projectID)
    const subscription = upsertSubscription({
      projectID,
      url: "https://monitor-failure.example.test/feed.xml",
      kind: "atom",
      enabled: true,
    })
    const now = Date.UTC(2026, 6, 19, 10)
    const scheduler = new SourceRefreshScheduler({ now: () => now, fetcher: async () => new Response("busy", { status: 429 }) })
    const result = await scheduler.refreshSubscription(subscription.id)
    expect(result).toMatchObject({ status: "failed", nextCheckAt: now + 60_000 })
    expect(getSubscription(subscription.id)?.failureSummary).toContain("attempt=1")
  })
})

