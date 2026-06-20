import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { ContextMenu } from "./context-menu"
import { AppIcon } from "./app-icon"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { useI18n } from "../context/i18n"
import { useFileReferenceContext, type FileReferenceApp } from "../context/file-reference"
import { inferFileReferenceKind, type FileReferenceKind } from "./file-reference-path"

export type { FileReferenceApp }
export type { FileReferenceKind } from "./file-reference-path"

export type FileReferenceProps = {
  path: string
  display?: string
  kind?: FileReferenceKind
  baseDir?: string
  clickable?: boolean
  showIcon?: boolean
  allowContextMenu?: boolean
  onPreview?: (path: string) => void
  onOpenDefaultApp?: (path: string) => void
  onOpenFolder?: (path: string) => void
  onOpenWith?: (path: string, app: string) => void
  onCopyPath?: (path: string) => void
  class?: string
  classList?: Record<string, boolean>
}

export function FileReference(props: FileReferenceProps) {
  const i18n = useI18n()
  const context = useFileReferenceContext()
  const [pressed, setPressed] = createSignal(false)
  const label = createMemo(() => props.display || props.path)
  const kind = createMemo(() => props.kind ?? context?.inferKind?.(props.path) ?? inferFileReferenceKind(props.path))
  const resolved = createMemo(() => context?.resolvePath?.(props.path, props.baseDir ?? context?.baseDir))
  const openTarget = createMemo(() => resolved() ?? props.path)
  const canPreviewPaths = createMemo(() => props.clickable ?? !!context?.canOpenPaths)
  const canPreview = createMemo(() => canPreviewPaths() && !!resolved() && !!(props.onPreview ?? context?.onPreviewPath))
  const canExternalOpen = createMemo(
    () => !!resolved() && !!(props.onOpenDefaultApp ?? context?.onOpenDefaultApp) && !!context?.canExternalOpenPaths,
  )
  const canOpenFolder = createMemo(
    () => kind() === "file" && !!resolved() && !!(props.onOpenFolder ?? context?.onOpenFolder),
  )
  const canCopy = createMemo(() => !!(props.onCopyPath ?? context?.onCopyPath))
  const allowContextMenu = createMemo(
    () =>
      props.allowContextMenu ??
      context?.allowContextMenu ??
      (canExternalOpen() || canOpenFolder() || canCopy()),
  )
  const openApps = createMemo(() => context?.openWithApps ?? [])

  const click = () => {
    if (!canPreview()) return
    ;(props.onPreview ?? context?.onPreviewPath)?.(openTarget()!)
  }

  const trigger = (
    <span
      data-component="file-reference"
      data-kind={kind()}
      class={props.class}
      classList={{
        clickable: canPreview(),
        pressed: pressed(),
        "text-text-interactive-base hover:underline underline-offset-2 cursor-pointer": canPreview() || allowContextMenu(),
        ...props.classList,
      }}
      onClick={(event) => {
        event.stopPropagation()
        click()
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      <Show when={props.showIcon}>
        <span data-slot="file-reference-icon">
          <Switch>
            <Match when={kind() === "directory"}>
              <Icon name="folder" size="small" />
            </Match>
            <Match when={true}>
              <FileIcon node={{ path: label(), type: "file" }} />
            </Match>
          </Switch>
        </span>
      </Show>
      <span data-slot="file-reference-label">{label()}</span>
    </span>
  )

  if (!allowContextMenu()) return trigger

  return (
    <ContextMenu>
      <ContextMenu.Trigger as="span">
        {trigger}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
      <Show when={canExternalOpen()}>
        <ContextMenu.Item
          onSelect={() => {
            ;(props.onOpenDefaultApp ?? context?.onOpenDefaultApp)?.(openTarget()!)
          }}
        >
          <Show when={openApps()[0]?.icon}>
            <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
              <AppIcon id={openApps()[0]!.icon!} />
            </div>
          </Show>
          <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.openDefaultApp")}</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </Show>
          <Show when={canOpenFolder()}>
            <ContextMenu.Item
              onSelect={() => {
                ;(props.onOpenFolder ?? context?.onOpenFolder)?.(openTarget()!)
              }}
            >
              <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.openFolder")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </Show>
          <Show when={openApps().length > 0 && !!resolved() && !!(props.onOpenWith ?? context?.onOpenWith)}>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger>{i18n.t("ui.fileReference.openWith")}</ContextMenu.SubTrigger>
              <ContextMenu.SubContent>
                <For each={openApps()}>
                  {(app) => (
                    <ContextMenu.Item
                      onSelect={() => {
                        ;(props.onOpenWith ?? context?.onOpenWith)?.(openTarget()!, app.openWith)
                      }}
                    >
                      <Show when={app.icon}>
                        <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                          <AppIcon id={app.icon!} />
                        </div>
                      </Show>
                      <ContextMenu.ItemLabel>{app.label}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                  )}
                </For>
              </ContextMenu.SubContent>
            </ContextMenu.Sub>
          </Show>
          <Show when={canCopy()}>
            <ContextMenu.Item
              onSelect={() => {
                ;(props.onCopyPath ?? context?.onCopyPath)?.(resolved() ?? props.path)
              }}
            >
              <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.copyPath")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
