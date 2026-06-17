import { Button } from "@lfcode-ai/ui/button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { showToast } from "@lfcode-ai/ui/toast"
import { createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { isCustomProviderConfig } from "@/utils/custom-provider"
import { formatServerError } from "@/utils/server-errors"

type Props = {
  providerID: string
  providerName: string
  onClose?: () => void
}

export function DialogRemoveProvider(props: Props) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [pending, setPending] = createSignal(false)

  const close = () => {
    if (props.onClose) {
      props.onClose()
      return
    }
    dialog.close()
  }

  const handleDelete = async () => {
    if (pending()) return
    setPending(true)
    const custom = isCustomProviderConfig(globalSync.data.config, props.providerID)
    const beforeDisabled = globalSync.data.config.disabled_providers ?? []
    const nextDisabled = beforeDisabled.includes(props.providerID)
      ? beforeDisabled
      : [...beforeDisabled, props.providerID]
    const request = custom
      ? globalSDK.client.global.config
          .removeCustomProvider({ providerID: props.providerID })
          .then(() => globalSync.reloadProviders())
      : Promise.resolve()
          .then(() => {
            globalSync.set("config", "disabled_providers", nextDisabled)
            return globalSync.updateConfig({ disabled_providers: nextDisabled })
          })
          .then(() => globalSDK.client.auth.remove({ providerID: props.providerID }).catch(() => undefined))

    await request
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.remove.toast.title", { provider: props.providerName }),
          description: language.t("provider.remove.toast.description", { provider: props.providerName }),
        })
        close()
      })
      .catch((err: unknown) => {
        if (!custom) globalSync.set("config", "disabled_providers", beforeDisabled)
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
        close()
      })
      .finally(() => {
        setPending(false)
      })
  }

  return (
    <Dialog title={language.t("provider.remove.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("provider.remove.confirm", { provider: props.providerName })}
          </span>
          <span class="text-12-regular text-text-weak">{language.t("provider.remove.description")}</span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={close}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={pending()} onClick={() => void handleDelete()}>
            {language.t("provider.remove.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export const DialogDeleteCustomProvider = DialogRemoveProvider
