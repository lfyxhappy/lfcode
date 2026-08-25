import { Button } from "@lfcode-ai/ui/button"
import type { ProviderA6ApiModelsDiscoverResponse, ProviderModelsSuggestResponse } from "@lfcode-ai/sdk/v2/client"
import { RadioGroup } from "@lfcode-ai/ui/radio-group"
import { Select } from "@lfcode-ai/ui/select"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { ProviderIcon } from "@lfcode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { batch, createSignal, For, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import {
  A6API_MODEL_PROTOCOLS,
  A6API_PROVIDER_ID,
  apiKeyForPresetChange,
  type A6ApiDiscoveredModel,
  CAPABILITY_KEYS,
  type CapabilityKey,
  CUSTOM_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_PRESET_OPTIONS,
  type CustomProviderPresetID,
  inferCapabilities,
  type FormState,
  headerRow,
  mergeA6ApiModelRows,
  modelRow,
  presetModelRow,
  PROTOCOLS,
  validateCustomProvider,
} from "./dialog-custom-provider-form"
import { OPENCODE_GO_PRESET_ID, OPENCODE_GO_PROVIDER_ID } from "@lfcode-ai/shared/opencode-go"
import { OPENCODE_PRESET_ID } from "@lfcode-ai/shared/opencode"
import { DialogSelectProvider } from "./dialog-select-provider"
import { Icon } from "@lfcode-ai/ui/icon"
import { DialogModelSuggestionConfirm, type ModelSuggestionRow } from "./dialog-model-suggestion-confirm"

type Props = {
  back?: "providers" | "close"
  returnTo?: "models" | "settings-models"
  preset?: CustomProviderPresetID
}

type ValidatedCustomProvider = NonNullable<NonNullable<ReturnType<typeof validateCustomProvider>>["result"]>

type A6ApiDiscoverResult = ProviderA6ApiModelsDiscoverResponse

function initialFormState(presetID?: CustomProviderPresetID): FormState {
  const preset = CUSTOM_PROVIDER_PRESETS.find((item) => item.id === presetID)
  if (preset) {
    return {
      preset: preset.id,
      protocol: preset.protocol,
      providerID: preset.providerID,
      name: preset.name,
      baseURL: preset.baseURL,
      apiKey: "",
      models: preset.models.map((model) => presetModelRow(model, preset.protocol)),
      headers: [headerRow()],
      err: {},
    }
  }

  return {
    preset: "custom",
    protocol: "openai-chat",
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow("openai-chat")],
    headers: [headerRow()],
    err: {},
  }
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [form, setForm] = createStore<FormState>(initialFormState(props.preset))
  const [suggesting, setSuggesting] = createSignal(false)
  const [discovering, setDiscovering] = createSignal(false)
  const [apiKeyError, setApiKeyError] = createSignal<string>()
  const standaloneA6Api = () => props.preset === A6API_PROVIDER_ID
  const standaloneOpenCodeGo = () => props.preset === OPENCODE_GO_PRESET_ID
  const standaloneOpenCode = () => props.preset === OPENCODE_PRESET_ID
  const standaloneCatalog = () => standaloneA6Api() || standaloneOpenCodeGo() || standaloneOpenCode()

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider returnTo={props.returnTo} />)
  }

  const showModels = () => {
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  const showSettingsModels = () => {
    void import("./dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings defaultValue="models" />)
    })
  }

  const addModel = () => {
    if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow(form.protocol))
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") {
      setApiKeyError()
      return
    }
    if (form.providerID !== A6API_PROVIDER_ID || key === "providerID") setForm("preset", "custom")
    setForm("err", key, undefined)
  }

  const applyCapabilityInference = (index: number, patch: Partial<{ id: string; name: string; protocol: FormState["protocol"] }> = {}) => {
    const current = form.models[index]
    if (!current) return
    const next = inferCapabilities({
      id: patch.id ?? current.id,
      name: patch.name ?? current.name,
      providerID: form.providerID,
      protocol: patch.protocol ?? current.protocol ?? form.protocol,
      current: current.capabilities,
      manual: current.manual,
    })
    for (const key of CAPABILITY_KEYS) {
      if (current.manual[key]) continue
      setForm("models", index, "capabilities", key, next[key])
    }
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
      applyCapabilityInference(index, { [key]: value })
    })
  }

  const setModelLimit = (index: number, key: "context" | "output", value: string) => {
    batch(() => {
      if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
      setForm("models", index, "limit", key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setModelProtocol = (index: number, protocol: FormState["protocol"]) => {
    batch(() => {
      if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
      setForm("models", index, "protocol", protocol)
      applyCapabilityInference(index, { protocol })
    })
  }

  const toggleCapability = (index: number, key: CapabilityKey, checked: boolean) => {
    batch(() => {
      if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
      setForm("models", index, "capabilities", key, checked)
      setForm("models", index, "manual", key, true)
    })
  }

  const setProtocol = (value: FormState["protocol"]) => {
    batch(() => {
      if (form.providerID !== A6API_PROVIDER_ID) setForm("preset", "custom")
      setForm("protocol", value)
      for (const [index, model] of form.models.entries()) {
        setForm("models", index, "protocol", value)
        const next = inferCapabilities({
          id: model.id,
          name: model.name,
          providerID: form.providerID,
          protocol: value,
          current: model.capabilities,
          manual: model.manual,
        })
        for (const key of CAPABILITY_KEYS) {
          if (model.manual[key]) continue
          setForm("models", index, "capabilities", key, next[key])
        }
      }
    })
  }

  const setPreset = (value: CustomProviderPresetID) => {
    if (value === "custom") {
      batch(() => {
        setForm("apiKey", apiKeyForPresetChange({ current: form.preset, next: value, apiKey: form.apiKey }))
        setForm("preset", "custom")
      })
      return
    }
    const preset = CUSTOM_PROVIDER_PRESETS.find((item) => item.id === value)
    if (!preset) return

    batch(() => {
      setForm("preset", preset.id)
      setForm("protocol", preset.protocol)
      setForm("providerID", preset.providerID)
      setForm("name", preset.name)
      setForm("baseURL", preset.baseURL)
      setForm("apiKey", apiKeyForPresetChange({ current: form.preset, next: preset.id, apiKey: form.apiKey }))
      setForm(
        "models",
        preset.models.map((model) => presetModelRow(model, preset.protocol)),
      )
      setForm("err", {})
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const fetchA6ApiModels = async () => {
    const apiKey = form.apiKey.trim()
    const response = apiKey
      ? await globalSDK.client.provider.a6Api.models.discover({ apiKey }, { throwOnError: true })
      : await globalSDK.client.provider.a6Api.models.list(undefined, { throwOnError: true })
    if (!response.data) throw new Error("A6API discovery returned no data")
    if (!response.data.ok) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t(`provider.custom.a6api.error.${response.data.error}`),
      })
      return
    }
    return response.data.models
  }

  const fetchOpenCodeGoModels = async () => {
    const apiKey = form.apiKey.trim()
    const response = apiKey
      ? await globalSDK.client.provider.opencodeGo.models.discover({ apiKey }, { throwOnError: true })
      : await globalSDK.client.provider.opencodeGo.models.list(undefined, { throwOnError: true })
    if (!response.data) throw new Error("OpenCode Go discovery returned no data")
    if (!response.data.ok) {
      showToast({ title: language.t("common.requestFailed"), description: language.t(`provider.custom.opencodeGo.error.${response.data.error}`) })
      return
    }
    return response.data.models
  }

  const fetchOpenCodeModels = async () => {
    const apiKey = form.apiKey.trim()
    const response = apiKey
      ? await globalSDK.client.provider.opencode.models.discover({ apiKey }, { throwOnError: true })
      : await globalSDK.client.provider.opencode.models.list(undefined, { throwOnError: true })
    if (!response.data) throw new Error("OpenCode discovery returned no data")
    if (!response.data.ok) {
      showToast({ title: language.t("common.requestFailed"), description: language.t(`provider.custom.opencode.error.${response.data.error}`) })
      return
    }
    return response.data.models
  }

  const discoverA6ApiModels = async () => {
    if (discovering()) return
    setDiscovering(true)
    try {
      const models = await fetchA6ApiModels()
      if (models) setForm("models", mergeA6ApiModelRows({ current: form.models, discovered: models, providerID: form.providerID }))
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setDiscovering(false)
    }
  }

  const discoverOpenCodeGoModels = async () => {
    if (discovering()) return
    setDiscovering(true)
    try {
      const models = await fetchOpenCodeGoModels()
      if (models) setForm("models", mergeA6ApiModelRows({ current: form.models, discovered: models, providerID: form.providerID }))
    } catch (err) {
      showToast({ title: language.t("common.requestFailed"), description: formatServerError(err, language.t, language.t("common.requestFailed")) })
    } finally {
      setDiscovering(false)
    }
  }

  const discoverOpenCodeModels = async () => {
    if (discovering()) return
    setDiscovering(true)
    try {
      const models = await fetchOpenCodeModels()
      if (models) setForm("models", mergeA6ApiModelRows({ current: form.models, discovered: models, providerID: form.providerID }))
    } catch (err) {
      showToast({ title: language.t("common.requestFailed"), description: formatServerError(err, language.t, language.t("common.requestFailed")) })
    } finally {
      setDiscovering(false)
    }
  }

  onMount(() => {
    if (standaloneA6Api()) void discoverA6ApiModels()
    if (standaloneOpenCodeGo()) void discoverOpenCodeGoModels()
    if (standaloneOpenCode()) void discoverOpenCodeModels()
  })

  const validate = () => {
    const existingProviderIDs = new Set(globalSync.data.provider.all.map((p) => p.id))
    if (standaloneCatalog()) existingProviderIDs.delete(form.providerID)
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs,
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      await globalSDK.client.global.config.upsertCustomProvider({
        providerID: result.providerID,
        provider: result.config,
        key: result.key,
      })
      await globalSync.reloadProviders()
      return result
    },
    onSuccess: (result) => {
      if (props.returnTo === "models") {
        showModels()
      } else if (props.returnTo === "settings-models") {
        showSettingsModels()
      } else {
        dialog.close()
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    },
  }))

  const save = async (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending || suggesting() || discovering()) return

    if (standaloneCatalog()) {
      if (!form.apiKey.trim()) {
        setApiKeyError(language.t("provider.connect.apiKey.required"))
        return
      }
      setDiscovering(true)
      try {
        const models = standaloneOpenCodeGo() ? await fetchOpenCodeGoModels() : standaloneOpenCode() ? await fetchOpenCodeModels() : await fetchA6ApiModels()
        if (!models) return
        const rows = mergeA6ApiModelRows({ current: form.models, discovered: models, providerID: form.providerID })
        setForm("models", rows)
        const result = validateCustomProvider({
          form: { ...form, models: rows },
          t: language.t,
          disabledProviders: globalSync.data.config.disabled_providers ?? [],
          existingProviderIDs: new Set(
            globalSync.data.provider.all.filter((provider) => provider.id !== form.providerID).map((provider) => provider.id),
          ),
        }).result
        if (result) saveMutation.mutate(result)
      } catch (err) {
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      } finally {
        setDiscovering(false)
      }
      return
    }

    const result = validate()
    if (!result) return

    setSuggesting(true)
    const rows = await Promise.all(
      form.models.map(async (model) => {
        const response = await globalSDK.client.provider.models
          .suggest(
            {
              providerID: result.providerID,
              providerName: result.name,
              modelID: model.id.trim(),
              displayName: model.name.trim(),
            },
            { throwOnError: true },
          )
          .then((x) => x.data)
          .catch(() => undefined)
        return response ? { model, response } : undefined
      }),
    )
    setSuggesting(false)

    const useful = rows.filter(
      (row): row is { model: FormState["models"][number]; response: ProviderModelsSuggestResponse } =>
        !!row && row.response.source !== "none",
    )
    if (useful.length === 0) {
      saveMutation.mutate(result)
      return
    }

    const suggestionRows: ModelSuggestionRow[] = useful.map((row) => ({
      modelID: row.model.id.trim(),
      displayName: row.model.name.trim(),
      suggestion: row.response,
    }))
    dialog.show(() => (
      <DialogModelSuggestionConfirm
        rows={suggestionRows}
        onConfirm={(accept, candidates) => {
          saveMutation.mutate(accept ? mergeAcceptedSuggestions(result, useful, candidates) : result)
        }}
      />
    ))
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={standaloneCatalog() ? form.providerID : "synthetic"} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            {standaloneA6Api() ? language.t("provider.custom.a6api.title") : standaloneOpenCodeGo() ? language.t("provider.custom.opencodeGo.title") : standaloneOpenCode() ? language.t("provider.custom.opencode.title") : language.t("provider.custom.title")}
          </div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <Show
            when={standaloneCatalog()}
            fallback={
              <p class="text-14-regular text-text-base">
                {language.t("provider.custom.description.prefix")}
                <Link href="https://github.com/lfyxhappy/lfcode" tabIndex={-1}>
                  {language.t("provider.custom.description.link")}
                </Link>
                {language.t("provider.custom.description.suffix")}
              </p>
            }
          >
            <p class="text-14-regular text-text-base">{language.t(standaloneOpenCodeGo() ? "provider.custom.opencodeGo.description" : standaloneOpenCode() ? "provider.custom.opencode.description" : "provider.custom.a6api.description")}</p>
          </Show>

          <div class="flex flex-col gap-4">
            <Show when={!standaloneCatalog()}>
              <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-weak">{language.t("provider.custom.field.preset.label")}</label>
                <Select
                  options={CUSTOM_PROVIDER_PRESET_OPTIONS}
                  current={form.preset ?? "custom"}
                  value={(value) => value}
                  label={(value) => language.t(`provider.custom.field.preset.option.${value}`)}
                  onSelect={(value) => {
                    if (!value) return
                    setPreset(value)
                  }}
                  size="small"
                  variant="secondary"
                  class="w-full"
                  valueClass="truncate"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-weak">{language.t("provider.custom.field.protocol.label")}</label>
                <RadioGroup
                  options={form.providerID === A6API_PROVIDER_ID ? [...A6API_MODEL_PROTOCOLS] : [...PROTOCOLS]}
                  current={form.protocol}
                  value={(value) => value}
                  label={(value) => language.t(`provider.custom.field.protocol.option.${value}`)}
                  onSelect={(value) => {
                    if (!value) return
                    setProtocol(value)
                  }}
                  size="small"
                  fill
                  pad="normal"
                />
              </div>
              <TextField
                autofocus
                label={language.t("provider.custom.field.providerID.label")}
                placeholder={language.t("provider.custom.field.providerID.placeholder")}
                description={language.t("provider.custom.field.providerID.description")}
                value={form.providerID}
                onChange={(v) => setField("providerID", v)}
                validationState={form.err.providerID ? "invalid" : undefined}
                error={form.err.providerID}
              />
              <TextField
                label={language.t("provider.custom.field.name.label")}
                placeholder={language.t("provider.custom.field.name.placeholder")}
                value={form.name}
                onChange={(v) => setField("name", v)}
                validationState={form.err.name ? "invalid" : undefined}
                error={form.err.name}
              />
              <TextField
                label={language.t("provider.custom.field.baseURL.label")}
                placeholder={language.t("provider.custom.field.baseURL.placeholder")}
                value={form.baseURL}
                onChange={(v) => setField("baseURL", v)}
                disabled={form.providerID === A6API_PROVIDER_ID}
                validationState={form.err.baseURL ? "invalid" : undefined}
                error={form.err.baseURL}
              />
            </Show>
            <TextField
              autofocus={standaloneCatalog()}
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={
                standaloneCatalog()
                  ? language.t(standaloneOpenCodeGo() ? "provider.custom.opencodeGo.apiKey.description" : standaloneOpenCode() ? "provider.custom.opencode.apiKey.description" : "provider.custom.a6api.apiKey.description")
                  : language.t("provider.custom.field.apiKey.description")
              }
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
              validationState={apiKeyError() ? "invalid" : undefined}
              error={apiKeyError()}
            />
          </div>

          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
              <Show when={standaloneCatalog()}>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  icon="reset"
                  disabled={discovering()}
                  onClick={() => void (standaloneOpenCodeGo() ? discoverOpenCodeGoModels() : standaloneOpenCode() ? discoverOpenCodeModels() : discoverA6ApiModels())}
                >
                  {discovering()
                    ? language.t("settings.models.suggestionConfirm.loading")
                    : form.models.length
                      ? language.t("provider.custom.a6api.models.refresh")
                    : language.t(standaloneOpenCodeGo() ? "provider.custom.opencodeGo.models.fetch" : standaloneOpenCode() ? "provider.custom.opencode.models.fetch" : "provider.custom.a6api.models.fetch")}
                </Button>
              </Show>
            </div>
            <For each={form.models}>
              {(m, i) => (
                <div class="flex flex-col gap-3 rounded-lg border border-border-weak-base p-3" data-row={m.row}>
                  <div class="flex gap-2 items-start">
                    <div class="flex-1">
                      <TextField
                        label={language.t("provider.custom.models.id.label")}
                        hideLabel
                        placeholder={language.t("provider.custom.models.id.placeholder")}
                        value={m.id}
                        onChange={(v) => setModel(i(), "id", v)}
                        validationState={m.err.id ? "invalid" : undefined}
                        error={m.err.id}
                      />
                    </div>
                    <div class="flex-1">
                      <TextField
                        label={language.t("provider.custom.models.name.label")}
                        hideLabel
                        placeholder={language.t("provider.custom.models.name.placeholder")}
                        value={m.name}
                        onChange={(v) => setModel(i(), "name", v)}
                        validationState={m.err.name ? "invalid" : undefined}
                        error={m.err.name}
                      />
                    </div>
                    <IconButton
                      type="button"
                      icon="trash"
                      variant="ghost"
                      class="mt-1.5"
                      onClick={() => removeModel(i())}
                      disabled={form.models.length <= 1}
                      aria-label={language.t("provider.custom.models.remove")}
                    />
                  </div>
                  <Show when={m.available === false}>
                    <div class="text-12-regular text-status-warning">
                      {language.t("provider.custom.a6api.models.unavailable")}
                    </div>
                  </Show>
                  <div class="grid gap-2 sm:grid-cols-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-12-medium text-text-weak">
                        {language.t("provider.custom.models.protocol.label")}
                      </label>
                      <Select
                        options={
                          standaloneA6Api()
                            ? [...A6API_MODEL_PROTOCOLS]
                            : standaloneOpenCodeGo() || standaloneOpenCode()
                              ? ["openai-chat" as const]
                              : [...PROTOCOLS]
                        }
                        current={m.protocol ?? form.protocol}
                        value={(value) => value}
                        label={(value) => language.t(`provider.custom.field.protocol.option.${value}`)}
                        onSelect={(value) => {
                          if (!value) return
                          setModelProtocol(i(), value)
                        }}
                        size="small"
                        variant="secondary"
                        class="w-full"
                      />
                    </div>
                    <TextField
                      label={language.t("provider.custom.models.limit.context.label")}
                      placeholder={language.t("provider.custom.models.limit.context.placeholder")}
                      value={m.limit?.context ?? ""}
                      inputMode="numeric"
                      onChange={(v) => setModelLimit(i(), "context", v)}
                      validationState={m.err.context ? "invalid" : undefined}
                      error={m.err.context}
                    />
                    <TextField
                      label={language.t("provider.custom.models.limit.output.label")}
                      placeholder={language.t("provider.custom.models.limit.output.placeholder")}
                      value={m.limit?.output ?? ""}
                      inputMode="numeric"
                      onChange={(v) => setModelLimit(i(), "output", v)}
                      validationState={m.err.output ? "invalid" : undefined}
                      error={m.err.output}
                    />
                  </div>
                  <div class="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
                    <For each={CAPABILITY_KEYS}>
                      {(key) => (
                        <button
                          type="button"
                          aria-pressed={m.capabilities[key]}
                          title={language.t(`provider.custom.models.capability.${key}.description`)}
                          class="min-w-0 h-7 w-full inline-flex items-center gap-1.5 rounded-md border px-2 text-12-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
                          classList={{
                            "border-border-base bg-surface-raised-base text-text-strong": m.capabilities[key],
                            "border-border-weak-base bg-transparent text-text-base hover:bg-surface-base-hover":
                              !m.capabilities[key],
                          }}
                          onClick={() => toggleCapability(i(), key, !m.capabilities[key])}
                        >
                          <Icon
                            name={m.capabilities[key] ? "check-small" : "plus-small"}
                            size="small"
                            class="shrink-0 text-icon-base"
                          />
                          <span class="min-w-0 truncate">
                            {language.t(`provider.custom.models.capability.${key}.label`)}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
              {language.t("provider.custom.models.add")}
            </Button>
            </div>

          <Show when={!standaloneCatalog()}>
            <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
            <For each={form.headers}>
              {(h, i) => (
                <div class="flex gap-2 items-start" data-row={h.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setHeader(i(), "key", v)}
                      validationState={h.err.key ? "invalid" : undefined}
                      error={h.err.key}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setHeader(i(), "value", v)}
                      validationState={h.err.value ? "invalid" : undefined}
                      error={h.err.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
              {language.t("provider.custom.headers.add")}
            </Button>
            </div>
          </Show>

          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending || suggesting() || discovering()}
          >
            {suggesting()
              ? language.t("settings.models.suggestionConfirm.loading")
              : saveMutation.isPending
                ? language.t("common.saving")
                : standaloneCatalog()
                  ? language.t(standaloneOpenCodeGo() ? "provider.custom.opencodeGo.connect" : standaloneOpenCode() ? "provider.custom.opencode.connect" : "provider.custom.a6api.connect")
                  : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}

function mergeAcceptedSuggestions(
  result: ValidatedCustomProvider,
  rows: Array<{ model: FormState["models"][number]; response: ProviderModelsSuggestResponse }>,
  candidates: Record<string, NonNullable<ProviderModelsSuggestResponse["candidates"]>[number]>,
) {
  const models = { ...result.config.models }
  for (const row of rows) {
    const modelID = row.model.id.trim()
    const current = models[modelID]
    if (!current) continue
    const patch = (candidates[modelID]?.patch ?? row.response.patch) as Record<string, unknown>
    const capabilityPatch = booleanRecord(patch.capabilities)
    const capabilities = Object.fromEntries(
      Object.entries(capabilityPatch).filter(([key]) => !row.model.manual[key as CapabilityKey]),
    )
    const limitPatch = numberRecord(patch.limit)
    const existingInput = (current.limit as { input?: number } | undefined)?.input
    const limit = {
      context: limitPatch.context ?? current.limit?.context,
      ...(limitPatch.input !== undefined || existingInput !== undefined
        ? { input: limitPatch.input ?? existingInput }
        : {}),
      output: limitPatch.output ?? current.limit?.output,
    }
    const modalities = modalitiesRecord(patch.modalities)
    const cost = numberRecord(patch.cost)
    const variantOptions = stringArray(patch.variantOptions)
    models[modelID] = {
      ...current,
      ...(Object.keys(capabilities).length > 0
        ? {
            capabilities: {
              ...current.capabilities,
              ...capabilities,
            },
          }
        : {}),
      ...(row.model.limit?.context ||
      row.model.limit?.output ||
      limit.context === undefined ||
      limit.output === undefined
        ? {}
        : {
            limit,
          }),
      ...(Object.keys(modalities).length > 0 ? { modalities } : {}),
      ...(Object.keys(cost).length > 0 ? { cost } : {}),
      ...(patch.variantGroup === "custom" && variantOptions.length > 0
        ? {
            variantGroup: "custom",
            variantOptions,
          }
        : {}),
    }
  }
  return {
    ...result,
    config: {
      ...result.config,
      models,
    },
  }
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  )
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  )
}

function modalitiesRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const input = stringArray(record.input)
  const output = stringArray(record.output)
  return {
    ...(input.length > 0 ? { input } : {}),
    ...(output.length > 0 ? { output } : {}),
  }
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}
