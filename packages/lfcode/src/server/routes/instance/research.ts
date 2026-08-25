import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { errors } from "../../error"
import {
  clearEvidence,
  clearProjectResearch,
  deleteEvidence,
  deleteSourceProfile,
  getEvidence,
  getEvidenceByURL,
  getResearchSettings,
  getSourceProfile,
  isEvidenceFresh,
  listEvidence,
  listObservations,
  listSourceProfiles,
  listSubscriptions,
  recordObservation,
  setSubscriptionEnabled,
  upsertEvidence,
  upsertResearchSettings,
  upsertSourceProfile,
  upsertSubscription,
} from "@/research/persistence"
import {
  BrowserSearchEngine,
  EvidenceRecord,
  EvidenceRecordInput,
  ResearchSettings,
  ResearchSettingsInput,
  SourceProfile,
  SourceProfileInput,
  SourceSubscription,
  SourceSubscriptionInput,
} from "@/research/schema"
import { fetchAndStoreEvidence } from "@/research/fetch"
import { chooseSearchRoute } from "@/research/routing"
import { sourceProfileEntryURL } from "@/research/registry"
import { SourceRefreshScheduler } from "@/research/scheduler"

const ProjectQuery = z.object({ projectID: z.string().min(1).optional() })
const projectID = (value: string | undefined) => value ?? String(Instance.project.id)

const EvidenceList = z.array(EvidenceRecord)
const ProfileList = z.array(SourceProfile)
const SubscriptionList = z.array(SourceSubscription)
const RouteQuery = ProjectQuery.extend({
  query: z.string().min(1),
  url: z.string().url().optional(),
  browserEngine: BrowserSearchEngine.optional(),
  browserURLTemplate: z.string().optional(),
})

export const ResearchRoutes = lazy(() =>
  new Hono()
    .get(
      "/route",
      describeRoute({
        summary: "Plan a web research route",
        operationId: "research.route",
        responses: { 200: { description: "Search route decision", content: { "application/json": { schema: resolver(z.record(z.string(), z.unknown())) } } } },
      }),
      validator("query", RouteQuery),
      async (c) => {
        const query = c.req.valid("query")
        const currentProjectID = projectID(query.projectID)
        const settings = getResearchSettings(currentProjectID)
        const profiles = listSourceProfiles(currentProjectID, { enabledOnly: true })
        const cached = query.url ? getEvidenceByURL(currentProjectID, query.url) : undefined
        return c.json(
          chooseSearchRoute({
            query: query.query,
            url: query.url,
            browser: browserConfig(settings, query.browserEngine, query.browserURLTemplate),
            hasRegisteredDirectSource: profiles.length > 0,
            registeredDirectURL: profiles.map(sourceProfileEntryURL).find((value): value is string => Boolean(value)),
            cachedURL: cached && isEvidenceFresh(cached) ? cached.canonicalURL : undefined,
          }),
        )
      },
    )
    .get(
      "/settings",
      describeRoute({
        summary: "Get project research settings",
        operationId: "research.settings.get",
        responses: { 200: { description: "Research settings", content: { "application/json": { schema: resolver(ResearchSettings.nullable()) } } } },
      }),
      validator("query", ProjectQuery),
      async (c) => c.json(getResearchSettings(projectID(c.req.valid("query").projectID)) ?? null),
    )
    .put(
      "/settings",
      describeRoute({
        summary: "Update project research settings",
        operationId: "research.settings.update",
        responses: { 200: { description: "Research settings", content: { "application/json": { schema: resolver(ResearchSettings) } } }, ...errors(400) },
      }),
      validator("query", ProjectQuery),
      validator("json", ResearchSettingsInput),
      async (c) => c.json(upsertResearchSettings(projectID(c.req.valid("query").projectID), c.req.valid("json"))),
    )
    .get(
      "/sources",
      describeRoute({
        summary: "List project source profiles",
        operationId: "research.sources.list",
        responses: { 200: { description: "Source profiles", content: { "application/json": { schema: resolver(ProfileList) } } } },
      }),
      validator("query", ProjectQuery.extend({ enabledOnly: z.coerce.boolean().optional() })),
      async (c) => c.json(listSourceProfiles(projectID(c.req.valid("query").projectID), { enabledOnly: c.req.valid("query").enabledOnly })),
    )
    .post(
      "/sources",
      describeRoute({
        summary: "Register a project source profile",
        operationId: "research.sources.upsert",
        responses: { 200: { description: "Source profile", content: { "application/json": { schema: resolver(SourceProfile) } } }, ...errors(400) },
      }),
      validator("json", SourceProfileInput),
      async (c) => c.json(upsertSourceProfile(c.req.valid("json"))),
    )
    .get(
      "/sources/:sourceID",
      describeRoute({
        summary: "Get a source profile",
        operationId: "research.sources.get",
        responses: { 200: { description: "Source profile", content: { "application/json": { schema: resolver(SourceProfile) } } }, ...errors(404) },
      }),
      validator("param", z.object({ sourceID: z.string().min(1) })),
      async (c) => {
        const profile = getSourceProfile(c.req.valid("param").sourceID)
        if (!profile) return c.json({ error: "Source profile not found" }, 404)
        return c.json(profile)
      },
    )
    .delete(
      "/sources/:sourceID",
      describeRoute({ summary: "Delete a source profile", operationId: "research.sources.delete", responses: { 200: { description: "Deleted" } } }),
      validator("param", z.object({ sourceID: z.string().min(1) })),
      async (c) => c.json({ deleted: deleteSourceProfile(c.req.valid("param").sourceID) }),
    )
    .get(
      "/evidence",
      describeRoute({
        summary: "List project evidence records",
        operationId: "research.evidence.list",
        responses: { 200: { description: "Evidence records", content: { "application/json": { schema: resolver(EvidenceList) } } } },
      }),
      validator("query", ProjectQuery.extend({ limit: z.coerce.number().int().min(1).max(500).optional(), freshOnly: z.coerce.boolean().optional(), sourceProfileID: z.string().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(listEvidence(projectID(query.projectID), query))
      },
    )
    .post(
      "/evidence",
      describeRoute({
        summary: "Save a project evidence record",
        operationId: "research.evidence.upsert",
        responses: { 200: { description: "Evidence record", content: { "application/json": { schema: resolver(EvidenceRecord) } } }, ...errors(400) },
      }),
      validator("json", EvidenceRecordInput),
      async (c) => c.json(upsertEvidence(c.req.valid("json"))),
    )
    .get(
      "/evidence/:evidenceID",
      describeRoute({
        summary: "Get an evidence record",
        operationId: "research.evidence.get",
        responses: { 200: { description: "Evidence record", content: { "application/json": { schema: resolver(EvidenceRecord) } } }, ...errors(404) },
      }),
      validator("param", z.object({ evidenceID: z.string().min(1) })),
      async (c) => {
        const evidence = getEvidence(c.req.valid("param").evidenceID)
        if (!evidence) return c.json({ error: "Evidence record not found" }, 404)
        return c.json(evidence)
      },
    )
    .post(
      "/evidence/:evidenceID/refresh",
      describeRoute({
        summary: "Refresh an evidence URL",
        operationId: "research.evidence.refresh",
        responses: { 200: { description: "Refreshed evidence", content: { "application/json": { schema: resolver(EvidenceRecord) } } }, ...errors(404) },
      }),
      validator("param", z.object({ evidenceID: z.string().min(1) })),
      async (c) => {
        const current = getEvidence(c.req.valid("param").evidenceID)
        if (!current) return c.json({ error: "Evidence record not found" }, 404)
        const result = await fetchAndStoreEvidence({ projectID: current.projectID, url: current.url, sourceProfileID: current.sourceProfileID, existing: current })
        return c.json(result.status === "stored" || result.record ? result.record : current)
      },
    )
    .delete(
      "/evidence",
      describeRoute({ summary: "Clear project evidence", operationId: "research.evidence.clear", responses: { 200: { description: "Cleared" } } }),
      validator("query", ProjectQuery),
      async (c) => c.json({ deleted: clearEvidence(projectID(c.req.valid("query").projectID)) }),
    )
    .delete(
      "/evidence/:evidenceID",
      describeRoute({ summary: "Delete an evidence record", operationId: "research.evidence.delete", responses: { 200: { description: "Deleted" } } }),
      validator("param", z.object({ evidenceID: z.string().min(1) })),
      async (c) => c.json({ deleted: deleteEvidence(c.req.valid("param").evidenceID) }),
    )
    .get(
      "/subscriptions",
      describeRoute({
        summary: "List project source subscriptions",
        operationId: "research.subscriptions.list",
        responses: { 200: { description: "Subscriptions", content: { "application/json": { schema: resolver(SubscriptionList) } } } },
      }),
      validator("query", ProjectQuery.extend({ dueBefore: z.coerce.number().int().optional(), enabledOnly: z.coerce.boolean().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(listSubscriptions(projectID(query.projectID), query))
      },
    )
    .post(
      "/subscriptions",
      describeRoute({
        summary: "Register a source subscription",
        operationId: "research.subscriptions.upsert",
        responses: { 200: { description: "Subscription", content: { "application/json": { schema: resolver(SourceSubscription) } } }, ...errors(400) },
      }),
      validator("json", SourceSubscriptionInput),
      async (c) => c.json(upsertSubscription(c.req.valid("json"))),
    )
    .post(
      "/subscriptions/:subscriptionID/enable",
      describeRoute({ summary: "Enable or disable a source subscription", operationId: "research.subscriptions.enable", responses: { 200: { description: "Subscription" } } }),
      validator("param", z.object({ subscriptionID: z.string().min(1) })),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const result = setSubscriptionEnabled(c.req.valid("param").subscriptionID, c.req.valid("json").enabled)
        if (!result) return c.json({ error: "Subscription not found" }, 404)
        return c.json(result)
      },
    )
    .post(
      "/subscriptions/:subscriptionID/refresh",
      describeRoute({ summary: "Refresh a public source subscription", operationId: "research.subscriptions.refresh", responses: { 200: { description: "Refresh result" } } }),
      validator("param", z.object({ subscriptionID: z.string().min(1) })),
      async (c) => c.json(await new SourceRefreshScheduler().refreshSubscription(c.req.valid("param").subscriptionID)),
    )
    .get(
      "/subscriptions/:subscriptionID/observations",
      describeRoute({ summary: "List source observations", operationId: "research.subscriptions.observations", responses: { 200: { description: "Observations" } } }),
      validator("param", z.object({ subscriptionID: z.string().min(1) })),
      validator("query", z.object({ limit: z.coerce.number().int().min(1).max(500).optional() })),
      async (c) => c.json(listObservations(c.req.valid("param").subscriptionID, c.req.valid("query").limit)),
    )
    .post(
      "/subscriptions/:subscriptionID/observations",
      describeRoute({ summary: "Record a source observation", operationId: "research.subscriptions.observe", responses: { 200: { description: "Observation" } } }),
      validator("param", z.object({ subscriptionID: z.string().min(1) })),
      validator("json", z.object({ changed: z.boolean(), title: z.string().optional(), url: z.string().url().optional(), contentHash: z.string().optional(), detail: z.record(z.string(), z.unknown()).optional(), checkedAt: z.number().int().optional(), nextCheckAt: z.number().int().optional(), etag: z.string().optional(), lastModified: z.string().optional(), failureSummary: z.string().optional() })),
      async (c) => {
        const observation = recordObservation({ subscriptionID: c.req.valid("param").subscriptionID, ...c.req.valid("json") })
        if (!observation) return c.json({ error: "Subscription not found" }, 404)
        return c.json(observation)
      },
    )
    .delete(
      "/project",
      describeRoute({ summary: "Clear all project research metadata", operationId: "research.project.clear", responses: { 200: { description: "Cleared" } } }),
      validator("query", ProjectQuery),
      async (c) => c.json(clearProjectResearch(projectID(c.req.valid("query").projectID))),
    ),
)

function browserConfig(
  settings: ResearchSettings | undefined,
  browserEngine: z.infer<typeof BrowserSearchEngine> | undefined,
  browserURLTemplate: string | undefined,
) {
  const engine = settings?.browserSearchEngine ?? browserEngine
  if (!engine) return
  return {
    engine,
    template: settings?.browserSearchURLTemplate ?? browserURLTemplate,
  }
}
