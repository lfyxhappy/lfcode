import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Icon } from "@lfcode-ai/ui/icon"
import { Markdown } from "@lfcode-ai/ui/markdown"
import { showToast } from "@lfcode-ai/ui/toast"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useFile } from "@/context/file"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useTerminal } from "@/context/terminal"
import { isCppRunnablePath } from "@/pages/session/cpp-file"
import { createMessageBlockDraftState, type MessageBlockDraftState } from "@/pages/session/message-block-draft-state"
import { createCppMessageScratchPath } from "@/pages/session/cpp-message-block-path"
import { messageCodeFileStatus, readMessageCodeFile } from "@/pages/session/message-code-block-path"
import { MessageEditableCodeBlock } from "@/pages/session/message-editable-code-block"
import { isMissingCppCompilerError, promptInstallManagedCppCompiler, runCppFileInTerminal } from "@/pages/session/cpp-terminal-run"
import { isCppChecksumConflict } from "@/pages/session/cpp-write-state"
import { createLfcodeEditorPath } from "@/pages/session/file-tab-navigation"
import { useSessionLayout } from "@/pages/session/session-layout"
import { StaticMessageCodeBlockPreview } from "./message-code-block"

type CppMessageBlockProps = {
  blockKey: string
  sessionID: string
  messageID: string
  partID: string
  blockIndex: number
  code: string
  raw: string
  projectPath?: string
}

const cache = new Map<string, MessageBlockDraftState>()

export function CppMessageBlock(props: CppMessageBlockProps) {
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
      <Show
        when={editing()}
        fallback={
          <StaticMessageCodeBlockPreview
            blockKey={props.blockKey}
            languageID="cpp"
            code={props.code}
            projectPath={props.projectPath}
            onEdit={() => setEditing(true)}
          />
        }
      >
        <EditableCppMessageBlock {...props} projectPath={props.projectPath!} />
      </Show>
    </Show>
  )
}

function EditableCppMessageBlock(props: CppMessageBlockProps & { projectPath: string }) {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const file = useFile()
  const terminal = useTerminal()
  const dialog = useDialog()
  const layout = useSessionLayout()
  const openLfcodeEditorPath = createLfcodeEditorPath({
    normalizePath: file.normalize,
    loadFile: file.load,
    tabForPath: file.tab,
    openTab: layout.tabs().open,
    setActiveTab: layout.tabs().setActive,
  })
  const initialPath = props.projectPath || createCppMessageScratchPath(props)
  const draft = createMessageBlockDraftState({
    blockKey: props.blockKey,
    initialDraft: props.code,
    initialPath,
    cache,
    sdk,
    file,
    dialog,
    tabs: layout.tabs(),
    language,
    saveErrorTitle: language.t("session.cppFile.saveFailed"),
  })
  const state = draft.state
  const setState = draft.setState
  const save = draft.save
  const openInSidebar = draft.openInSidebar
  const bindFile = draft.bindFile
  const bindFileToPath = draft.bindFileToPath
  const describeError = draft.describeError
  const externalChanged = createMemo(() => {
    const checksum = file.get(state.bindingPath)?.content?.checksum
    return Boolean(state.dirty && checksum && state.baseChecksum && checksum !== state.baseChecksum)
  })
  const saveConflict = createMemo(() => isCppChecksumConflict(state.saveError))
  const run = async () => {
    const saved = await save("run")
    if (!saved) return
    try {
      await runCppFileInTerminal({
        sdk,
        terminal,
        openPanel: () => layout.view().terminal.open(),
        path: state.bindingPath,
      })
    } catch (error) {
      if (isMissingCppCompilerError(error)) {
        promptInstallManagedCppCompiler({
          globalSDK,
          language,
          onInstalled: () => run(),
        })
        return
      }
      showToast({
        variant: "error",
        title: language.t("session.cppFile.runFailed"),
        description: describeError(error),
      })
    }
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
        title: language.t("session.cppFile.reloadFailed"),
        description: describeError(error),
      })
    }
  }

  const runnable = createMemo(() => isCppRunnablePath(state.bindingPath))

  return (
    <MessageEditableCodeBlock
      blockKey={props.blockKey}
      languageID="cpp"
      title="C++"
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
      previewLabel={language.t("session.cppFile.preview")}
      diffLabel={language.t("session.cppFile.diff")}
      openInSidebarLabel={language.t("session.cppBlock.openInSidebar")}
      bindFileLabel={language.t("session.cppBlock.bindFile")}
      saveLabel={language.t("common.save")}
      savingLabel={language.t("common.saving")}
      savedLabel={language.t("session.cppFile.saved")}
      unsavedLabel={language.t("session.cppFile.unsaved")}
      externalChanged={externalChanged()}
      externalChangedLabel={language.t("session.cppFile.externalChanged")}
      saveConflict={saveConflict()}
      conflictLabel={language.t("session.cppFile.conflict")}
      reloadLabel={language.t("session.cppFile.reload")}
      onReload={reloadBindingFromDisk}
      onOpenPath={openLfcodeEditorPath}
      moreActions={
        <Show when={runnable()}>
          <>
            <DropdownMenu.Separator class="my-1 h-px bg-border-weak-base" />
            <DropdownMenu.Item class="rounded-lg" onSelect={() => void run()}>
              <div class="flex items-center gap-2.5">
                <Icon name="terminal" class="size-3.5 shrink-0 text-icon-weak-base" />
                <DropdownMenu.ItemLabel>{language.t("session.cppFile.run")}</DropdownMenu.ItemLabel>
              </div>
            </DropdownMenu.Item>
          </>
        </Show>
      }
    />
  )
}
