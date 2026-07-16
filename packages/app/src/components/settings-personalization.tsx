import { type Component, type JSX, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { Button } from "@lfcode-ai/ui/button"
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
  type PersonalizationDraft,
  type PersonalizationState,
} from "./settings-personalization-helpers"

export const SettingsPersonalization: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [saved, setSaved] = createSignal<PersonalizationDraft>()
  const [draft, setDraft] = createSignal<PersonalizationDraft>({
    customInstructions: "",
    memory: {
      ccIndex: false,
      autoConsolidation: true,
    },
    maintenance: {
      enabled: true,
      schedulerEnabled: true,
      dreamEnabled: true,
      distillEnabled: true,
    },
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
    personalizationSaveDisabled({
      saved: saved(),
      draft: draft(),
      loading: state.loading,
      saving: saving(),
      loadError: loadError(),
    }),
  )

  const save = async () => {
    if (!dirty() || saving()) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await globalSDK.client.global.personalization.save({
        globalPersonalizationSave: {
          customInstructions: draft().customInstructions,
          memory: {
            ccIndex: draft().memory.ccIndex,
            autoConsolidation: draft().maintenance.dreamEnabled,
          },
          maintenance: draft().maintenance,
        },
      })
      const next = result.data as PersonalizationState
      await globalSDK.client.global.maintenance.scheduler
        .update({ enabled: draft().maintenance.enabled && draft().maintenance.schedulerEnabled })
        .catch(() => undefined)
      const normalized = createPersonalizationDraft(next)
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
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[980px] items-start justify-between gap-4 pb-6 pt-6">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.personalization")}</h2>
            <p class="text-14-regular text-text-weak">{language.t("settings.personalization.description")}</p>
          </div>
          <Button
            size="large"
            variant="secondary"
            data-action="settings-personalization-save"
            disabled={saveDisabled()}
            onClick={() => void save()}
          >
            {saving() ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </div>

      <div class="max-w-[980px]">
        <Show when={messages().length > 0}>
          <div class="mb-4 flex flex-col gap-3">
            {messages().map((message) => (
              <SettingsMessage>{message}</SettingsMessage>
            ))}
          </div>
        </Show>

        <div class="flex flex-col gap-8">
          <SettingsSection
            title={language.t("settings.personalization.section.instructions.title")}
            description={language.t("settings.personalization.section.instructions.description")}
          >
            <SettingsList>
              <SettingsRow
                title={language.t("settings.personalization.instructions.title")}
                description={
                  <>
                    {language.t("settings.personalization.instructions.description")}{" "}
                    <span class="font-mono text-[11px] text-text-subtle">{instructionFile()}</span>
                  </>
                }
              >
                <div class="w-full max-w-[540px] rounded-[18px] bg-surface-base p-3">
                  <textarea
                    data-action="settings-personalization-instructions"
                    class="min-h-[220px] w-full resize-y bg-transparent text-13-regular text-text-strong outline-none"
                    value={draft().customInstructions}
                    onInput={(event) =>
                      setDraft((current) => ({
                        ...current,
                        customInstructions: event.currentTarget.value,
                      }))
                    }
                    placeholder={language.t("settings.personalization.instructions.placeholder")}
                  />
                </div>
              </SettingsRow>
            </SettingsList>
          </SettingsSection>

          <SettingsSection
            title={language.t("settings.personalization.section.memory.title")}
            description={language.t("settings.personalization.section.memory.description")}
          >
            <SettingsList>
              <SettingsRow
                title={language.t("settings.personalization.memory.ccIndex.title")}
                description={language.t("settings.personalization.memory.ccIndex.description")}
              >
                <div data-action="settings-personalization-memory-cc-index">
                  <Switch
                    checked={draft().memory.ccIndex}
                    onChange={(checked) =>
                      setDraft((current) => ({
                        ...current,
                        memory: {
                          ...current.memory,
                          ccIndex: checked,
                        },
                      }))
                    }
                  />
                </div>
              </SettingsRow>

            </SettingsList>
          </SettingsSection>

          <SettingsSection
            title={language.t("settings.personalization.section.maintenance.title")}
            description={language.t("settings.personalization.section.maintenance.description")}
          >
            <SettingsList>
              <SettingsRow
                title={language.t("settings.personalization.maintenance.enabled.title")}
                description={language.t("settings.personalization.maintenance.enabled.description")}
              >
                <Switch
                  checked={draft().maintenance.enabled}
                  onChange={(checked) =>
                    setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, enabled: checked } }))
                  }
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.personalization.maintenance.scheduler.title")}
                description={language.t("settings.personalization.maintenance.scheduler.description")}
              >
                <Switch
                  checked={draft().maintenance.schedulerEnabled}
                  disabled={!draft().maintenance.enabled}
                  onChange={(checked) =>
                    setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, schedulerEnabled: checked } }))
                  }
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.personalization.maintenance.dream.title")}
                description={language.t("settings.personalization.maintenance.dream.description")}
              >
                <Switch
                  checked={draft().maintenance.dreamEnabled}
                  disabled={!draft().maintenance.enabled}
                  onChange={(checked) =>
                    setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, dreamEnabled: checked } }))
                  }
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.personalization.maintenance.distill.title")}
                description={language.t("settings.personalization.maintenance.distill.description")}
              >
                <Switch
                  checked={draft().maintenance.distillEnabled}
                  disabled={!draft().maintenance.enabled}
                  onChange={(checked) =>
                    setDraft((current) => ({ ...current, maintenance: { ...current.maintenance, distillEnabled: checked } }))
                  }
                />
              </SettingsRow>
            </SettingsList>
          </SettingsSection>

          <Show when={state.latest && !state.loading && !loadError()}>
            <SettingsSection
              title={language.t("settings.personalization.section.scope.title")}
              description={language.t("settings.personalization.section.scope.description")}
            >
              <SettingsList>
                <div class="px-4 py-3 text-12-regular text-text-weak">
                  {language.t("settings.personalization.scope.note")}
                </div>
              </SettingsList>
            </SettingsSection>
          </Show>
        </div>
      </div>
    </div>
  )
}

const SettingsMessage: Component<{ children: JSX.Element }> = (props) => {
  return (
    <div class="mb-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-4 text-14-regular text-status-warning">
      {props.children}
    </div>
  )
}

const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}> = (props) => {
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

const SettingsSection: Component<{
  title: string
  description?: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-col gap-1">
      <h3 class="pb-2 text-14-medium text-text-strong">{props.title}</h3>
      <Show when={props.description}>
        {(value) => <div class="pb-2 text-12-regular text-text-weak">{value()}</div>}
      </Show>
      {props.children}
    </div>
  )
}
