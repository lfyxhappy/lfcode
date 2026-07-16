import { Dialog } from "@lfcode-ai/ui/dialog"
import { Button } from "@lfcode-ai/ui/button"
import { Tag } from "@lfcode-ai/ui/tag"
import { createMemo, For, Show } from "solid-js"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import {
  MODEL_CAPABILITY_KEYS,
  readDetectedCapabilities,
  readDetectedVariants,
  type ModelDetectResult,
} from "./settings-models-helpers"

export function DialogModelDetectResult(props: { modelName: string; result: ModelDetectResult }) {
  const dialog = useDialog()
  const language = useLanguage()

  const capabilities = createMemo(() => readDetectedCapabilities(props.result))
  const variants = createMemo(() => readDetectedVariants(props.result))
  const enabled = createMemo(() => MODEL_CAPABILITY_KEYS.filter((key) => capabilities()[key]))
  const disabled = createMemo(() => MODEL_CAPABILITY_KEYS.filter((key) => !capabilities()[key]))
  const warnings = createMemo(() => props.result.warnings?.filter(Boolean) ?? [])

  const capabilityLabel = (key: (typeof MODEL_CAPABILITY_KEYS)[number]) =>
    language.t(`provider.custom.models.capability.${key}.description`)

  const variantGroupLabel = (value: string | undefined) => {
    if (!value) return language.t("common.none")
    if (value === "standard") return language.t("settings.models.editor.variant.group.standard")
    if (value === "extended") return language.t("settings.models.editor.variant.group.extended")
    if (value === "deepseek") return language.t("settings.models.editor.variant.group.deepseek")
    if (value === "custom") return language.t("settings.models.editor.variant.group.custom")
    return value
  }

  return (
    <Dialog
      title={<div class="text-16-medium text-text-strong">{language.t("settings.models.detectResult.title")}</div>}
      description={
        <div class="text-13-regular text-text-weak">
          {language.t("settings.models.detectResult.description", { model: props.modelName })}
        </div>
      }
      action={
        <Button size="small" variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      }
      size="large"
      transition
    >
      <div class="flex max-h-[70vh] flex-col gap-5 overflow-y-auto px-1 pb-2">
        <div class="flex flex-col gap-2">
          <div class="text-13-medium text-text-strong">{language.t("settings.models.detectResult.capabilities")}</div>
          <div class="flex flex-wrap gap-2">
            <For each={enabled()}>{(key) => <Tag>{capabilityLabel(key)}</Tag>}</For>
          </div>
          <Show when={disabled().length > 0}>
            <div class="text-12-regular text-text-weak">
              {language.t("settings.models.detectResult.notDetected", {
                capabilities: disabled()
                  .map((key) => capabilityLabel(key))
                  .join("、"),
              })}
            </div>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <div class="text-13-medium text-text-strong">{language.t("settings.models.detectResult.variantTitle")}</div>
          <div class="text-13-regular text-text-base">
            {language.t("settings.models.detectResult.variantGroup", {
              group: variantGroupLabel(variants().variantGroup),
            })}
          </div>
          <div class="text-13-regular text-text-base">
            {variants().variantOptions.length > 0
              ? language.t("settings.models.detectResult.variantOptions", {
                  options: variants().variantOptions.join(" / "),
                })
              : language.t("settings.models.detectResult.variantOptionsEmpty")}
          </div>
        </div>

        <Show when={warnings().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-13-medium text-text-strong">{language.t("settings.models.detectResult.warnings")}</div>
            <div class="rounded-lg border border-border-weak-base bg-surface-base px-3 py-2">
              <For each={warnings()}>{(warning) => <div class="text-12-regular text-text-weak break-words">{warning}</div>}</For>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
