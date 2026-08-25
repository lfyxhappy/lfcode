import { Button } from "@lfcode-ai/ui/button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { TextField } from "@lfcode-ai/ui/text-field"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { showToast } from "@lfcode-ai/ui/toast"
import { errorMessage } from "@/pages/layout/helpers"

export type RenameKind = "project" | "session" | "workspace"

export function DialogRename(props: {
  kind: RenameKind
  value: string
  onSave: (next: string) => void | Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [value, setValue] = createSignal(props.value)
  const [saving, setSaving] = createSignal(false)

  const titleKey: Record<RenameKind, "dialog.rename.project.title" | "dialog.rename.session.title" | "dialog.rename.workspace.title"> = {
    project: "dialog.rename.project.title",
    session: "dialog.rename.session.title",
    workspace: "dialog.rename.workspace.title",
  }
  const title = () => language.t(titleKey[props.kind])
  const description = () => language.t("dialog.rename.description")

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (saving()) return
    const next = value().trim()
    if (!next) return

    setSaving(true)
    try {
      await props.onSave(next)
      dialog.close()
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err, language.t("common.requestFailed")),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog fit title={title()} description={description()} class="w-full max-w-[420px] mx-auto">
      <form class="flex flex-col gap-6 p-6 pt-0" onSubmit={submit}>
        <TextField
          autofocus
          type="text"
          label={language.t("dialog.rename.label")}
          value={value()}
          disabled={saving()}
          ref={(input: HTMLInputElement) => {
            requestAnimationFrame(() => {
              if (!input.isConnected) return
              input.focus()
              input.select()
            })
          }}
          onChange={setValue}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" disabled={saving()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={saving() || !value().trim()}>
            {saving() ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
