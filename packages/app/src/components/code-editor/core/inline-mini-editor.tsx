import { CodeEditorHost } from "@/components/code-editor/core/host"
import type { CodeEditorCommandHandle } from "@/components/code-editor/core/command-handle"
import type { CodeEditorNavigationSelection } from "@/components/code-editor/core/navigation"

export function CodeEditorInlineMiniEditor(props: {
  path: string
  value: string
  revision?: number
  dirty?: boolean
  language?: string
  onInput: (value: string) => void
  onSave?: () => Promise<unknown> | unknown
  onCommandHandle?: (handle: CodeEditorCommandHandle | undefined) => void
  onOpenPath?: (input: { path: string; selection?: CodeEditorNavigationSelection }) => Promise<void> | void
}) {
  return (
    <CodeEditorHost
      path={props.path}
      value={props.value}
      revision={props.revision}
      dirty={props.dirty}
      language={props.language}
      preset="inline-mini"
      onOpenPath={props.onOpenPath}
      onCommandHandle={props.onCommandHandle}
      onInput={props.onInput}
      onSave={props.onSave}
    />
  )
}
