import type { Provider, ProviderModelsSuggestResponse } from "@lfcode-ai/sdk/v2/client"
import { Button } from "@lfcode-ai/ui/button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { Select } from "@lfcode-ai/ui/select"
import { List } from "@lfcode-ai/ui/list"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { createSignal, Show, type JSX, onCleanup } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"

type Props = {
  provider: Pick<Provider, "id" | "name" | "models">
}

type SuggestionPatch = {
  capabilities?: Record<string, unknown>
  limit?: Record<string, unknown>
  modalities?: { input?: unknown; output?: unknown }
  cost?: Record<string, unknown>
  reasoningOptions?: unknown
  reasoningModes?: unknown
  variantGroup?: "custom"
  variantOptions?: string[]
}

export function DialogAddModel(props: Props) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [modelID, setModelID] = createSignal("")
  const [displayName, setDisplayName] = createSignal("")
  const [suggestion, setSuggestion] = createSignal<ProviderModelsSuggestResponse>()
  const [selectedCandidateID, setSelectedCandidateID] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [discovered, setDiscovered] = createSignal<Array<ModelCandidate>>([])
  const [matches, setMatches] = createSignal<
    Array<{ providerID: string; providerName: string; modelID: string; displayName: string }>
  >([])
  const [discovering, setDiscovering] = createSignal(false)
  const [matching, setMatching] = createSignal(false)
  let matchTimer: ReturnType<typeof setTimeout> | undefined
  let matchRequest = 0
  onCleanup(() => clearTimeout(matchTimer))

  const selectedCandidate = () =>
    suggestion()?.candidates?.find((candidate) => candidate.providerID === selectedCandidateID())
  const patch = () => (selectedCandidate()?.patch ?? suggestion()?.patch ?? {}) as SuggestionPatch
  const modelName = () => displayName().trim() || modelID().trim()

  const inspect = async (event?: SubmitEvent) => {
    event?.preventDefault()
    const id = modelID().trim()
    if (!id) {
      setError(language.t("settings.models.addModel.error.required"))
      return
    }
    if (props.provider.models[id]) {
      setError(language.t("settings.models.addModel.error.duplicate"))
      return
    }

    setError(undefined)
    setSelectedCandidateID(undefined)
    setLoading(true)
    try {
      const result = await globalSDK.client.provider.models.suggest(
        {
          providerID: props.provider.id,
          providerName: props.provider.name,
          modelID: id,
          displayName: displayName().trim() || undefined,
        },
        { throwOnError: true },
      )
      setSuggestion(result.data)
    } catch (err) {
      setError(formatServerError(err, language.t, language.t("common.requestFailed")))
    } finally {
      setLoading(false)
    }
  }

  const matchLocal = (query: string) => {
    clearTimeout(matchTimer)
    const request = ++matchRequest
    if (query.trim().length < 2) {
      setMatches([])
      setMatching(false)
      return
    }
    matchTimer = setTimeout(async () => {
      setMatching(true)
      try {
        const result = await globalSDK.client.provider.models.match(
          { providerID: props.provider.id, query: query.trim() },
          { throwOnError: true },
        )
        if (request !== matchRequest) return
        setMatches(result.data.models)
      } catch {
        if (request === matchRequest) setMatches([])
      } finally {
        if (request === matchRequest) setMatching(false)
      }
    }, 220)
  }

  const discover = async () => {
    setDiscovering(true)
    setError(undefined)
    try {
      const result = await globalSDK.client.provider.models.discover(
        { providerID: props.provider.id },
        { throwOnError: true },
      )
      setDiscovered(result.data.models.map((item) => ({ id: item.id, name: item.name, protocol: item.protocol })))
      if (result.data.error) setError(`${result.data.error}; ${language.t("settings.models.addModel.fallback")}`)
    } catch (err) {
      setError(formatServerError(err, language.t, language.t("common.requestFailed")))
      setDiscovered([])
    } finally {
      setDiscovering(false)
    }
  }

  const selectModel = (id: string, name?: string) => {
    setModelID(id)
    if (name) setDisplayName(name)
    setSuggestion(undefined)
    setSelectedCandidateID(undefined)
    void inspect()
  }

  const save = async (acceptSuggestion: boolean) => {
    const id = modelID().trim()
    if (!id || saving()) return
    const next: Record<string, unknown> = {
      id,
      name: modelName(),
    }
    if (acceptSuggestion) {
      const nextPatch = patch()
      if (nextPatch.capabilities) next.capabilities = nextPatch.capabilities
      if (nextPatch.limit) next.limit = nextPatch.limit
      if (nextPatch.modalities) next.modalities = nextPatch.modalities
      if (nextPatch.cost) next.cost = nextPatch.cost
      if (nextPatch.variantGroup) next.variantGroup = nextPatch.variantGroup
      if (nextPatch.variantOptions?.length) next.variantOptions = nextPatch.variantOptions
    }

    setSaving(true)
    setError(undefined)
    try {
      await globalSDK.client.global.config.update({
        configPatch: {
          provider: {
            [props.provider.id]: {
              models: {
                [id]: next,
              },
            },
          },
        },
      })
      await globalSync.reloadProviders()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.models.addModel.toast.title"),
        description: language.t("settings.models.addModel.toast.description", { model: modelName() }),
      })
      dialog.close()
    } catch (err) {
      setError(formatServerError(err, language.t, language.t("common.requestFailed")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={language.t("settings.models.addModel.title")}
      description={language.t("settings.models.addModel.description", { provider: props.provider.name })}
      size="large"
    >
      <form onSubmit={inspect} class="flex flex-col gap-5 px-2.5 pb-3">
        <div class="flex flex-col gap-4">
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <TextField
                autofocus
                label={language.t("settings.models.addModel.id.label")}
                placeholder={language.t("settings.models.addModel.id.placeholder")}
                value={modelID()}
                onChange={(value) => {
                  setModelID(value)
                  setSuggestion(undefined)
                  setDiscovered([])
                  matchLocal(value)
                }}
                validationState={error() ? "invalid" : undefined}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              class="shrink-0"
              disabled={discovering()}
              onClick={() => void discover()}
            >
              {discovering()
                ? language.t("settings.models.addModel.discover.loading")
                : language.t("settings.models.addModel.discover.action")}
            </Button>
          </div>
          <TextField
            label={language.t("settings.models.addModel.name.label")}
            placeholder={language.t("settings.models.addModel.name.placeholder")}
            value={displayName()}
            onChange={(value) => {
              setDisplayName(value)
              setSuggestion(undefined)
            }}
          />
        </div>

        <Show when={error()}>{(message) => <p class="text-12-regular text-text-error">{message()}</p>}</Show>

        <Show when={matching()}>
          <span class="text-12-regular text-text-weak">
            {language.t("settings.models.addModel.match.loading")}
          </span>
        </Show>

        <Show when={discovered().length > 0 || matches().length > 0}>
          <div class="max-h-56 overflow-hidden rounded-lg border border-border-weak-base">
            <List
              class="max-h-56"
              search={false}
              items={() =>
                [...discovered(), ...matches().map((item) => ({
                  id: item.modelID,
                  name: item.displayName,
                  providerName: item.providerName,
                  providerID: item.providerID,
                }))].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
              }
              key={(item) => item.id}
              filterKeys={["id", "name", "providerName"]}
              emptyMessage={language.t("settings.models.addModel.match.empty")}
              onSelect={(item) => item && selectModel(item.id, item.name)}
            >
              {(item) => (
                <div class="flex w-full items-center justify-between gap-3">
                  <span class="truncate">{item.id}</span>
                  <span class="truncate text-12-regular text-text-weak">{item.name}</span>
                </div>
              )}
            </List>
          </div>
        </Show>

        <Show
          when={suggestion()}
          fallback={
            <Button type="submit" variant="primary" disabled={loading() || !modelID().trim()}>
              {loading()
                ? language.t("settings.models.addModel.inspect.loading")
                : language.t("settings.models.addModel.inspect.action")}
            </Button>
          }
        >
          <div class="flex flex-col gap-3 rounded-lg border border-border-weak-base bg-surface-base p-3">
            <div class="flex items-center justify-between gap-3">
              <span class="text-14-medium text-text-strong">
                {language.t("settings.models.addModel.suggestion.title")}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t(`settings.models.addModel.source.${suggestion()!.source}`)}
              </span>
            </div>
            <Show when={suggestion()!.warning}>
              {(warning) => <p class="text-12-regular text-text-warning">{warning()}</p>}
            </Show>
            <Show when={suggestion()!.candidates?.length}>
              <Select
                options={candidateOptions(
                  suggestion()!.candidates ?? [],
                  language.t("settings.models.suggestionConfirm.consensus"),
                )}
                current={candidateOptions(
                  suggestion()!.candidates ?? [],
                  language.t("settings.models.suggestionConfirm.consensus"),
                ).find((item) => item.value === (selectedCandidateID() ?? "consensus"))}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => setSelectedCandidateID(item?.value === "consensus" ? undefined : item?.value)}
                placeholder={language.t("settings.models.suggestionConfirm.candidate")}
                variant="secondary"
                size="small"
              />
            </Show>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SuggestionValue label={language.t("settings.models.addModel.suggestion.capabilities")}>
                <span>{formatRecord(patch().capabilities)}</span>
              </SuggestionValue>
              <SuggestionValue label={language.t("settings.models.addModel.suggestion.limit")}>
                <span>{formatRecord(patch().limit)}</span>
              </SuggestionValue>
              <SuggestionValue label={language.t("settings.models.addModel.suggestion.modalities")}>
                <span>{formatRecord(patch().modalities)}</span>
              </SuggestionValue>
              <SuggestionValue label={language.t("settings.models.addModel.suggestion.reasoning")}>
                <span>{formatValue(patch().reasoningOptions)}</span>
              </SuggestionValue>
              <SuggestionValue label={language.t("settings.models.addModel.suggestion.reasoningModes")}>
                <span>{formatReasoningModes(patch().reasoningModes)}</span>
              </SuggestionValue>
              <SuggestionValue label={language.t("settings.models.detectResult.variantOptions")}>
                <span>{formatValue(patch().variantOptions)}</span>
              </SuggestionValue>
            </div>
          </div>
          <div class="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" disabled={saving()} onClick={() => void save(false)}>
              {language.t("settings.models.addModel.reject")}
            </Button>
            <Button type="button" variant="primary" disabled={saving()} onClick={() => void save(true)}>
              {saving() ? language.t("settings.models.addModel.saving") : language.t("settings.models.addModel.accept")}
            </Button>
          </div>
        </Show>
      </form>
    </Dialog>
  )
}

type SuggestionCandidate = NonNullable<ProviderModelsSuggestResponse["candidates"]>[number]
type ModelCandidate = { id: string; name?: string; protocol?: string; providerID?: string; providerName?: string }

function candidateOptions(candidates: SuggestionCandidate[], consensus: string) {
  return [
    { value: "consensus", label: consensus },
    ...candidates.map((candidate) => ({
      value: candidate.providerID,
      label: `${candidate.providerName} · ${candidate.modelID}`,
    })),
  ]
}

function SuggestionValue(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-12-medium text-text-weak">{props.label}</span>
      <span class="truncate text-12-regular text-text-base">{props.children}</span>
    </div>
  )
}

function formatRecord(value: unknown): string {
  if (!value || typeof value !== "object") return "-"
  return Object.entries(value as Record<string, unknown>)
    .map(([key, next]) => `${key}: ${formatValue(next)}`)
    .join(", ")
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "-"
  if (value && typeof value === "object") return formatRecord(value)
  if (value === undefined || value === null || value === "") return "-"
  return String(value)
}

function formatReasoningModes(value: unknown): string {
  if (!Array.isArray(value)) return "-"
  return (
    value
      .map((mode) => {
        if (!mode || typeof mode !== "object") return String(mode)
        const record = mode as Record<string, unknown>
        const type = typeof record.type === "string" ? record.type : "mode"
        const values = Array.isArray(record.values) ? `: ${record.values.join(", ")}` : ""
        const range =
          typeof record.min === "number" || typeof record.max === "number"
            ? ` (${record.min ?? "-"}..${record.max ?? "-"})`
            : ""
        return `${type}${values}${range}`
      })
      .join("; ") || "-"
  )
}
