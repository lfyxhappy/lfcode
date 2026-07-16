import { canUseCodeDiffView } from "@lfcode-ai/ui/code-diff-shared"
import { useFileComponent } from "@lfcode-ai/ui/context/file"
import { BasicCodeEditor } from "@/components/code-editor/core/basic-editor"
import { CodeEditorCommandStrip } from "@/components/code-editor/core/command-strip"
import type { CodeEditorCommandHandle } from "@/components/code-editor/core/command-handle"
import { getCodeEditorDocumentGuard } from "@/components/code-editor/core/document-guard"
import { CodeEditorInlineMiniEditor } from "@/components/code-editor/core/inline-mini-editor"
import type { CodeEditorNavigationSelection } from "@/components/code-editor/core/navigation"
import { isCodeEditorPhase0Enabled } from "@/components/code-editor/core/phase0"
import { MessageCodeEditorFrame } from "@/pages/session/message-code-editor-frame"
import { createMemo, createSignal, lazy, onCleanup, Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

type MessageEditableCodeBlockState = {
  mode: "preview" | "edit" | "diff"
  draft: string
  revision: number
  baseContent?: string
  dirty: boolean
  saving: boolean
  saveError?: string
  bindingPath: string
}

const CodeDiffView = lazy(() => import("@lfcode-ai/ui/code-diff-view").then((mod) => ({ default: mod.CodeDiffView })))

type MessageCodeBlockAutomationRoot = HTMLDivElement & {
  __lfcodeMessageCodeBlockAutomation?: {
    bindFileToPath: (path: string) => Promise<boolean>
    reload: () => Promise<void>
  }
}

export function MessageEditableCodeBlock(props: {
  blockKey: string
  languageID: string
  title: string
  state: MessageEditableCodeBlockState
  setDraft: (value: string) => void
  setMode: (mode: "preview" | "edit" | "diff") => void
  clearSaveError: () => void
  save: (reason?: "manual" | "sidebar" | "run") => Promise<boolean> | boolean
  openInSidebar: () => Promise<void> | void
  bindFile: () => void
  bindFileToPath?: (path: string) => Promise<boolean> | boolean
  reloadFromDisk?: () => Promise<void> | void
  editLabel: string
  previewLabel: string
  diffLabel: string
  openInSidebarLabel: string
  bindFileLabel: string
  saveLabel: string
  savingLabel: string
  savedLabel: string
  unsavedLabel: string
  externalChanged?: boolean
  externalChangedLabel?: string
  saveConflict?: boolean
  conflictLabel?: string
  reloadLabel?: string
  onReload?: () => Promise<void> | void
  onOpenPath?: (input: { path: string; selection?: CodeEditorNavigationSelection }) => Promise<void> | void
  moreActions?: JSX.Element
}) {
  const fileComponent = useFileComponent()
  const inlineGuard = createMemo(() => getCodeEditorDocumentGuard(props.state.draft))
  const useUnifiedInlineEditor = createMemo(() => isCodeEditorPhase0Enabled() && !inlineGuard().tooLarge)
  const diffUseCodeView = createMemo(() =>
    canUseCodeDiffView({
      path: props.state.bindingPath,
      before: props.state.baseContent ?? props.state.draft,
      after: props.state.draft,
    }),
  )
  const [commandHandle, setCommandHandle] = createSignal<CodeEditorCommandHandle>()
  const [codeDiffUnavailable, setCodeDiffUnavailable] = createSignal(false)
  let rootRef: MessageCodeBlockAutomationRoot | undefined

  const setRootRef = (el: HTMLDivElement) => {
    rootRef = el as MessageCodeBlockAutomationRoot
    if (!props.bindFileToPath) return
    rootRef.__lfcodeMessageCodeBlockAutomation = {
      bindFileToPath: async (path: string) => {
        const value = path.trim()
        if (!value) return false
        return (await Promise.resolve(props.bindFileToPath?.(value))) ?? false
      },
      reload: async () => {
        await Promise.resolve(props.reloadFromDisk?.())
      },
    }
  }

  onCleanup(() => {
    if (!rootRef?.__lfcodeMessageCodeBlockAutomation) return
    delete rootRef.__lfcodeMessageCodeBlockAutomation
  })

  const saveThroughCommandHandle = async (reason: "manual" | "sidebar" | "run" = "manual") => {
    if (props.state.mode === "edit" && useUnifiedInlineEditor() && commandHandle()) {
      await commandHandle()!.save()
      return true
    }
    return props.save(reason)
  }

  return (
    <MessageCodeEditorFrame
      rootRef={setRootRef}
      blockKey={props.blockKey}
      languageID={props.languageID}
      title={props.title}
      path={props.state.bindingPath}
      mode={props.state.mode}
      saving={props.state.saving}
      dirty={props.state.dirty}
      externalChanged={props.externalChanged}
      saveConflict={props.saveConflict}
      editLabel={props.editLabel}
      previewLabel={props.previewLabel}
      diffLabel={props.diffLabel}
      openInSidebarLabel={props.openInSidebarLabel}
      bindFileLabel={props.bindFileLabel}
      reloadLabel={props.reloadLabel}
      saveLabel={props.saveLabel}
      savingLabel={props.savingLabel}
      savedLabel={props.savedLabel}
      unsavedLabel={props.unsavedLabel}
      onModeChange={props.setMode}
      onOpenInSidebar={() => void props.openInSidebar()}
      onBindFile={props.bindFile}
      onReload={props.onReload}
      onSave={() => void saveThroughCommandHandle("manual")}
      leadingActions={
        <Show when={props.state.mode === "edit"}>
          <CodeEditorCommandStrip handle={commandHandle()} compact />
        </Show>
      }
      moreActions={props.moreActions}
      status={
        <>
          <Show when={props.externalChanged && props.externalChangedLabel}>
            <span class="truncate text-status-warning">{props.externalChangedLabel}</span>
          </Show>
          <Show when={!props.externalChanged && props.saveConflict && props.conflictLabel}>
            <span class="truncate text-text-danger">{props.conflictLabel}</span>
          </Show>
          <Show when={!props.externalChanged && !props.saveConflict && props.state.saveError}>
            {(message) => <span class="truncate text-text-danger">{message()}</span>}
          </Show>
        </>
      }
    >
      <Show
        when={props.state.mode === "edit"}
        fallback={
          <Show
            when={props.state.mode === "diff"}
            fallback={
              <pre class="overflow-x-auto px-4 py-3 text-[13px] leading-6 text-text-primary">
                <code>{props.state.draft}</code>
              </pre>
            }
          >
            <div class="min-h-0 flex-1 p-3">
              <Show
                when={!codeDiffUnavailable() && diffUseCodeView()}
                fallback={
                  <Dynamic
                    component={fileComponent}
                    mode="diff"
                    before={{
                      name: props.state.bindingPath,
                      contents: props.state.baseContent ?? props.state.draft,
                    }}
                    after={{
                      name: props.state.bindingPath,
                      contents: props.state.draft,
                    }}
                  />
                }
              >
                <CodeDiffView
                  path={props.state.bindingPath}
                  before={props.state.baseContent ?? props.state.draft}
                  after={props.state.draft}
                  diffStyle="split"
                  onUnavailable={() => setCodeDiffUnavailable(true)}
                />
              </Show>
            </div>
          </Show>
        }
      >
        <Show
          when={useUnifiedInlineEditor()}
          fallback={
            <BasicCodeEditor
              preset="inline-mini"
              value={props.state.draft}
              onSave={() => saveThroughCommandHandle("manual")}
              onInput={(value) => {
                props.setDraft(value)
                props.clearSaveError()
              }}
            />
          }
        >
          <CodeEditorInlineMiniEditor
            path={props.state.bindingPath}
            language={props.languageID}
            value={props.state.draft}
            revision={props.state.revision}
            dirty={props.state.dirty}
            onOpenPath={props.onOpenPath}
            onCommandHandle={setCommandHandle}
            onSave={() => saveThroughCommandHandle("manual")}
            onInput={(value) => {
              props.setDraft(value)
              props.clearSaveError()
            }}
          />
        </Show>
      </Show>
    </MessageCodeEditorFrame>
  )
}
