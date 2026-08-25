import { Button } from "@lfcode-ai/ui/button"
import { useFileComponent } from "@lfcode-ai/ui/context/file"
import { Icon } from "@lfcode-ai/ui/icon"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Markdown } from "@lfcode-ai/ui/markdown"
import { showToast } from "@lfcode-ai/ui/toast"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { createMessageBlockDraftState, type MessageBlockDraftState } from "@/pages/session/message-block-draft-state"
import {
  createMessageCodeScratchPath,
  messageCodeFileStatus,
  readMessageCodeFile,
} from "@/pages/session/message-code-block-path"
import { MessageEditableCodeBlock } from "@/pages/session/message-editable-code-block"
import { isFileChecksumConflict } from "@/pages/session/file-write-state"
import { createLfcodeEditorPath } from "@/pages/session/file-tab-navigation"
import { useSessionLayout } from "@/pages/session/session-layout"

type MessageCodeBlockProps = {
  blockKey: string
  sessionID: string
  messageID: string
  partID: string
  blockIndex: number
  languageID: string
  code: string
  raw: string
  projectPath?: string
  title?: string
}

const cache = new Map<string, MessageBlockDraftState>()

export function MessageCodeBlock(props: MessageCodeBlockProps) {
  const sdk = useSDK()
  const [editing, setEditing] = createSignal(false)
  const [projectFile] = createResource(
    () => props.projectPath,
    (path) => (path ? readMessageCodeFile(sdk.client.file.read, path) : undefined),
  )

  return (
    <Show
      when={props.projectPath && messageCodeFileStatus(projectFile()) === "exists"}
      fallback={<Markdown text={props.raw} cacheKey={`${props.blockKey}:markdown`} streaming={false} />}
    >
      <Show when={editing()} fallback={<StaticMessageCodeBlockPreview {...props} onEdit={() => setEditing(true)} />}>
        <EditableMessageCodeBlock {...props} projectPath={props.projectPath!} />
      </Show>
    </Show>
  )
}

export function StaticMessageCodeBlockPreview(
  props: Pick<MessageCodeBlockProps, "blockKey" | "languageID" | "code" | "projectPath" | "title"> & {
    onEdit: VoidFunction
  },
) {
  const language = useLanguage()
  const fileComponent = useFileComponent()

  return (
    <section
      data-automation-id="message-code-block-preview"
      data-block-key={props.blockKey}
      class="overflow-hidden rounded-lg border border-border-weak-base bg-background-base"
    >
      <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2">
        <div class="min-w-0 truncate">
          <span class="font-mono text-11-medium text-text-weak">{props.languageID || "text"}</span>
          <Show when={props.projectPath}>
            <span class="ml-2 text-11-regular text-text-weak">{props.projectPath}</span>
          </Show>
        </div>
        <Button
          type="button"
          size="small"
          variant="ghost"
          class="size-7 min-w-7 rounded-md p-0"
          title={language.t("common.edit")}
          aria-label={language.t("common.edit")}
          onClick={props.onEdit}
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
      </div>
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: `message.${props.languageID || "txt"}`,
          contents: props.code,
        }}
        class="select-text"
      />
    </section>
  )
}

function EditableMessageCodeBlock(props: MessageCodeBlockProps & { projectPath: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const file = useFile()
  const dialog = useDialog()
  const { tabs } = useSessionLayout()
  const openLfcodeEditorPath = createLfcodeEditorPath({
    normalizePath: file.normalize,
    loadFile: file.load,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActiveTab: tabs().setActive,
  })
  const initialPath = props.projectPath || createMessageCodeScratchPath({
    sessionID: props.sessionID,
    messageID: props.messageID,
    partID: props.partID,
    blockIndex: props.blockIndex,
    language: props.languageID,
  })
  const draft = createMessageBlockDraftState({
    blockKey: props.blockKey,
    initialDraft: props.code,
    initialPath,
    cache,
    sdk,
    file,
    dialog,
    tabs: tabs(),
    language,
    saveErrorTitle: language.t("session.codeBlock.saveFailed"),
  })
  const state = draft.state
  const setState = draft.setState
  const save = draft.save
  const openInSidebar = draft.openInSidebar
  const bindFile = draft.bindFile
  const bindFileToPath = draft.bindFileToPath
  const externalChanged = createMemo(() => {
    const checksum = file.get(state.bindingPath)?.content?.checksum
    return Boolean(state.dirty && checksum && state.baseChecksum && checksum !== state.baseChecksum)
  })
  const saveConflict = createMemo(() => isFileChecksumConflict(state.saveError))
  const describeError = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === "string" && error) return error
    return language.t("common.requestFailed")
  }
  const reloadBindingFromDisk = async () => {
    try {
      await file.load(state.bindingPath, { force: true })
      const content = file.get(state.bindingPath)?.content
      if (!content) throw new Error(language.t("common.requestFailed"))
      setState({
        mode: state.mode,
        draft: content.content,
        revision: state.revision + 1,
        baseContent: content.content,
        dirty: false,
        saving: false,
        saveError: undefined,
        baseChecksum: content.checksum,
        bindingPath: state.bindingPath,
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("session.codeFile.reloadFailed"),
        description: describeError(error),
      })
    }
  }

  return (
    <MessageEditableCodeBlock
      blockKey={props.blockKey}
      languageID={props.languageID}
      title={props.languageID}
      state={state}
      setDraft={(value) => {
        setState("draft", value)
        setState("dirty", true)
      }}
      setMode={(mode) => setState("mode", mode)}
      clearSaveError={() => setState("saveError", undefined)}
      save={save}
      openInSidebar={openInSidebar}
      bindFile={bindFile}
      bindFileToPath={bindFileToPath}
      reloadFromDisk={reloadBindingFromDisk}
      editLabel={language.t("common.edit")}
      previewLabel={language.t("session.codeFile.preview")}
      diffLabel={language.t("session.codeFile.diff")}
      openInSidebarLabel={language.t("session.codeBlock.openInSidebar")}
      bindFileLabel={language.t("session.codeBlock.bindFile")}
      saveLabel={language.t("common.save")}
      savingLabel={language.t("common.saving")}
      savedLabel={language.t("session.codeFile.saved")}
      unsavedLabel={language.t("session.codeFile.unsaved")}
      externalChanged={externalChanged()}
      externalChangedLabel={language.t("session.codeFile.externalChanged")}
      saveConflict={saveConflict()}
      conflictLabel={language.t("session.codeFile.conflict")}
      reloadLabel={language.t("session.codeFile.reload")}
      onReload={reloadBindingFromDisk}
      onOpenPath={openLfcodeEditorPath}
    />
  )
}
