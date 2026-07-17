import { useFilteredList } from "@lfcode-ai/ui/hooks"
import { ProviderIcon } from "@lfcode-ai/ui/provider-icon"
import { Button } from "@lfcode-ai/ui/button"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { TextField } from "@lfcode-ai/ui/text-field"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { showToast } from "@lfcode-ai/ui/toast"
import { type Component, createMemo, createSignal, For, type JSX, Show } from "solid-js"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders } from "@/hooks/use-providers"
import { formatServerError } from "@/utils/server-errors"
import { DialogRemoveProvider } from "./dialog-delete-custom-provider"
import { DialogModelDetectResult } from "./dialog-model-detect-result"
import { DialogModelLimitEditor } from "./dialog-model-limit-editor"
import { DialogSelectProvider } from "./dialog-select-provider"
import { SettingsList } from "./settings-list"
import {
  SUBAGENT_FIELDS,
  subagentModelPatch,
  subagentModelValue,
  type ModelDetectResult,
  type ModelDetectState,
  type SubagentField,
} from "./settings-models-helpers"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ConfigModelField = "model" | "small_model"
type ModelOption = {
  value: string
  label: string
  provider: string
  providerID?: string
  custom?: boolean
}

const ListLoadingState: Component<{ label: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.label}</span>
    </div>
  )
}

const ListEmptyState: Component<{ message: string; filter: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.message}</span>
      <Show when={props.filter}>
        <span class="text-14-regular text-text-strong mt-1">&quot;{props.filter}&quot;</span>
      </Show>
    </div>
  )
}

const SettingsRow: Component<{ title: string; description: string | JSX.Element; children: JSX.Element }> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

export const SettingsModels: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const models = useModels()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const [saving, setSaving] = createSignal<ConfigModelField | SubagentField>()
  const [detecting, setDetecting] = createSignal<Record<string, ModelDetectState>>({})
  const [detectResults, setDetectResults] = createSignal<Record<string, ModelDetectResult>>({})

  const modelValue = (item: ModelItem) => `${item.provider.id}/${item.id}`
  const reopenSettingsModels = () => {
    void import("./dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings defaultValue="models" />)
    })
  }

  const openDetectResult = (item: ModelItem, result: ModelDetectResult) => {
    dialog.show(() => <DialogModelDetectResult modelName={item.name} result={result} />)
  }

  const baseOptions = createMemo<ModelOption[]>(() =>
    models
      .list()
      .map((item) => ({
        value: modelValue(item),
        label: item.name,
        provider: item.provider.name,
        providerID: item.provider.id,
      }))
      .sort((a, b) => {
        const aIndex = popularProviders.indexOf(a.providerID ?? "")
        const bIndex = popularProviders.indexOf(b.providerID ?? "")
        const aPopular = aIndex >= 0
        const bPopular = bIndex >= 0

        if (aPopular && !bPopular) return -1
        if (!aPopular && bPopular) return 1
        if (aPopular && bPopular && aIndex !== bIndex) return aIndex - bIndex
        if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
        return a.label.localeCompare(b.label)
      }),
  )

  const options = createMemo<ModelOption[]>(() => {
    const seen = new Set(baseOptions().map((item) => item.value))
    const current = [
      globalSync.data.config.model,
      globalSync.data.config.small_model,
      ...SUBAGENT_FIELDS.map((field) => subagentModelValue(globalSync.data.config, field)),
    ]
      .filter((value): value is string => !!value && !seen.has(value))
      .map(
        (value) =>
          ({
            value,
            label: value,
            provider: language.t("settings.models.group.currentConfig"),
            custom: true,
          }) satisfies ModelOption,
      )
    return [...current, ...baseOptions()]
  })

  const subagentOptions = createMemo<ModelOption[]>(() => [
    {
      value: "",
      label: language.t("settings.models.subagent.inherit"),
      provider: language.t("settings.models.group.currentConfig"),
    },
    ...options(),
  ])

  const currentOption = (field: ConfigModelField) => {
    const value = globalSync.data.config[field]
    if (!value) return
    return (
      options().find((item) => item.value === value) ?? {
        value,
        label: value,
        provider: language.t("settings.models.group.currentConfig"),
        custom: true,
      }
    )
  }

  const currentSubagentOption = (field: SubagentField) => {
    const value = subagentModelValue(globalSync.data.config, field)
    if (!value) return subagentOptions()[0]
    return (
      subagentOptions().find((item) => item.value === value) ?? {
        value,
        label: value,
        provider: language.t("settings.models.group.currentConfig"),
        custom: true,
      }
    )
  }

  const saveModel = async (field: ConfigModelField, option: ModelOption | undefined) => {
    if (!option) return
    if (globalSync.data.config[field] === option.value) return
    if (saving()) return

    setSaving(field)
    await globalSync
      .updateConfig({ [field]: option.value })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.models.toast.updated.title"),
          description:
            field === "model"
              ? language.t("settings.models.toast.default.description", { model: option.label })
              : language.t("settings.models.toast.small.description", { model: option.label }),
        })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      })
      .finally(() => setSaving(undefined))
  }

  const saveSubagentModel = async (field: SubagentField, option: ModelOption | undefined) => {
    if (!option) return
    const current = subagentModelValue(globalSync.data.config, field)
    if (current === option.value) return
    if (saving()) return

    setSaving(field)
    await globalSync
      .updateConfig(subagentModelPatch(field, option.value))
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.models.toast.updated.title"),
          description: language.t("settings.models.toast.subagentUpdated.description", {
            agent: language.t(`settings.models.subagent.${field}.title`),
            model: option.label,
          }),
        })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      })
      .finally(() => setSaving(undefined))
  }

  const detectModel = async (item: ModelItem) => {
    const key = `${item.provider.id}:${item.id}`
    if (detecting()[key] === "running") return
    setDetecting((prev) => ({ ...prev, [key]: "running" }))

    try {
      const result = await globalSDK.client.provider.model.detect({
        providerID: item.provider.id,
        modelID: item.id,
      })
      if (result.data) {
        setDetectResults((prev) => ({ ...prev, [key]: result.data }))
      }
      setDetecting((prev) => ({ ...prev, [key]: result.data?.saved ? "success" : "error" }))
      await globalSync.reloadProviders()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: item.name,
        description: result.data?.warnings?.length
          ? result.data.warnings.join(" ")
          : language.t("settings.models.toast.capabilities.description", { model: item.name }),
      })
      if (result.data) openDetectResult(item, result.data)
      return
    } catch (err) {
      setDetecting((prev) => ({ ...prev, [key]: "error" }))
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    }
  }

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col w-full max-w-[1440px] mx-auto gap-4 pt-6 pb-6">
          <div>
            <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
            <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.models.description")}</p>
          </div>
          <div class="flex justify-start">
            <Button
              size="large"
              variant="secondary"
              icon="plus-small"
              onClick={() => {
                dialog.show(() => <DialogSelectProvider returnTo="settings-models" />)
              }}
            >
              {language.t("settings.models.action.addProvider")}
            </Button>
          </div>
          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={list.filter()}
              onChange={list.onInput}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={list.filter()}>
              <IconButton icon="circle-x" variant="ghost" aria-label={language.t("common.clearSearch")} onClick={list.clear} />
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col w-full max-w-[1440px] mx-auto gap-8">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.models.section.defaults")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.models.default.title")}
              description={language.t("settings.models.default.description")}
            >
              <Select
                data-action="settings-default-model"
                options={options()}
                current={currentOption("model")}
                value={(item) => item.value}
                label={(item) => item.label}
                groupBy={(item) => item.provider}
                onSelect={(item) => void saveModel("model", item)}
                placeholder={language.t("settings.models.default.placeholder")}
                disabled={saving() !== undefined || options().length === 0}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "260px", "max-width": "360px" }}
                valueClass="truncate"
              >
                {(item) => (
                  <div class="flex min-w-0 items-center gap-2">
                    <Show when={item?.providerID}>
                      {(providerID) => <ProviderIcon id={providerID()} class="size-4 shrink-0 icon-weak-base" />}
                    </Show>
                    <span class="truncate">{item?.label}</span>
                  </div>
                )}
              </Select>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.models.small.title")}
              description={language.t("settings.models.small.description")}
            >
              <Select
                data-action="settings-small-model"
                options={options()}
                current={currentOption("small_model")}
                value={(item) => item.value}
                label={(item) => item.label}
                groupBy={(item) => item.provider}
                onSelect={(item) => void saveModel("small_model", item)}
                placeholder={language.t("settings.models.small.placeholder")}
                disabled={saving() !== undefined || options().length === 0}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "260px", "max-width": "360px" }}
                valueClass="truncate"
              >
                {(item) => (
                  <div class="flex min-w-0 items-center gap-2">
                    <Show when={item?.providerID}>
                      {(providerID) => <ProviderIcon id={providerID()} class="size-4 shrink-0 icon-weak-base" />}
                    </Show>
                    <span class="truncate">{item?.label}</span>
                  </div>
                )}
              </Select>
            </SettingsRow>
            <For each={SUBAGENT_FIELDS}>
              {(field) => (
                <SettingsRow
                  title={language.t(`settings.models.subagent.${field}.title`)}
                  description={language.t(`settings.models.subagent.${field}.description`)}
                >
                  <Select
                    data-action={`settings-subagent-model-${field}`}
                    options={subagentOptions()}
                    current={currentSubagentOption(field)}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    groupBy={(item) => item.provider}
                    onSelect={(item) => void saveSubagentModel(field, item)}
                    placeholder={language.t("settings.models.subagent.inherit")}
                    disabled={saving() !== undefined || subagentOptions().length === 0}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    triggerStyle={{ "min-width": "260px", "max-width": "360px" }}
                    valueClass="truncate"
                  >
                    {(item) => (
                      <div class="flex min-w-0 items-center gap-2">
                        <Show when={item?.providerID}>
                          {(providerID) => <ProviderIcon id={providerID()} class="size-4 shrink-0 icon-weak-base" />}
                        </Show>
                        <span class="truncate">{item?.label}</span>
                      </div>
                    )}
                  </Select>
                </SettingsRow>
              )}
            </For>
          </SettingsList>
        </div>

        <Show
          when={!list.grouped.loading}
          fallback={
            <ListLoadingState label={`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`} />
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={<ListEmptyState message={language.t("dialog.model.empty")} filter={list.filter()} />}
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center justify-between gap-3 pb-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <ProviderIcon id={group.category} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong truncate">{group.items[0].provider.name}</span>
                    </div>
                    <Tooltip
                      placement="top"
                      value={language.t("dialog.model.manage.provider.delete", {
                        provider: group.items[0].provider.name,
                      })}
                    >
                      <IconButton
                        tabIndex={-1}
                        icon="trash"
                        variant="ghost"
                        aria-label={language.t("dialog.model.manage.provider.delete", {
                          provider: group.items[0].provider.name,
                        })}
                        onClick={() =>
                          dialog.show(() => (
                            <DialogRemoveProvider
                              providerID={group.category}
                              providerName={group.items[0].provider.name}
                              onClose={reopenSettingsModels}
                            />
                          ))
                        }
                      />
                    </Tooltip>
                  </div>
                  <SettingsList>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        const detectKey = `${item.provider.id}:${item.id}`
                        return (
                          <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                            <div class="min-w-0 flex-1">
                              <span class="text-14-regular text-text-strong truncate block">{item.name}</span>
                            </div>
                            <div class="flex flex-shrink-0 items-center gap-2">
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() =>
                                  dialog.show(() => (
                                    <DialogModelLimitEditor
                                      providerID={item.provider.id}
                                      providerName={item.provider.name}
                                      modelID={item.id}
                                      modelName={item.name}
                                      current={{
                                        context: item.limit?.context,
                                        output: item.limit?.output,
                                      }}
                                    />
                                  ))
                                }
                              >
                                {language.t("settings.models.limitEditor.action")}
                              </Button>
                              <Button
                                size="small"
                                variant="secondary"
                                disabled={detecting()[detectKey] === "running"}
                                onClick={() => {
                                  const result = detectResults()[detectKey]
                                  if (detecting()[detectKey] === "success" && result) {
                                    openDetectResult(item, result)
                                    return
                                  }
                                  void detectModel(item)
                                }}
                              >
                                {detecting()[detectKey] === "running"
                                  ? language.t("settings.models.detect.running")
                                  : detecting()[detectKey] === "success"
                                    ? language.t("settings.models.detect.success")
                                    : detecting()[detectKey] === "error"
                                      ? language.t("settings.models.detect.retry")
                                      : language.t("settings.models.detect.action")}
                              </Button>
                              <Switch
                                checked={models.visible(key)}
                                onChange={(checked) => {
                                  models.setVisibility(key, checked)
                                }}
                                hideLabel
                              >
                                {item.name}
                              </Switch>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </SettingsList>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}
