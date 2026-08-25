import { describe, expect, test } from "bun:test"
import {
  clearProjectResearch,
  getEvidence,
  listEvidence,
  listObservations,
  listSourceProfiles,
  listSubscriptions,
  recordObservation,
  upsertEvidence,
  upsertSourceProfile,
  upsertSubscription,
} from "../../src/research/persistence"
import { fetchAndStoreEvidence } from "../../src/research/fetch"

const profileInput = {
  projectID: "research-project",
  subject: "Example docs",
  domains: ["example.test"],
  paths: ["/docs"],
  kind: "technical" as const,
  identity: "official" as const,
  refreshPolicy: { strategy: "daily" as const },
  priority: 10,
  enabled: true,
}

describe("research persistence", () => {
  test("stores source profiles and versions evidence by canonical URL", () => {
    clearProjectResearch("research-project")
    const profile = upsertSourceProfile(profileInput)
    expect(listSourceProfiles("research-project")).toHaveLength(1)

    const first = upsertEvidence({
      projectID: "research-project",
      sourceProfileID: profile.id,
      url: "https://example.test/docs?a=1&token=secret",
      canonicalURL: "https://example.test/docs?a=1&utm_source=x",
      domain: "example.test",
      contentHash: "hash-1",
      excerpts: [{ text: "first" }],
      attachments: [],
      body: "Bearer abc123",
      sourceIdentity: "official",
      evidenceStatus: "content_verified",
      route: "direct",
      metadata: { authorization: "must-not-persist", safe: true },
    })
    expect(first.version).toBe(1)
    expect(first.url).not.toContain("token=")
    expect(first.canonicalURL).toBe("https://example.test/docs?a=1")
    expect(first.metadata).toEqual({ safe: true })

    const same = upsertEvidence({
      projectID: "research-project",
      sourceProfileID: profile.id,
      url: first.url,
      canonicalURL: first.canonicalURL,
      domain: "example.test",
      contentHash: "hash-1",
      excerpts: [{ text: "first" }],
      attachments: [],
      sourceIdentity: "official",
      evidenceStatus: "content_verified",
      route: "cache",
      metadata: {},
    })
    expect(same.id).toBe(first.id)
    expect(same.version).toBe(1)

    const changed = upsertEvidence({
      projectID: "research-project",
      sourceProfileID: profile.id,
      url: first.url,
      canonicalURL: first.canonicalURL,
      domain: "example.test",
      contentHash: "hash-2",
      excerpts: [{ text: "changed" }],
      attachments: [],
      sourceIdentity: "official",
      evidenceStatus: "content_verified",
      route: "direct",
      metadata: {},
    })
    expect(changed.version).toBe(2)
    expect(getEvidence(changed.id)?.version).toBe(2)
    expect(listEvidence("research-project", { freshOnly: true })).toHaveLength(1)
  })

  test("tracks subscriptions and observations, then clears project metadata", () => {
    clearProjectResearch("research-project-2")
    const subscription = upsertSubscription({
      projectID: "research-project-2",
      url: "https://example.test/feed.xml",
      kind: "rss",
      enabled: true,
    })
    expect(listSubscriptions("research-project-2")).toHaveLength(1)
    const observation = recordObservation({ subscriptionID: subscription.id, changed: true, title: "Update", contentHash: "h" })
    expect(observation?.changed).toBe(true)
    expect(listObservations(subscription.id)).toHaveLength(1)
    expect(clearProjectResearch("research-project-2").subscriptions).toBe(1)
    expect(listSubscriptions("research-project-2")).toHaveLength(0)
  })

  test("uses the selected profile identity and stores fetched readable content as verified", async () => {
    const projectID = "research-profile-fetch"
    clearProjectResearch(projectID)
    const profile = upsertSourceProfile({ ...profileInput, projectID, subject: "Official docs" })
    const result = await fetchAndStoreEvidence({
      projectID,
      sourceProfileID: profile.id,
      url: "https://example.test/docs/release",
      now: 1_000,
      fetcher: async () =>
        new Response("<html><head><title>Release notes</title></head><body>Version 2 is available.</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    })
    expect(result.status).toBe("stored")
    if (result.status !== "stored") return
    expect(result.record).toMatchObject({
      sourceIdentity: "official",
      evidenceStatus: "content_verified",
      expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1000,
    })
  })

  test("refreshes cache metadata after a conditional 304 response", async () => {
    const projectID = "research-conditional-fetch"
    clearProjectResearch(projectID)
    const first = await fetchAndStoreEvidence({
      projectID,
      url: "https://example.test/docs/cache",
      now: 1_000,
      fetcher: async () =>
        new Response("<html><head><title>Cached</title></head><body>Readable body</body></html>", {
          headers: { etag: "\"v1\"" },
        }),
    })
    if (first.status !== "stored") throw new Error("expected initial evidence storage")

    const refreshed = await fetchAndStoreEvidence({
      projectID,
      url: first.record.url,
      existing: first.record,
      now: 2_000,
      fetcher: async (_url, init) => {
        expect(new Headers(init?.headers).get("if-none-match")).toBe("\"v1\"")
        return new Response(null, { status: 304, headers: { etag: "\"v1\"" } })
      },
    })
    expect(refreshed.status).toBe("not_modified")
    expect(refreshed.record).toMatchObject({ id: first.record.id, fetchedAt: 2_000, version: 1 })
    expect(refreshed.record?.expiresAt).toBeGreaterThan(2_000)
  })
})
