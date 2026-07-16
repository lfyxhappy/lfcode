import { Button } from "@lfcode-ai/ui/button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { ProviderIcon } from "@lfcode-ai/ui/provider-icon"
import { Tooltip, TooltipKeybind } from "@lfcode-ai/ui/tooltip"
import { createSignal, For, Show, type Component, type JSX } from "solid-js"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { SessionContextUsage } from "@/components/session-context-usage"
import { PromptMoreMenu } from "./more-menu"

type ModelBinding = Parameters<typeof ModelSelectorPopover>[0]["model"]
type PromptMoreMenuFeatures = Parameters<typeof PromptMoreMenu>[0]["features"]

export const PromptControlStrip: Component<{
  shellMode: boolean
  shellLabel: string
  shellStyle: JSX.CSSProperties
  controlStyle: JSX.CSSProperties
  agentsLoading: boolean
  agentCycleTitle: string
  agentCycleKeybind?: string
  agentNames: string[]
  currentAgent: string
  onAgentSelect: (value: string) => void
  providersLoading: boolean
  paidProviderCount: number
  modelChooseTitle: string
  modelChooseKeybind?: string
  model: ModelBinding
  currentModelProviderID?: string
  currentModelLabel: string
  selectModelTitle: string
  onSelectUnpaidModel: VoidFunction
  onModelClose: VoidFunction
  submitTooltip: JSX.Element
  submitTooltipInactive: boolean
  submitDisabled: boolean
  submitLabel: string
  stopLabel: string
  stopping: boolean
  submitStyle: JSX.CSSProperties
  moreDisabled: boolean
  moreTabIndex?: number
  moreLabel: string
  onSubmit: VoidFunction
  hasGoal: boolean
  goalPaused: boolean
  features: PromptMoreMenuFeatures
  onGoalOpen: VoidFunction
  onGoalPauseToggle: VoidFunction
  onGoalDelete: VoidFunction
  onFeatureChange: Parameters<typeof PromptMoreMenu>[0]["onFeatureChange"]
}> = (props) => {
  const [agentMenuOpen, setAgentMenuOpen] = createSignal(false)

  return (
  <div data-prompt-control-strip="true" class="px-2.5 pt-1.5 pb-2.5 flex items-center gap-2 min-w-0">
    <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
      <div
        class="h-7 flex items-center gap-1.5 max-w-[160px] min-w-0 absolute inset-y-0 left-0"
        style={{
          padding: "0 4px 0 8px",
          ...props.shellStyle,
        }}
      >
        <span class="truncate text-13-medium text-text-strong">{props.shellLabel}</span>
        <div class="size-4 shrink-0" />
      </div>
      <div class="flex items-center gap-1.5 min-w-0 flex-1 h-7">
        <Show when={!props.agentsLoading}>
          <div data-component="prompt-agent-control" style={{ animation: "fade-in 0.3s" }}>
            <TooltipKeybind
              placement="top"
              gutter={4}
              title={props.agentCycleTitle}
              keybind={props.agentCycleKeybind ?? ""}
            >
              <DropdownMenu gutter={6} placement="bottom-start" open={agentMenuOpen()} onOpenChange={setAgentMenuOpen}>
                <DropdownMenu.Trigger
                  as={Button}
                  data-action="prompt-agent"
                  type="button"
                  variant="ghost"
                  class="capitalize max-w-[160px] min-w-0 h-7 px-2.5 text-13-regular text-text-base"
                  style={props.controlStyle}
                >
                  <span class="truncate">{props.currentAgent}</span>
                  <Icon name="chevron-down" size="small" class="shrink-0" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="min-w-[180px]">
                    <DropdownMenu.RadioGroup
                      value={props.currentAgent}
                      onChange={(agent) => {
                        if (typeof agent !== "string") return
                        if (!props.agentNames.includes(agent)) return
                        props.onAgentSelect(agent)
                        setAgentMenuOpen(false)
                      }}
                    >
                      <For each={props.agentNames}>
                        {(agent) => <DropdownMenu.RadioItem value={agent}>{agent}</DropdownMenu.RadioItem>}
                      </For>
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </TooltipKeybind>
          </div>
        </Show>
        <Show when={!props.shellMode}>
          <PromptMoreMenu
            style={props.controlStyle}
            disabled={props.moreDisabled}
            tabIndex={props.moreTabIndex}
            moreLabel={props.moreLabel}
            hasGoal={props.hasGoal}
            goalPaused={props.goalPaused}
            features={props.features}
            onGoalOpen={props.onGoalOpen}
            onGoalPauseToggle={props.onGoalPauseToggle}
            onGoalDelete={props.onGoalDelete}
            onFeatureChange={props.onFeatureChange}
          />
        </Show>
      </div>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      <SessionContextUsage placement="top" />
      <Show when={!props.providersLoading && !props.shellMode}>
        <div data-component="prompt-model-summary-control" style={{ animation: "fade-in 0.3s" }}>
          <Show
            when={props.paidProviderCount > 0}
            fallback={
              <TooltipKeybind
                placement="top"
                gutter={4}
                title={props.modelChooseTitle}
                keybind={props.modelChooseKeybind ?? ""}
              >
                <Button
                  data-action="prompt-model-summary"
                  type="button"
                  variant="ghost"
                  class="min-w-0 max-w-[360px] h-7 px-2.5 text-13-regular text-text-base group"
                  style={props.controlStyle}
                  onClick={props.onSelectUnpaidModel}
                >
                  <Show when={props.currentModelProviderID}>
                    <ProviderIcon
                      id={props.currentModelProviderID ?? ""}
                      class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                      style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                    />
                  </Show>
                  <span class="truncate">{props.currentModelLabel || props.selectModelTitle}</span>
                  <Icon name="chevron-down" size="small" class="shrink-0" />
                </Button>
              </TooltipKeybind>
            }
          >
            <TooltipKeybind
              placement="top"
              gutter={4}
              title={props.modelChooseTitle}
              keybind={props.modelChooseKeybind ?? ""}
            >
              <ModelSelectorPopover
                model={props.model}
                triggerAs={Button}
                triggerProps={{
                  variant: "ghost",
                  size: "normal",
                  style: props.controlStyle,
                  class: "min-w-0 max-w-[360px] h-7 px-2.5 text-13-regular text-text-base group",
                  "data-action": "prompt-model-summary",
                }}
                onClose={props.onModelClose}
              >
                <Show when={props.currentModelProviderID}>
                  <ProviderIcon
                    id={props.currentModelProviderID ?? ""}
                    class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                    style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                  />
                </Show>
                <span class="truncate">{props.currentModelLabel || props.selectModelTitle}</span>
                <Icon name="chevron-down" size="small" class="shrink-0" />
              </ModelSelectorPopover>
            </TooltipKeybind>
          </Show>
        </div>
      </Show>
      <Tooltip placement="top" inactive={props.submitTooltipInactive} value={props.submitTooltip}>
        <IconButton
          data-action="prompt-submit-inline"
          type="button"
          disabled={props.submitDisabled}
          icon={props.stopping ? "stop" : "arrow-up"}
          variant="primary"
          class="size-7 rounded-full mb-1.5"
          style={{
            ...props.submitStyle,
            transform: `${props.submitStyle.transform ?? ""} translateY(-8px)`,
          }}
          aria-label={props.stopping ? props.stopLabel : props.submitLabel}
          onClick={props.onSubmit}
        />
      </Tooltip>
    </div>
  </div>
  )
}
