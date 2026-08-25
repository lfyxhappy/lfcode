import type { Accessor, JSX } from "solid-js"
import type { useDialog } from "@lfcode-ai/ui/context/dialog"
import { DialogRename, type RenameKind } from "@/components/dialog-rename"
import { isRenameDoubleClick } from "./rename-double-click"

export type RenameTriggerComponent = (props: {
  id: string
  value: Accessor<string>
  onSave: (next: string) => void | Promise<void>
  class?: string
  displayClass?: string
  stopPropagation?: boolean
  openOnDblClick?: boolean
}) => JSX.Element

export function createRenameDialogController(dialog: ReturnType<typeof useDialog>) {
  const kind = (id: string): RenameKind => {
    if (id.startsWith("project:")) return "project"
    if (id.startsWith("workspace:")) return "workspace"
    return "session"
  }

  const openEditor = (id: string, value: string, onSave: (next: string) => void | Promise<void>) => {
    if (!id) return
    dialog.show(() => <DialogRename kind={kind(id)} value={value} onSave={onSave} />)
  }

  const RenameTrigger: RenameTriggerComponent = (props) => {
    let previousClickAt: number | undefined
    const handleClick = (event: MouseEvent) => {
      if (props.openOnDblClick === false) return
      const currentClickAt = performance.now()
      const rename = isRenameDoubleClick(previousClickAt, currentClickAt)
      previousClickAt = currentClickAt
      if (!rename) return
      previousClickAt = undefined
      event.preventDefault()
      event.stopPropagation()
      openEditor(props.id, props.value(), props.onSave)
    }

    return <span class={props.displayClass ?? props.class} onClick={handleClick}>{props.value()}</span>
  }

  return {
    openEditor,
    RenameTrigger,
  }
}
