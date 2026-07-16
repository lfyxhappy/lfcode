import { createMemo, Show, type Accessor, type JSX } from "solid-js"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@lfcode-ai/ui/tooltip"

export const SidebarContent = (props: {
  mobile?: boolean
  sections: Accessor<JSX.Element[]>
  onOpenProject?: () => void
  openProjectLabel?: JSX.Element
  openProjectKeybind?: Accessor<string | undefined>
  settingsOpen: Accessor<boolean>
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  onCloseSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
}): JSX.Element => {
  const placement = () => (props.mobile ? "bottom" : "right")
  const settingsIcon = createMemo(() => (props.settingsOpen() ? "arrow-left" : "settings-gear"))
  const toggleSettings = () => {
    if (props.settingsOpen()) {
      props.onCloseSettings()
      return
    }
    props.onOpenSettings()
  }
  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        <div class="flex-1 min-h-0 min-w-0 overflow-y-auto no-scrollbar px-3 py-3">
          <div class="flex flex-col gap-4">{props.sections()}</div>
        </div>
        <div class="shrink-0 px-3 py-3 flex items-center justify-between gap-2 border-t border-border-weak-base">
          <div class="flex items-center gap-2">
            <Show when={props.onOpenProject && props.openProjectLabel}>
              <Tooltip
                placement={placement()}
                value={
                  <div class="flex items-center gap-2">
                    <span>{props.openProjectLabel}</span>
                    <Show when={!props.mobile && !!props.openProjectKeybind?.()}>
                      <span class="text-icon-base text-12-medium">{props.openProjectKeybind?.()}</span>
                    </Show>
                  </div>
                }
              >
                <IconButton
                  icon="plus"
                  variant="ghost"
                  size="large"
                  onClick={props.onOpenProject}
                  aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
                />
              </Tooltip>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <TooltipKeybind
              placement={placement()}
              title={props.settingsLabel()}
              keybind={props.settingsOpen() ? "" : (props.settingsKeybind?.() ?? "")}
            >
              <IconButton
                icon={settingsIcon()}
                variant="ghost"
                size="large"
                data-action="settings-toggle"
                onClick={toggleSettings}
                aria-label={props.settingsLabel()}
              />
            </TooltipKeybind>
            <Tooltip placement={placement()} value={props.helpLabel()}>
              <IconButton
                icon="help"
                variant="ghost"
                size="large"
                onClick={props.onOpenHelp}
                aria-label={props.helpLabel()}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}
