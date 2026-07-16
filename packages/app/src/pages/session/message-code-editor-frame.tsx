import { Button } from "@lfcode-ai/ui/button"
import { Icon, type IconProps } from "@lfcode-ai/ui/icon"
import DropdownMenu from "@/components/code-editor/core/dropdown-menu"
import { useLanguage } from "@/context/language"
import { Show, type JSX, type ParentProps } from "solid-js"

type MessageCodeEditorFrameProps = ParentProps<{
  rootRef?: HTMLDivElement | ((el: HTMLDivElement) => void)
  blockKey: string
  languageID: string
  title: string
  path: string
  mode: "preview" | "edit" | "diff"
  saving: boolean
  dirty: boolean
  externalChanged?: boolean
  saveConflict?: boolean
  editLabel: string
  previewLabel: string
  diffLabel: string
  openInSidebarLabel: string
  bindFileLabel: string
  reloadLabel?: string
  saveLabel: string
  savingLabel: string
  savedLabel: string
  unsavedLabel: string
  onModeChange: (mode: "preview" | "edit" | "diff") => void
  onOpenInSidebar: () => void
  onBindFile: () => void
  onReload?: () => void
  onSave: () => void
  leadingActions?: JSX.Element
  moreActions?: JSX.Element
  status?: JSX.Element
}>

export function MessageCodeEditorFrame(props: MessageCodeEditorFrameProps) {
  const language = useLanguage()
  const toolbarButtonClass = "size-8 min-w-8 rounded-lg p-0"
  const toolbarIconClass = "size-4"
  const moreMenuContentClass = "min-w-[220px] rounded-xl border border-border-weak-base bg-background-panel p-1.5 shadow-2xl"
  const moreMenuItemClass = "rounded-lg"
  const currentModeIcon = () => (props.mode === "edit" ? "edit" : props.mode === "diff" ? "code" : "eye")
  const currentModeLabel = () => (props.mode === "edit" ? props.editLabel : props.mode === "diff" ? props.diffLabel : props.previewLabel)
  const showSaveAction = () => props.dirty || props.saving
  const showStatusRow = () =>
    props.saving || props.dirty || props.externalChanged || props.saveConflict || Boolean(props.status)
  const renderMenuLabel = (input: { icon: IconProps["name"]; label: string }) => (
    <div class="flex items-center gap-2.5">
      <Icon name={input.icon} class="size-3.5 shrink-0 text-icon-weak-base" />
      <DropdownMenu.ItemLabel>{input.label}</DropdownMenu.ItemLabel>
    </div>
  )

  return (
    <div
      ref={props.rootRef}
      data-automation-id="session-message-code-block"
      data-block-key={props.blockKey}
      data-language-id={props.languageID}
      data-binding-path={props.path}
      data-editor-mode={props.mode}
      data-external-changed={props.externalChanged ? "true" : "false"}
      data-save-conflict={props.saveConflict ? "true" : "false"}
      class="my-3 overflow-hidden rounded-xl border border-border-weak-base bg-background-base"
    >
      <div class="sr-only">
        <Show when={props.onReload && props.reloadLabel}>
          <button
            type="button"
            data-automation-id="message-code-block-reload"
            disabled={props.saving}
            onClick={() => props.onReload?.()}
          >
            {props.reloadLabel}
          </button>
        </Show>
        <button
          type="button"
          data-automation-id="message-code-block-open-sidebar"
          disabled={props.saving}
          onClick={props.onOpenInSidebar}
        >
          {props.openInSidebarLabel}
        </button>
        <button
          type="button"
          data-automation-id="message-code-block-bind-file"
          disabled={props.saving}
          onClick={props.onBindFile}
        >
          {props.bindFileLabel}
        </button>
        <button
          type="button"
          data-automation-id="message-code-block-edit"
          disabled={props.saving}
          onClick={() => props.onModeChange("edit")}
        >
          {props.editLabel}
        </button>
        <button
          type="button"
          data-automation-id="message-code-block-preview"
          disabled={props.saving}
          onClick={() => props.onModeChange("preview")}
        >
          {props.previewLabel}
        </button>
        <button
          type="button"
          data-automation-id="message-code-block-diff"
          disabled={props.saving}
          onClick={() => props.onModeChange("diff")}
        >
          {props.diffLabel}
        </button>
      </div>
      <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong">{props.title}</div>
          <div class="truncate text-11-regular text-text-weak">{props.path}</div>
        </div>
        <div class="shrink-0 flex items-center gap-1.5">
          {props.leadingActions}
          <DropdownMenu gutter={6} placement="bottom-end">
            <DropdownMenu.Trigger
              as={Button}
              type="button"
              size="small"
              variant="ghost"
              class={toolbarButtonClass}
              title={currentModeLabel()}
              aria-label={currentModeLabel()}
              data-automation-id="message-code-block-mode-menu"
            >
              <Icon name={currentModeIcon()} class={toolbarIconClass} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class={moreMenuContentClass}>
                <DropdownMenu.Item class={moreMenuItemClass} onSelect={() => props.onModeChange("edit")}>
                  {renderMenuLabel({ icon: "edit", label: props.editLabel })}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={moreMenuItemClass} onSelect={() => props.onModeChange("preview")}>
                  {renderMenuLabel({ icon: "eye", label: props.previewLabel })}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={moreMenuItemClass} onSelect={() => props.onModeChange("diff")}>
                  {renderMenuLabel({ icon: "code", label: props.diffLabel })}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
          <Show when={showSaveAction()}>
            <Button
              type="button"
              size="small"
              variant="ghost"
              class={toolbarButtonClass}
              data-automation-id="message-code-block-save"
              title={props.saveLabel}
              aria-label={props.saveLabel}
              disabled={props.saving || !props.dirty}
              onClick={props.onSave}
            >
              <Icon name="check" class={toolbarIconClass} />
            </Button>
          </Show>
          <DropdownMenu gutter={6} placement="bottom-end">
            <DropdownMenu.Trigger
              as={Button}
              type="button"
              size="small"
              variant="ghost"
              class={toolbarButtonClass}
              title={language.t("common.moreOptions")}
              aria-label={language.t("common.moreOptions")}
              data-automation-id="message-code-block-more-actions"
            >
              <Icon name="dot-grid" class={toolbarIconClass} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class={moreMenuContentClass}>
                <Show when={props.onReload && props.reloadLabel}>
                  <DropdownMenu.Item class={moreMenuItemClass} onSelect={() => props.onReload?.()}>
                    {renderMenuLabel({ icon: "reset", label: props.reloadLabel! })}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator class="my-1 h-px bg-border-weak-base" />
                </Show>
                <DropdownMenu.Item class={moreMenuItemClass} onSelect={props.onOpenInSidebar}>
                  {renderMenuLabel({ icon: "layout-right-partial", label: props.openInSidebarLabel })}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={moreMenuItemClass} onSelect={props.onBindFile}>
                  {renderMenuLabel({ icon: "link", label: props.bindFileLabel })}
                </DropdownMenu.Item>
                {props.moreActions}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      </div>

      <Show when={showStatusRow()}>
        <div class="flex items-center gap-2 px-3 py-2 text-11-regular text-text-weak">
          <Show when={!props.externalChanged && !props.saveConflict && props.saving}>
            <span>{props.savingLabel}</span>
          </Show>
          <Show when={!props.externalChanged && !props.saveConflict && !props.saving && props.dirty}>
            <span
              class="size-2 shrink-0 rounded-full bg-status-warning"
              title={props.unsavedLabel}
              aria-label={props.unsavedLabel}
            />
          </Show>
          {props.status}
        </div>
      </Show>

      {props.children}
    </div>
  )
}
