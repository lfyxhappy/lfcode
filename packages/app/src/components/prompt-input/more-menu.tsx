import { Button } from "@lfcode-ai/ui/button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { For, Show, type Component, type JSX } from "solid-js"
import type { PromptFeature } from "@/utils/prompt-features"

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
        <DropdownMenu.Content class="min-w-[280px]">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel>{props.moreLabel}</DropdownMenu.GroupLabel>
            <DropdownMenu.Item onSelect={props.onGoalOpen}>
              <div class="flex min-w-0 flex-col">
                <DropdownMenu.ItemLabel class="text-13-medium text-text-base">
                  {props.hasGoal ? "编辑 Goal" : "创建 Goal"}
                </DropdownMenu.ItemLabel>
                <DropdownMenu.ItemDescription class="text-12-regular text-text-weak whitespace-normal">
                  {props.hasGoal
                    ? "修改当前会话 goal，并保留累计统计。"
                    : "让模型持续工作，直到当前 goal 满足、阻塞或被你手动结束。"}
                </DropdownMenu.ItemDescription>
              </div>
            </DropdownMenu.Item>
            <Show when={props.hasGoal}>
              <DropdownMenu.Item onSelect={props.onGoalPauseToggle}>
                <div class="flex min-w-0 flex-col">
                  <DropdownMenu.ItemLabel class="text-13-medium text-text-base">
                    {props.goalPaused ? "恢复 Goal" : "暂停 Goal"}
                  </DropdownMenu.ItemLabel>
                </div>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={props.onGoalDelete}>
                <div class="flex min-w-0 flex-col">
                  <DropdownMenu.ItemLabel class="text-13-medium text-text-base">删除 Goal</DropdownMenu.ItemLabel>
                </div>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
            </Show>
            <For each={props.features}>
              {(feature) => (
                <DropdownMenu.CheckboxItem
                  checked={feature.checked}
                  onChange={(checked) => props.onFeatureChange(feature.id, checked)}
                  class="min-w-0"
                >
                  <div class="flex items-start gap-2 min-w-0">
                    <DropdownMenu.ItemIndicator class="pt-0.5 text-icon-primary-base">
                      <Icon name="check" size="small" />
                    </DropdownMenu.ItemIndicator>
                    <div class="min-w-0">
                      <DropdownMenu.ItemLabel class="text-13-medium text-text-base">
                        {feature.label}
                      </DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemDescription class="text-12-regular text-text-weak whitespace-normal">
                        {feature.description}
                      </DropdownMenu.ItemDescription>
                    </div>
                  </div>
                </DropdownMenu.CheckboxItem>
              )}
            </For>
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  </div>
)
