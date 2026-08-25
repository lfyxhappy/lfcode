import type { ProviderModelsSuggestResponse } from "@lfcode-ai/sdk/v2/client"
import { Button } from "@lfcode-ai/ui/button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { Select } from "@lfcode-ai/ui/select"
import { For, Show } from "solid-js"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"

export type ModelSuggestionRow = {
  modelID: string
  displayName: string
  suggestion: ProviderModelsSuggestResponse
}

export function DialogModelSuggestionConfirm(props: {
  rows: ModelSuggestionRow[]
  onConfirm: (accept: boolean, candidates: Record<string, ModelSuggestionCandidate>) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [selected, setSelected] = createSignal<Record<string, string>>({})

  const confirm = (accept: boolean) => {
    dialog.close()
    const candidates = Object.fromEntries(
      props.rows.flatMap((row) => {
        const selectedID = selected()[row.modelID]
        const candidate = row.suggestion.candidates?.find((item) => item.providerID === selectedID)
        return candidate ? [[row.modelID, candidate]] : []
      }),
    ) as Record<string, ModelSuggestionCandidate>
    props.onConfirm(accept, candidates)
  }

  return (
    <Dialog
      title={language.t("settings.models.suggestionConfirm.title")}
      description={language.t("settings.models.suggestionConfirm.description")}
      size="large"
    >
      <div class="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-2.5 pb-3">
        <For each={props.rows}>
          {(row) => (
            <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-14-medium text-text-strong">{row.displayName}</div>
                  <div class="truncate text-12-regular text-text-weak">{row.modelID}</div>
                </div>
                <span class="shrink-0 text-12-regular text-text-weak">
                  {language.t(`settings.models.addModel.source.${row.suggestion.source}`)}
                </span>
              </div>
              <Show when={row.suggestion.warning}>
                {(warning) => <div class="text-12-regular text-text-warning">{warning()}</div>}
              </Show>
              <div class="text-12-regular text-text-base">{formatPatch(row.suggestion.patch)}</div>
              <Show when={row.suggestion.candidates?.length}>
                <Select
                  options={candidateOptions(row.suggestion.candidates ?? [], language.t("settings.models.suggestionConfirm.consensus"))}
                  current={candidateOptions(row.suggestion.candidates ?? [], language.t("settings.models.suggestionConfirm.consensus")).find(
                    (item) => item.value === (selected()[row.modelID] ?? "consensus"),
                  )}
                  value={(item) => item.value}
                  label={(item) => item.label}
                  onSelect={(item) => setSelected((previous) => ({ ...previous, [row.modelID]: item?.value ?? "consensus" }))}
                  placeholder={language.t("settings.models.suggestionConfirm.candidate")}
                  variant="secondary"
                  size="small"
                />
              </Show>
            </div>
          )}
        </For>
        <div class="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => confirm(false)}>
            {language.t("settings.models.suggestionConfirm.reject")}
          </Button>
          <Button type="button" variant="primary" onClick={() => confirm(true)}>
            {language.t("settings.models.suggestionConfirm.accept")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

type ModelSuggestionCandidate = NonNullable<ProviderModelsSuggestResponse["candidates"]>[number]

function candidateOptions(candidates: ModelSuggestionCandidate[], consensus: string) {
  return [
    { value: "consensus", label: consensus },
    ...candidates.map((candidate) => ({
      value: candidate.providerID,
      label: `${candidate.providerName} · ${candidate.modelID}`,
    })),
  ]
}

function formatPatch(patch: Record<string, unknown>) {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(" · ")
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ")
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}=${formatValue(item)}`)
      .join(", ")
  }
  return String(value)
}
