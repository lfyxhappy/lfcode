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
})

