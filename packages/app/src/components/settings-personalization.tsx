import { type Component, type JSX, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { showToast } from "@lfcode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { SettingsList } from "./settings-list"
import {
  createPersonalizationDraft,
  personalizationDirty,
  personalizationMessages,
  personalizationSaveDisabled,
  serializePersonalizationInstructions,
  type PersonalizationDraft,
  type PersonalizationState,
} from "./settings-personalization-helpers"

export const SettingsPersonalization: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [saved, setSaved] = createSignal<PersonalizationDraft>()
  const [draft, setDraft] = createSignal<PersonalizationDraft>({
    customInstructions: "",
    tone: "friendly",
    memory: { ccIndex: false, autoConsolidation: true },
    maintenance: { enabled: true, schedulerEnabled: true, dreamEnabled: true, distillEnabled: true },
    contextReview: { enabled: true },
  })
  const [saveError, setSaveError] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)

  const [state, actions] = createResource(async () => {
    const result = await globalSDK.client.global.personalization.get()
    return result.data as PersonalizationState
  })

  createEffect(() => {
    const next = state.latest
    if (!next) return
    const normalized = createPersonalizationDraft(next)
    setSaved(normalized)
    setDraft(normalized)
    setSaveError(undefined)
  })

  const instructionFile = createMemo(() => state.latest?.instructionFile ?? "")
  const loadError = createMemo(() => {
    if (!state.error) return
    return formatServerError(state.error, language.t, language.t("common.requestFailed"))
  })
  const dirty = createMemo(() => personalizationDirty(saved(), draft()))
  const messages = createMemo(() => personalizationMessages(loadError(), saveError()))
  const saveDisabled = createMemo(() =>
    personalizationSaveDisabled({ saved: saved(), draft: draft(), loading: state.loading, saving: saving(), loadError: loadError() }),
  )

  const save = async () => {
    if (!dirty() || saving()) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await globalSDK.client.global.personalization.save({
        globalPersonalizationSave: {
          customInstructions: serializePersonalizationInstructions(draft().customInstructions, draft().tone),
          memory: { ccIndex: draft().memory.ccIndex, autoConsolidation: draft().memory.autoConsolidation },
          maintenance: { ...draft().maintenance, dreamEnabled: draft().memory.autoConsolidation },
          contextReview: draft().contextReview,
        },
      })
      await globalSDK.client.global.maintenance.scheduler
        .update({ enabled: draft().maintenance.enabled && draft().maintenance.schedulerEnabled })
        .catch(() => undefined)
      const normalized = createPersonalizationDraft(result.data as PersonalizationState)
      setSaved(normalized)
      setDraft(normalized)
      showToast({
        variant: "success",
        title: language.t("settings.personalization.toast.saved.title"),
        description: language.t("settings.personalization.toast.saved.description"),
      })
    } catch (error) {
      setSaveError(formatServerError(error, language.t, language.t("common.requestFailed")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto bg-background-base px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 -mx-4 border-b border-border-weaker-base bg-background-base px-4 sm:-mx-10 sm:px-10">
        <div class="mx-auto flex w-full max-w-[1080px] items-start justify-between gap-4 pb-6 pt-6">
          <div class="flex flex-col gap-1">
            <h2 class="text-20-medium text-text-strong">{language.t("settings.tab.personalization")}</h2>
            <p class="text-14-regular text-text-weak">{language.t("settings.personalization.description")}</p>
          </div>
          <Button size="large" variant="secondary" data-action="settings-personalization-save" disabled={saveDisabled()} onClick={() => void save()}>
            {saving() ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </div>

      <div class="mx-auto flex w-full max-w-[1080px] flex-col gap-10 pt-6">
        <Show when={messages().length > 0}>
          <div class="flex flex-col gap-3">{messages().map((message) => <SettingsMessage>{message}</SettingsMessage>)}</div>
        </Show>

        <SettingsSection title={language.t("settings.personalization.section.instructions.title")} description={language.t("settings.personalization.section.instructions.description")}>
          <SettingsList class="rounded-xl border border-border-weak-base bg-surface-base px-5 py-5">
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong">{language.t("settings.personalization.instructions.title")}</span>
                <span class="text-12-regular text-text-weak">{language.t("settings.personalization.instructions.description")} <span class="font-mono text-[11px] text-text-subtle">{instructionFile()}</span></span>
              </div>
              <div class="w-full rounded-lg border border-border-weak-base bg-background-stronger p-4">
                <textarea
                  data-action="settings-personalization-instructions"
                  class="min-h-[420px] w-full resize-y bg-transparent text-14-regular leading-6 text-text-strong outline-none"
                  value={draft().customInstructions}
                  onInput={(event) => setDraft((current) => ({ ...current, customInstructions: event.currentTarget.value }))}
                  placeholder={language.t("settings.personalization.instructions.placeholder")}
                />
              </div>
            </div>
          </SettingsList>
        </SettingsSection>

        <SettingsSection title={language.t("settings.personalization.section.memory.title")} description={language.t("settings.personalization.section.memory.description")}>
          <SettingsList class="rounded-xl border border-border-weak-base bg-surface-base px-5 py-2">
            <SettingsRow title={language.t("settings.personalization.memory.autoConsolidation.title")} description={language.t("settings.personalization.memory.autoConsolidation.description")}>
              <Switch
                data-action="settings-personalization-memory-auto-consolidation"
                checked={draft().memory.autoConsolidation}
                onChange={(checked) => setDraft((current) => ({ ...current, memory: { ...current.memory, autoConsolidation: checked }, maintenance: { ...current.maintenance, dreamEnabled: checked } }))}
              />
            </SettingsRow>
            <SettingsRow title={language.t("settings.personalization.contextReview.title")} description={language.t("settings.personalization.contextReview.description")}>
              <Switch
                data-action="settings-personalization-context-review"
                checked={draft().contextReview.enabled}
                onChange={(checked) => setDraft((current) => ({ ...current, contextReview: { enabled: checked } }))}
              />
            </SettingsRow>
            <SettingsRow title={language.t("settings.personalization.maintenance.enabled.title")} description={language.t("settings.personalization.maintenance.enabled.description")}>
              <Switch checked={draft().maintenance.enabled} onChange={(checked) => setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, enabled: checked } }))} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.personalization.maintenance.scheduler.title")} description={language.t("settings.personalization.maintenance.scheduler.description")}>
              <Switch checked={draft().maintenance.schedulerEnabled} disabled={!draft().maintenance.enabled} onChange={(checked) => setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, schedulerEnabled: checked } }))} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.personalization.maintenance.distill.title")} description={language.t("settings.personalization.maintenance.distill.description")}>
              <Switch checked={draft().maintenance.distillEnabled} disabled={!draft().maintenance.enabled} onChange={(checked) => setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, distillEnabled: checked } }))} />
            </SettingsRow>
          </SettingsList>
        </SettingsSection>

        <div class="flex items-start gap-3 rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-13-regular text-status-warning">
          <Icon name="warning" size="small" class="mt-0.5 shrink-0" />
          <span>{language.t("settings.personalization.tone.notice")}</span>
        </div>

        <SettingsSection title={language.t("settings.personalization.tone.title")} description={language.t("settings.personalization.tone.description")}>
          <SettingsList class="rounded-xl border border-border-weak-base bg-surface-base px-5 py-2">
            <SettingsRow title={language.t("settings.personalization.tone.row.title")} description={language.t("settings.personalization.tone.row.description")}>
              <Select
                data-action="settings-personalization-tone"
                options={[
                  { value: "friendly" as const, label: language.t("settings.personalization.tone.option.friendly") },
                  { value: "professional" as const, label: language.t("settings.personalization.tone.option.professional") },
                ]}
                current={{ value: draft().tone, label: language.t(`settings.personalization.tone.option.${draft().tone}`) }}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setDraft((current) => ({ ...current, tone: item.value }))}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>
          </SettingsList>
        </SettingsSection>

        <Show when={state.latest && !state.loading && !loadError()}>
          <div class="pb-2 text-12-regular text-text-weak">{language.t("settings.personalization.scope.note")}</div>
        </Show>
      </div>
    </div>
  )
}

const SettingsMessage: Component<{ children: JSX.Element }> = (props) => {
  return <div class="rounded-lg border border-border-weak-base bg-surface-base px-4 py-4 text-14-regular text-status-warning">{props.children}</div>
}

const SettingsRow: Component<{ title: string | JSX.Element; description: string | JSX.Element; children: JSX.Element }> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

const SettingsSection: Component<{ title: string; description?: string | JSX.Element; children: JSX.Element }> = (props) => {
  return (
    <div class="flex flex-col gap-1">
      <h3 class="pb-2 text-16-medium text-text-strong">{props.title}</h3>
      <Show when={props.description}>{(value) => <div class="pb-2 text-13-regular text-text-weak">{value()}</div>}</Show>
      {props.children}
    </div>
  )
}
