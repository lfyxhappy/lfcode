import { Button } from "@lfcode-ai/ui/button"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tag } from "@lfcode-ai/ui/tag"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { type Component, type JSX, For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { SettingsList } from "./settings-list"

type BrowserSearchEngine = "bing" | "google" | "baidu" | "custom"
type BrowserEngineSelection = BrowserSearchEngine | "none"
type SourceKind = "technical" | "academic" | "policy" | "product" | "news" | "custom"
type SourceIdentity = "official" | "institutional" | "independent" | "practitioner" | "discovery"
type EvidenceStatus = "unverified" | "metadata_verified" | "content_verified" | "corroborated"
type SubscriptionKind = "rss" | "atom" | "sitemap" | "release" | "document"

type ResearchSettings = {
  browserSearchEngine: BrowserSearchEngine | null
  browserSearchURLTemplate: string | null
}

type SourceProfile = {
  id: string
  projectID: string
  subject: string
  domains: string[]
  paths: string[]
  kind: SourceKind
  identity: SourceIdentity
  officialRepository?: string
  refreshPolicy: {
    strategy: "manual" | "hourly" | "daily" | "weekly"
    ttlSeconds?: number
  }
  priority: number
  enabled: boolean
}

type EvidenceRecord = {
  id: string
  url: string
  canonicalURL: string
  title?: string
  domain: string
  fetchedAt: number
  expiresAt?: number
  sourceIdentity: SourceIdentity
  evidenceStatus: EvidenceStatus
  route: "native" | "direct" | "browser" | "cache" | "compat"
  version: number
}

type SourceSubscription = {
  id: string
  sourceProfileID?: string
  url: string
  kind: SubscriptionKind
  enabled: boolean
  nextCheckAt?: number
  lastCheckedAt?: number
  failureSummary?: string
}

type SourceObservation = {
  id: string
  observedAt: number
  changed: boolean
  title?: string
  url?: string
}

type SourceDraft = {
  subject: string
  domains: string
  kind: SourceKind
  identity: SourceIdentity
  priority: string
}

type SubscriptionDraft = {
  url: string
  kind: SubscriptionKind
  sourceProfileID: string
}

function parseDomains(value: string) {
  const domains = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new URL(/^https?:\/\//.test(item) ? item : `https://${item}`).hostname)
    .filter(Boolean)

  return [...new Set(domains)]
}

function publicURL(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are supported")
  return url.toString()
}

function dateTime(value: number | undefined, locale: string) {
  if (!value) return "-"
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value)
}

const SettingsSection: Component<{ title: string; description: string; children: JSX.Element }> = (props) => (
  <section class="flex flex-col gap-3">
    <div>
      <h2 class="text-16-medium text-text-strong">{props.title}</h2>
      <p class="mt-1 text-12-regular text-text-weak">{props.description}</p>
    </div>
    {props.children}
  </section>
)

const SettingsRow: Component<{ title: string; description: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-wrap items-center gap-4 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-14-medium text-text-strong">{props.title}</span>
      <span class="text-12-regular text-text-weak">{props.description}</span>
    </div>
    <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
  </div>
)

export const SettingsResearch: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const server = useServer()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const sdk = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const [browserEngine, setBrowserEngine] = createSignal<BrowserEngineSelection>("none")
  const [browserTemplate, setBrowserTemplate] = createSignal("")
  const [busy, setBusy] = createSignal<string>()
  const [confirmClearEvidence, setConfirmClearEvidence] = createSignal(false)
  const [confirmDeleteSource, setConfirmDeleteSource] = createSignal<SourceProfile>()
  const [selectedSubscriptionID, setSelectedSubscriptionID] = createSignal<string>()
  const [sourceDraft, setSourceDraft] = createStore<SourceDraft>({
    subject: "",
    domains: "",
    kind: "technical",
    identity: "official",
    priority: "0",
  })
  const [subscriptionDraft, setSubscriptionDraft] = createStore<SubscriptionDraft>({
    url: "",
    kind: "rss",
    sourceProfileID: "",
  })

  const authHeaders = () => {
    const current = server.current?.http
    if (!current?.password) return
    return { Authorization: `Basic ${btoa(`${current.username ?? "lfcode"}:${current.password}`)}` }
  }

  const apiURL = (path: string, query?: Record<string, string | number | boolean | undefined>) => {
    const base = server.current?.http.url
    if (!base) return
    const url = new URL(path, base)
    const currentDirectory = directory()
    if (currentDirectory) url.searchParams.set("directory", currentDirectory)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === "") continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  const request = async <T,>(path: string, init?: RequestInit, query?: Record<string, string | number | boolean | undefined>) => {
    const url = apiURL(path, query)
    if (!url) throw new Error(language.t("settings.research.error.serverUnavailable"))

    const headers = new Headers(init?.headers)
    const auth = authHeaders()
    if (auth) headers.set("Authorization", auth.Authorization)
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")

    const response = await fetch(url, { ...init, headers })
    if (!response.ok) throw new Error((await response.text()) || `Request failed: ${response.status}`)
    return (await response.json()) as T
  }

  const [researchSettings, researchSettingsActions] = createResource(directory, () => request<ResearchSettings>("/research/settings"))
  const [sourceProfiles, sourceProfilesActions] = createResource(directory, () => request<SourceProfile[]>("/research/sources"))
  const [evidence, evidenceActions] = createResource(directory, () => request<EvidenceRecord[]>("/research/evidence", undefined, { limit: 50 }))
  const [subscriptions, subscriptionsActions] = createResource(directory, () => request<SourceSubscription[]>("/research/subscriptions"))
  const [observations, observationsActions] = createResource(selectedSubscriptionID, (subscriptionID) =>
    request<SourceObservation[]>(`/research/subscriptions/${encodeURIComponent(subscriptionID)}/observations`, undefined, {
      limit: 20,
    }),
  )

  const sourceItems = createMemo(() => sourceProfiles.latest ?? [])
  const evidenceItems = createMemo(() => evidence.latest ?? [])
  const subscriptionItems = createMemo(() => subscriptions.latest ?? [])
  const loadError = createMemo(
    () => researchSettings.error ?? sourceProfiles.error ?? evidence.error ?? subscriptions.error ?? observations.error,
  )
  const engineOptions = createMemo(() => [
    { value: "none" as const, label: language.t("settings.research.browser.engine.none") },
    { value: "bing" as const, label: language.t("settings.research.browser.engine.bing") },
    { value: "google" as const, label: language.t("settings.research.browser.engine.google") },
    { value: "baidu" as const, label: language.t("settings.research.browser.engine.baidu") },
    { value: "custom" as const, label: language.t("settings.research.browser.engine.custom") },
  ])
  const sourceKindOptions = createMemo(() => [
    { value: "technical" as const, label: language.t("settings.research.source.kind.technical") },
    { value: "academic" as const, label: language.t("settings.research.source.kind.academic") },
    { value: "policy" as const, label: language.t("settings.research.source.kind.policy") },
    { value: "product" as const, label: language.t("settings.research.source.kind.product") },
    { value: "news" as const, label: language.t("settings.research.source.kind.news") },
    { value: "custom" as const, label: language.t("settings.research.source.kind.custom") },
  ])
  const identityOptions = createMemo(() => [
    { value: "official" as const, label: language.t("settings.research.identity.official") },
    { value: "institutional" as const, label: language.t("settings.research.identity.institutional") },
    { value: "independent" as const, label: language.t("settings.research.identity.independent") },
    { value: "practitioner" as const, label: language.t("settings.research.identity.practitioner") },
    { value: "discovery" as const, label: language.t("settings.research.identity.discovery") },
  ])
  const subscriptionKindOptions = createMemo(() => [
    { value: "rss" as const, label: language.t("settings.research.subscription.kind.rss") },
    { value: "atom" as const, label: language.t("settings.research.subscription.kind.atom") },
    { value: "sitemap" as const, label: language.t("settings.research.subscription.kind.sitemap") },
    { value: "release" as const, label: language.t("settings.research.subscription.kind.release") },
    { value: "document" as const, label: language.t("settings.research.subscription.kind.document") },
  ])
  const profileOptions = createMemo(() => [
    { value: "", label: language.t("settings.research.subscription.source.none") },
    ...sourceItems().map((profile) => ({ value: profile.id, label: profile.subject })),
  ])

  const sourceKindLabel = (kind: SourceKind) => sourceKindOptions().find((item) => item.value === kind)?.label ?? kind
  const identityLabel = (identity: SourceIdentity) => identityOptions().find((item) => item.value === identity)?.label ?? identity
  const subscriptionKindLabel = (kind: SubscriptionKind) =>
    subscriptionKindOptions().find((item) => item.value === kind)?.label ?? kind
  const evidenceStatusLabel = (status: EvidenceStatus) => language.t(`settings.research.evidence.status.${status}`)
  const requestError = (error: unknown) => formatServerError(error, language.t, language.t("common.requestFailed"))

  createEffect(() => {
    const value = researchSettings()
    if (!value) return
    setBrowserEngine(value.browserSearchEngine ?? "none")
    setBrowserTemplate(value.browserSearchURLTemplate ?? "")
  })

  const refresh = async () => {
    if (busy()) return
    setBusy("refresh")
    try {
      await Promise.all([
        researchSettingsActions.refetch(),
        sourceProfilesActions.refetch(),
        evidenceActions.refetch(),
        subscriptionsActions.refetch(),
        ...(selectedSubscriptionID() ? [observationsActions.refetch()] : []),
      ])
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.refreshFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const projectID = async () => {
    const current = await sdk().project.current()
    if (!current.data?.id || current.data.id === "global") throw new Error(language.t("settings.research.error.projectUnavailable"))
    return current.data.id
  }

  const saveBrowserSettings = async () => {
    if (busy()) return
    if (browserEngine() === "custom" && !browserTemplate().includes("{query}")) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.invalidTemplate.title"),
        description: language.t("settings.research.toast.invalidTemplate.description"),
      })
      return
    }

    setBusy("browser-settings")
    try {
      await request<ResearchSettings>("/research/settings", {
        method: "PUT",
        body: JSON.stringify({
          browserSearchEngine: browserEngine() === "none" ? null : browserEngine(),
          browserSearchURLTemplate: browserEngine() === "custom" ? browserTemplate().trim() : null,
        }),
      })
      showToast({ variant: "success", title: language.t("settings.research.toast.browserSaved.title") })
      await researchSettingsActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.browserSaveFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const resetSourceDraft = () => {
    setSourceDraft({ subject: "", domains: "", kind: "technical", identity: "official", priority: "0" })
  }

  const addSource = async () => {
    if (busy()) return
    setBusy("source-add")
    try {
      const domains = parseDomains(sourceDraft.domains)
      const priority = Number(sourceDraft.priority)
      if (!sourceDraft.subject.trim() || domains.length === 0) throw new Error(language.t("settings.research.error.sourceRequired"))
      if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) {
        throw new Error(language.t("settings.research.error.priority"))
      }

      await request<SourceProfile>("/research/sources", {
        method: "POST",
        body: JSON.stringify({
          projectID: await projectID(),
          subject: sourceDraft.subject.trim(),
          domains,
          paths: [],
          kind: sourceDraft.kind,
          identity: sourceDraft.identity,
          refreshPolicy: { strategy: "manual" },
          priority,
          enabled: true,
        }),
      })
      resetSourceDraft()
      showToast({ variant: "success", title: language.t("settings.research.toast.sourceAdded.title") })
      await sourceProfilesActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.sourceAddFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const setSourceEnabled = async (source: SourceProfile, enabled: boolean) => {
    if (busy()) return
    setBusy(`source-${source.id}`)
    try {
      await request<SourceProfile>("/research/sources", {
        method: "POST",
        body: JSON.stringify({
          id: source.id,
          projectID: source.projectID,
          subject: source.subject,
          domains: source.domains,
          paths: source.paths,
          kind: source.kind,
          identity: source.identity,
          ...(source.officialRepository ? { officialRepository: source.officialRepository } : {}),
          refreshPolicy: source.refreshPolicy,
          priority: source.priority,
          enabled,
        }),
      })
      await sourceProfilesActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.sourceUpdateFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const deleteSource = async (source: SourceProfile) => {
    if (busy()) return
    setBusy(`source-delete-${source.id}`)
    try {
      await request<{ deleted: boolean }>(`/research/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" })
      setConfirmDeleteSource(undefined)
      showToast({ variant: "success", title: language.t("settings.research.toast.sourceDeleted.title") })
      await sourceProfilesActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.sourceDeleteFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const refreshEvidence = async (record: EvidenceRecord) => {
    if (busy()) return
    setBusy(`evidence-${record.id}`)
    try {
      await request<EvidenceRecord>(`/research/evidence/${encodeURIComponent(record.id)}/refresh`, { method: "POST" })
      showToast({ variant: "success", title: language.t("settings.research.toast.evidenceRefreshed.title") })
      await evidenceActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.evidenceRefreshFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const clearEvidence = async () => {
    if (busy()) return
    setBusy("evidence-clear")
    try {
      const result = await request<{ deleted: number }>("/research/evidence", { method: "DELETE" })
      setConfirmClearEvidence(false)
      showToast({
        variant: "success",
        title: language.t("settings.research.toast.evidenceCleared.title", { count: result.deleted }),
      })
      await evidenceActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.evidenceClearFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const resetSubscriptionDraft = () => {
    setSubscriptionDraft({ url: "", kind: "rss", sourceProfileID: "" })
  }

  const addSubscription = async () => {
    if (busy()) return
    setBusy("subscription-add")
    try {
      await request<SourceSubscription>("/research/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          projectID: await projectID(),
          ...(subscriptionDraft.sourceProfileID ? { sourceProfileID: subscriptionDraft.sourceProfileID } : {}),
          url: publicURL(subscriptionDraft.url),
          kind: subscriptionDraft.kind,
          enabled: true,
        }),
      })
      resetSubscriptionDraft()
      showToast({ variant: "success", title: language.t("settings.research.toast.subscriptionAdded.title") })
      await subscriptionsActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.subscriptionAddFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const setSubscriptionEnabled = async (subscription: SourceSubscription, enabled: boolean) => {
    if (busy()) return
    setBusy(`subscription-${subscription.id}`)
    try {
      await request<SourceSubscription>(`/research/subscriptions/${encodeURIComponent(subscription.id)}/enable`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      })
      await subscriptionsActions.refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.subscriptionUpdateFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const refreshSubscription = async (subscription: SourceSubscription) => {
    if (busy()) return
    setBusy(`subscription-refresh-${subscription.id}`)
    try {
      await request<unknown>(`/research/subscriptions/${encodeURIComponent(subscription.id)}/refresh`, { method: "POST" })
      showToast({ variant: "success", title: language.t("settings.research.toast.subscriptionRefreshed.title") })
      await Promise.all([
        subscriptionsActions.refetch(),
        ...(selectedSubscriptionID() === subscription.id ? [observationsActions.refetch()] : []),
      ])
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.research.toast.subscriptionRefreshFailed.title"),
        description: requestError(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
        <div class="flex max-w-[980px] items-start justify-between gap-4 pb-6 pt-6">
          <div>
            <h2 class="text-16-medium text-text-strong">{language.t("settings.research.title")}</h2>
            <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.research.description")}</p>
          </div>
          <Button size="large" variant="secondary" onClick={() => void refresh()} disabled={busy() !== undefined}>
            {language.t("settings.research.action.refresh")}
          </Button>
        </div>
      </div>

      <div class="mx-auto flex w-full max-w-[980px] flex-col gap-8">
        <Show when={loadError()}>
          {(error) => (
            <div class="rounded-lg border border-border-weak-base bg-surface-base px-4 py-3 text-12-regular text-status-warning">
              {requestError(error())}
            </div>
          )}
        </Show>

        <SettingsSection
          title={language.t("settings.research.browser.title")}
          description={language.t("settings.research.browser.description")}
        >
          <SettingsList>
            <SettingsRow
              title={language.t("settings.research.browser.engine.title")}
              description={language.t("settings.research.browser.engine.description")}
            >
              <Select
                options={engineOptions()}
                current={engineOptions().find((item) => item.value === browserEngine())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setBrowserEngine(item.value)}
                disabled={busy() !== undefined || researchSettings.loading}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>
            <Show when={browserEngine() === "custom"}>
              <SettingsRow
                title={language.t("settings.research.browser.template.title")}
                description={language.t("settings.research.browser.template.description")}
              >
                <TextField
                  value={browserTemplate()}
                  onChange={setBrowserTemplate}
                  placeholder={language.t("settings.research.browser.template.placeholder")}
                  class="min-w-[260px]"
                />
              </SettingsRow>
            </Show>
            <div class="flex justify-end pt-3">
              <Button
                data-action="settings-research-save-browser"
                size="small"
                variant="secondary"
                onClick={() => void saveBrowserSettings()}
                disabled={busy() !== undefined || researchSettings.loading}
              >
                {language.t("settings.research.action.save")}
              </Button>
            </div>
          </SettingsList>
        </SettingsSection>

        <SettingsSection
          title={language.t("settings.research.source.title")}
          description={language.t("settings.research.source.description")}
        >
          <SettingsList>
            <div class="border-b border-border-weak-base py-3">
              <div class="grid gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-12-medium text-text-weak">
                  {language.t("settings.research.source.subject")}
                  <TextField
                    value={sourceDraft.subject}
                    onChange={(value) => setSourceDraft("subject", value)}
                    placeholder={language.t("settings.research.source.subjectPlaceholder")}
                  />
                </label>
                <label class="flex flex-col gap-1 text-12-medium text-text-weak">
                  {language.t("settings.research.source.domains")}
                  <TextField
                    value={sourceDraft.domains}
                    onChange={(value) => setSourceDraft("domains", value)}
                    placeholder={language.t("settings.research.source.domainsPlaceholder")}
                  />
                </label>
                <label class="flex flex-col gap-1 text-12-medium text-text-weak">
                  {language.t("settings.research.source.package")}
                  <Select
                    options={sourceKindOptions()}
                    current={sourceKindOptions().find((item) => item.value === sourceDraft.kind)}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => item && setSourceDraft("kind", item.value)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </label>
                <label class="flex flex-col gap-1 text-12-medium text-text-weak">
                  {language.t("settings.research.source.identity")}
                  <Select
                    options={identityOptions()}
                    current={identityOptions().find((item) => item.value === sourceDraft.identity)}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => item && setSourceDraft("identity", item.value)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </label>
                <label class="flex flex-col gap-1 text-12-medium text-text-weak md:col-span-2">
                  {language.t("settings.research.source.priority")}
                  <TextField type="number" value={sourceDraft.priority} onChange={(value) => setSourceDraft("priority", value)} />
                  <span class="text-11-regular text-text-weaker">{language.t("settings.research.source.priorityHint")}</span>
                </label>
              </div>
              <div class="mt-3 flex justify-end">
                <Button
                  data-action="settings-research-add-source"
                  size="small"
                  variant="secondary"
                  onClick={() => void addSource()}
                  disabled={busy() !== undefined}
                >
                  {language.t("settings.research.source.add")}
                </Button>
              </div>
            </div>

            <Show when={confirmDeleteSource()}>
              {(source) => (
                <div class="border-b border-border-weak-base py-3">
                  <div class="text-13-medium text-text-strong">{language.t("settings.research.source.delete.title")}</div>
                  <p class="mt-1 text-12-regular text-text-weak">
                    {language.t("settings.research.source.delete.confirm", { subject: source().subject })}
                  </p>
                  <div class="mt-3 flex justify-end gap-2">
                    <Button size="small" variant="secondary" onClick={() => setConfirmDeleteSource(undefined)} disabled={busy() !== undefined}>
                      {language.t("settings.research.action.cancel")}
                    </Button>
                    <Button size="small" variant="primary" onClick={() => void deleteSource(source())} disabled={busy() !== undefined}>
                      {language.t("settings.research.action.delete")}
                    </Button>
                  </div>
                </div>
              )}
            </Show>

            <Show when={!sourceProfiles.loading} fallback={<div class="py-5 text-13-regular text-text-weak">{language.t("common.loading")}</div>}>
              <For each={sourceItems()} fallback={<div class="py-5 text-13-regular text-text-weak">{language.t("settings.research.source.empty")}</div>}>
                {(source) => (
                  <div class="flex flex-wrap items-start gap-3 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-14-medium text-text-strong">{source.subject}</span>
                        <Tag>{sourceKindLabel(source.kind)}</Tag>
                        <Tag>{identityLabel(source.identity)}</Tag>
                      </div>
                      <div class="mt-1 break-all text-12-regular text-text-weak">{source.domains.join(", ")}</div>
                      <div class="mt-1 text-11-regular text-text-weaker">
                        {language.t("settings.research.source.priorityValue", { value: source.priority })}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <Switch
                        checked={source.enabled}
                        onChange={(enabled) => void setSourceEnabled(source, enabled)}
                        disabled={busy() !== undefined}
                        hideLabel
                      >
                        {source.subject}
                      </Switch>
                      <Button size="small" variant="ghost" onClick={() => setConfirmDeleteSource(source)} disabled={busy() !== undefined}>
                        {language.t("settings.research.action.delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </SettingsSection>

        <SettingsSection
          title={language.t("settings.research.evidence.title")}
          description={language.t("settings.research.evidence.description")}
        >
          <SettingsList>
            <Show when={confirmClearEvidence()}>
              <div class="border-b border-border-weak-base py-3">
                <div class="text-13-medium text-text-strong">{language.t("settings.research.evidence.clear.title")}</div>
                <p class="mt-1 text-12-regular text-text-weak">{language.t("settings.research.evidence.clear.confirm")}</p>
                <div class="mt-3 flex justify-end gap-2">
                  <Button size="small" variant="secondary" onClick={() => setConfirmClearEvidence(false)} disabled={busy() !== undefined}>
                    {language.t("settings.research.action.cancel")}
                  </Button>
                  <Button size="small" variant="primary" onClick={() => void clearEvidence()} disabled={busy() !== undefined}>
                    {language.t("settings.research.evidence.clear.action")}
                  </Button>
                </div>
              </div>
            </Show>
            <div class="flex justify-end border-b border-border-weak-base py-3">
              <Button
                data-action="settings-research-clear-evidence"
                size="small"
                variant="secondary"
                onClick={() => setConfirmClearEvidence(true)}
                disabled={busy() !== undefined || evidenceItems().length === 0}
              >
                {language.t("settings.research.evidence.clear.action")}
              </Button>
            </div>
            <Show when={!evidence.loading} fallback={<div class="py-5 text-13-regular text-text-weak">{language.t("common.loading")}</div>}>
              <For each={evidenceItems()} fallback={<div class="py-5 text-13-regular text-text-weak">{language.t("settings.research.evidence.empty")}</div>}>
                {(record) => (
                  <div class="flex flex-wrap items-start gap-3 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="truncate text-14-medium text-text-strong">{record.title ?? record.domain}</span>
                        <Tag>{identityLabel(record.sourceIdentity)}</Tag>
                        <Tag>{evidenceStatusLabel(record.evidenceStatus)}</Tag>
                      </div>
                      <div class="mt-1 break-all text-12-regular text-text-weak">{record.canonicalURL}</div>
                      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weaker">
                        <span>{language.t("settings.research.evidence.fetched", { time: dateTime(record.fetchedAt, language.intl()) })}</span>
                        <span>
                          {record.expiresAt && record.expiresAt <= Date.now()
                            ? language.t("settings.research.evidence.expired")
                            : language.t("settings.research.evidence.fresh")}
                        </span>
                        <span>{record.route}</span>
                      </div>
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => void refreshEvidence(record)}
                      disabled={busy() !== undefined}
                    >
                      {language.t("settings.research.evidence.refresh")}
                    </Button>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </SettingsSection>

        <SettingsSection
          title={language.t("settings.research.subscription.title")}
          description={language.t("settings.research.subscription.description")}
        >
          <SettingsList>
            <div class="border-b border-border-weak-base py-3">
              <div class="grid gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-12-medium text-text-weak md:col-span-2">
                  {language.t("settings.research.subscription.url")}
                  <TextField
                    value={subscriptionDraft.url}
                    onChange={(value) => setSubscriptionDraft("url", value)}
                    placeholder={language.t("settings.research.subscription.urlPlaceholder")}
                  />
                </label>
                <label class="flex flex-col gap-1 text-12-medium text-text-weak">
                  {language.t("settings.research.subscription.kind")}
                  <Select
                    options={subscriptionKindOptions()}
                    current={subscriptionKindOptions().find((item) => item.value === subscriptionDraft.kind)}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => item && setSubscriptionDraft("kind", item.value)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </label>
                <label class="flex flex-col gap-1 text-12-medium text-text-weak">
                  {language.t("settings.research.subscription.source")}
                  <Select
                    options={profileOptions()}
                    current={profileOptions().find((item) => item.value === subscriptionDraft.sourceProfileID)}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => item && setSubscriptionDraft("sourceProfileID", item.value)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </label>
              </div>
              <div class="mt-3 flex justify-end">
                <Button
                  data-action="settings-research-add-subscription"
                  size="small"
                  variant="secondary"
                  onClick={() => void addSubscription()}
                  disabled={busy() !== undefined}
                >
                  {language.t("settings.research.subscription.add")}
                </Button>
              </div>
            </div>

            <Show when={!subscriptions.loading} fallback={<div class="py-5 text-13-regular text-text-weak">{language.t("common.loading")}</div>}>
              <For each={subscriptionItems()} fallback={<div class="py-5 text-13-regular text-text-weak">{language.t("settings.research.subscription.empty")}</div>}>
                {(subscription) => (
                  <div class="border-b border-border-weak-base py-3 last:border-none">
                    <div class="flex flex-wrap items-start gap-3 sm:flex-nowrap">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <Tag>{subscriptionKindLabel(subscription.kind)}</Tag>
                          <Show when={subscription.failureSummary}>
                            {(summary) => <span class="text-11-regular text-status-warning">{summary()}</span>}
                          </Show>
                        </div>
                        <div class="mt-1 break-all text-12-regular text-text-strong">{subscription.url}</div>
                        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weaker">
                          <span>
                            {language.t("settings.research.subscription.lastChecked", {
                              time: dateTime(subscription.lastCheckedAt, language.intl()),
                            })}
                          </span>
                          <Show when={subscription.nextCheckAt}>
                            {(time) => <span>{language.t("settings.research.subscription.nextCheck", { time: dateTime(time(), language.intl()) })}</span>}
                          </Show>
                        </div>
                      </div>
                      <div class="flex shrink-0 flex-wrap items-center gap-2">
                        <Switch
                          checked={subscription.enabled}
                          onChange={(enabled) => void setSubscriptionEnabled(subscription, enabled)}
                          disabled={busy() !== undefined}
                          hideLabel
                        >
                          {subscription.url}
                        </Switch>
                        <Button size="small" variant="secondary" onClick={() => void refreshSubscription(subscription)} disabled={busy() !== undefined}>
                          {language.t("settings.research.subscription.refresh")}
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => setSelectedSubscriptionID((current) => (current === subscription.id ? undefined : subscription.id))}
                          disabled={busy() !== undefined}
                        >
                          {language.t("settings.research.subscription.changes")}
                        </Button>
                      </div>
                    </div>
                    <Show when={selectedSubscriptionID() === subscription.id}>
                      <div class="mt-3 rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2">
                        <div class="mb-2 text-12-medium text-text-strong">{language.t("settings.research.subscription.recentChanges")}</div>
                        <Show when={observations.error}>
                          {(error) => <div class="text-12-regular text-status-warning">{requestError(error())}</div>}
                        </Show>
                        <Show when={!observations.loading} fallback={<div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>}>
                          <For each={observations.latest ?? []} fallback={<div class="text-12-regular text-text-weak">{language.t("settings.research.subscription.changesEmpty")}</div>}>
                            {(observation) => (
                              <div class="border-t border-border-weak-base py-2 first:border-t-0">
                                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-12-regular text-text-weak">
                                  <span class={observation.changed ? "text-status-success" : "text-text-weak"}>
                                    {observation.changed
                                      ? language.t("settings.research.subscription.changed")
                                      : language.t("settings.research.subscription.unchanged")}
                                  </span>
                                  <span>{dateTime(observation.observedAt, language.intl())}</span>
                                </div>
                                <Show when={observation.title ?? observation.url}>
                                  {(text) => <div class="mt-1 break-all text-12-regular text-text-strong">{text()}</div>}
                                </Show>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </SettingsSection>
      </div>
    </div>
  )
}
