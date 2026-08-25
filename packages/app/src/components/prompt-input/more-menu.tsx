import { Button } from "@lfcode-ai/ui/button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { For, Show, type Component, type JSX } from "solid-js"
import type { PromptFeature } from "@/utils/prompt-features"

const PromptMoreMenuRow: Component<{
  icon: "brain" | "checklist" | "circle-check" | "task" | "trash" | "window-cursor"
  label: string
  description?: string
}> = (props) => (
  <>
    <Icon name={props.icon} size="small" class="mt-0.5 shrink-0 text-icon-weak" />
    <div class="min-w-0 flex-1">
      <DropdownMenu.ItemLabel class="text-13-medium text-text-base">{props.label}</DropdownMenu.ItemLabel>
      <Show when={props.description}>
        <DropdownMenu.ItemDescription class="mt-0.5 whitespace-normal break-words text-12-regular text-text-weak">
          {props.description}
        </DropdownMenu.ItemDescription>
      </Show>
    </div>
  </>
)

type PromptMoreMenuFeature = {
  id: PromptFeature
  label: string
  description: string
  checked: boolean
}

export const PromptMoreMenu: Component<{
  style: JSX.CSSProperties
  disabled: boolean
  tabIndex?: number
  moreLabel: string
  scheduleAutomationLabel: string
  scheduleAutomationDisabled: boolean
  onScheduleAutomation: VoidFunction
  subagentDispatchLabel: string
  subagentDispatchDisabled: boolean
  onSubagentDispatch: VoidFunction
  hasGoal: boolean
  goalPaused: boolean
  features: PromptMoreMenuFeature[]
  onGoalOpen: VoidFunction
  onGoalPauseToggle: VoidFunction
  onGoalDelete: VoidFunction
  onFeatureChange: (feature: PromptFeature, checked: boolean) => void
}> = (props) => (
  <div data-component="prompt-more-control" style={{ animation: "fade-in 0.3s" }}>
    <DropdownMenu gutter={6} placement="bottom-start">
      <DropdownMenu.Trigger
        as={Button}
        data-action="prompt-more"
        type="button"
        variant="ghost"
        class="h-7 max-w-[140px] px-2 text-13-regular text-text-base"
        style={props.style}
        disabled={props.disabled}
        tabIndex={props.tabIndex}
        aria-label={props.moreLabel}
      >
        <span class="truncate">{props.moreLabel}</span>
        <Icon name="chevron-down" size="small" class="shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="w-[360px] max-w-[calc(100vw-24px)] whitespace-normal">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel>{props.moreLabel}</DropdownMenu.GroupLabel>
            <DropdownMenu.Item
              data-action="prompt-schedule-automation"
              disabled={props.scheduleAutomationDisabled}
              onSelect={props.onScheduleAutomation}
              class="min-w-0 items-start py-2"
            >
              <PromptMoreMenuRow icon="task" label={props.scheduleAutomationLabel} />
            </DropdownMenu.Item>
            <DropdownMenu.Item
              data-action="prompt-subagent-dispatch"
              disabled={props.subagentDispatchDisabled}
              onSelect={props.onSubagentDispatch}
              class="min-w-0 items-start py-2"
            >
              <PromptMoreMenuRow icon="brain" label={props.subagentDispatchLabel} />
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={props.onGoalOpen} class="min-w-0 items-start py-2">
              <PromptMoreMenuRow
                icon="checklist"
                label={props.hasGoal ? "编辑 Goal" : "创建 Goal"}
                description={
                  props.hasGoal
                    ? "修改当前会话 goal，并保留累计统计。"
                    : "让模型持续工作，直到当前 goal 满足、阻塞或被你手动结束。"
                }
              />
            </DropdownMenu.Item>
            <Show when={props.hasGoal}>
              <DropdownMenu.Item onSelect={props.onGoalPauseToggle} class="min-w-0 items-start py-2">
                <PromptMoreMenuRow icon="circle-check" label={props.goalPaused ? "恢复 Goal" : "暂停 Goal"} />
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={props.onGoalDelete} class="min-w-0 items-start py-2">
                <PromptMoreMenuRow icon="trash" label="删除 Goal" />
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
            </Show>
            <For each={props.features}>
              {(feature) => (
                <DropdownMenu.CheckboxItem
                  checked={feature.checked}
                  onChange={(checked) => props.onFeatureChange(feature.id, checked)}
                  class="min-w-0 items-start py-2"
                >
                  <PromptMoreMenuRow icon="window-cursor" label={feature.label} description={feature.description} />
                  <DropdownMenu.ItemIndicator class="text-icon-primary-base">
                    <Icon name="check" size="small" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.CheckboxItem>
              )}
            </For>
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  </div>
)
