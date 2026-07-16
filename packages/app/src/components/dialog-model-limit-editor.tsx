import { Dialog } from "@lfcode-ai/ui/dialog"
import { Button } from "@lfcode-ai/ui/button"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { batch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"

type Props = {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  current?: {
    context?: number
    output?: number
  }
}

function positiveInt(input: string) {
  const value = Number(input)
  return Number.isInteger(value) && value > 0 && String(value) === input
}

export function DialogModelLimitEditor(props: Props) {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const [form, setForm] = createStore({
    context: props.current?.context ? String(props.current.context) : "",
    output: props.current?.output ? String(props.current.output) : "",
    err: {
      context: undefined as string | undefined,
      output: undefined as string | undefined,
    },
    saving: false,
  })

  const dirty = createMemo(
    () =>
      form.context !== (props.current?.context ? String(props.current.context) : "") ||
      form.output !== (props.current?.output ? String(props.current.output) : ""),
  )

  const validate = () => {
    const context = form.context.trim()
    const output = form.output.trim()
    const contextErr =
      !context ? undefined : !positiveInt(context) ? language.t("provider.custom.error.positiveInteger") : undefined
    const outputErr =
      !output ? undefined : !positiveInt(output) ? language.t("provider.custom.error.positiveInteger") : undefined
    batch(() => {
      setForm("err", "context", contextErr)
      setForm("err", "output", outputErr)
    })
    if (contextErr || outputErr) return
    return {
      context: context ? Number(context) : undefined,
      output: output ? Number(output) : undefined,
    }
  }

  const save = async () => {
    if (form.saving || !dirty()) return
    const next = validate()
    if (!next) return

    setForm("saving", true)
    await globalSync
      .updateConfig({
        provider: {
          [props.providerID]: {
            models: {
              [props.modelID]: {
                limit: {
                  context: next.context ?? null,
                  output: next.output ?? null,
                },
              },
            },
          },
        },
      })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.models.toast.updated.title"),
          description: language.t("settings.models.toast.limitUpdated.description", { model: props.modelName }),
        })
        dialog.close()
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      })
      .finally(() => setForm("saving", false))
  }

  return (
    <Dialog
      title={<div class="text-16-medium text-text-strong">{language.t("settings.models.limitEditor.title")}</div>}
      description={
        <div class="text-13-regular text-text-weak">
          {language.t("settings.models.limitEditor.description", { model: props.modelName, provider: props.providerName })}
        </div>
      }
      action={
        <div class="flex items-center gap-2">
          <Button size="small" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button size="small" variant="primary" disabled={form.saving || !dirty()} onClick={() => void save()}>
            {form.saving ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </div>
      }
      size="large"
      transition
    >
      <div class="flex flex-col gap-4 px-1 pb-2">
        <TextField
          label={language.t("provider.custom.models.limit.context.label")}
          placeholder={language.t("provider.custom.models.limit.context.placeholder")}
          value={form.context}
          inputMode="numeric"
          onChange={(value) => {
            setForm("context", value)
            setForm("err", "context", undefined)
          }}
          validationState={form.err.context ? "invalid" : undefined}
          error={form.err.context}
        />
        <TextField
          label={language.t("provider.custom.models.limit.output.label")}
          placeholder={language.t("provider.custom.models.limit.output.placeholder")}
          value={form.output}
          inputMode="numeric"
          onChange={(value) => {
            setForm("output", value)
            setForm("err", "output", undefined)
          }}
          validationState={form.err.output ? "invalid" : undefined}
          error={form.err.output}
        />
      </div>
    </Dialog>
  )
}
