import { useSettings } from "@/context/settings"

export function BasicCodeEditor(props: {
  value: string
  preset?: "sidebar-full" | "inline-mini"
  readonly?: boolean
  onInput: (value: string) => void
  onSave?: () => Promise<unknown> | unknown
}) {
  const settings = useSettings()
  const inline = () => props.preset === "inline-mini"

  return (
    <textarea
      data-automation-id={inline() ? "code-editor-basic-inline" : "code-editor-basic-file"}
      data-editable-surface="fallback-editor"
      value={props.value}
      readOnly={props.readonly}
      wrap={settings.editor.wordWrap() ? "soft" : "off"}
      spellcheck={false}
      class="h-full min-h-52 w-full resize-none rounded-lg border border-border-weak-base bg-background-base px-4 py-3 font-mono leading-6 text-text-primary outline-none"
      style={{
        "font-family": "var(--font-family-mono)",
        "font-size": `${inline() ? Math.max(12, settings.editor.fontSize() - 1) : settings.editor.fontSize()}px`,
        "tab-size": String(settings.editor.tabSize()),
        "-moz-tab-size": String(settings.editor.tabSize()),
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
          event.preventDefault()
          event.stopPropagation()
          void props.onSave?.()
          return
        }
        if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        event.preventDefault()
        event.stopPropagation()
        const target = event.currentTarget
        const indentation = " ".repeat(settings.editor.tabSize())
        const start = target.selectionStart
        const next = `${target.value.slice(0, start)}${indentation}${target.value.slice(target.selectionEnd)}`
        target.value = next
        target.setSelectionRange(start + indentation.length, start + indentation.length)
        props.onInput(next)
      }}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  )
}
