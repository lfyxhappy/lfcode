import { Button } from "@lfcode-ai/ui/button"
import { RadioGroup } from "@lfcode-ai/ui/radio-group"
import { Select } from "@lfcode-ai/ui/select"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { ProviderIcon } from "@lfcode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { batch, For } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import {
  CAPABILITY_KEYS,
  type CapabilityKey,
  CUSTOM_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_PRESET_OPTIONS,
  type CustomProviderPresetID,
  inferCapabilities,
  type FormState,
  headerRow,
  modelRow,
  presetModelRow,
  PROTOCOLS,
  validateCustomProvider,
} from "./dialog-custom-provider-form"
import { DialogSelectProvider } from "./dialog-select-provider"
import { Icon } from "@lfcode-ai/ui/icon"

type Props = {
  back?: "providers" | "close"
  returnTo?: "models" | "settings-models"
  preset?: CustomProviderPresetID
}

function initialFormState(presetID?: CustomProviderPresetID): FormState {
  const preset = CUSTOM_PROVIDER_PRESETS.find((item) => item.id === presetID)
  if (preset) {
    return {
      preset: "custom",
      protocol: preset.protocol,
      providerID: preset.providerID,
      name: preset.name,
      baseURL: preset.baseURL,
      apiKey: "",
      models: preset.models.map((model) => presetModelRow(model)),
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
    models: [modelRow()],
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
    setForm("preset", "custom")
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm("preset", "custom")
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
    if (key === "apiKey") return
    setForm("preset", "custom")
    setForm("err", key, undefined)
  }

  const applyCapabilityInference = (index: number, patch: Partial<{ id: string; name: string }> = {}) => {
    const current = form.models[index]
    if (!current) return
    const next = inferCapabilities(
      {
        id: patch.id ?? current.id,
        name: patch.name ?? current.name,
        protocol: form.protocol,
        current: current.capabilities,
        manual: current.manual,
      },
    )
    for (const key of CAPABILITY_KEYS) {
      if (current.manual[key]) continue
      setForm("models", index, "capabilities", key, next[key])
    }
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("preset", "custom")
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
      applyCapabilityInference(index, { [key]: value })
    })
  }

  const setModelLimit = (index: number, key: "context" | "output", value: string) => {
    batch(() => {
      setForm("preset", "custom")
      setForm("models", index, "limit", key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const toggleCapability = (index: number, key: CapabilityKey, checked: boolean) => {
    batch(() => {
      setForm("preset", "custom")
      setForm("models", index, "capabilities", key, checked)
      setForm("models", index, "manual", key, true)
    })
  }

  const setProtocol = (value: FormState["protocol"]) => {
    batch(() => {
      setForm("preset", "custom")
      setForm("protocol", value)
      for (const [index, model] of form.models.entries()) {
        const next = inferCapabilities({
          id: model.id,
          name: model.name,
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
      setForm("preset", "custom")
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
      setForm("models", preset.models.map((model) => presetModelRow(model)))
      setForm("err", {})
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(globalSync.data.provider.all.map((p) => p.id)),
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

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
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
          <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            {language.t("provider.custom.description.prefix")}
            <Link href="https://github.com/lfyxhappy/lfcode" tabIndex={-1}>
              {language.t("provider.custom.description.link")}
            </Link>
            {language.t("provider.custom.description.suffix")}
          </p>

          <div class="flex flex-col gap-4">
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
                options={[...PROTOCOLS]}
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
              validationState={form.err.baseURL ? "invalid" : undefined}
              error={form.err.baseURL}
            />
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
            />
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
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
                  <div class="grid gap-2 sm:grid-cols-2">
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

          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
