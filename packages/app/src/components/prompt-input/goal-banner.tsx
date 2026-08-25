import { Button } from "@lfcode-ai/ui/button"
import { Show, type Component } from "solid-js"

export const PromptGoalBanner: Component<{
  objective?: string
  condition?: string
  statusLabel: string
  tokensLabel: string
  elapsedLabel: string
  editLabel: string
  deleteLabel: string
  paused: boolean
  onEdit: VoidFunction
  onPause: VoidFunction
  onResume: VoidFunction
  onDelete: VoidFunction
}> = (props) => (
  <div class="mb-2 rounded-md border border-border-weak-base bg-background-base px-3 py-2">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-12-medium text-text-weak">
          <span>Goal</span>
          <span>{props.statusLabel}</span>
          <span>{props.tokensLabel}</span>
          <span>{props.elapsedLabel}</span>
        </div>
        <div class="mt-1 truncate text-13-regular text-text-strong">{props.objective ?? props.condition}</div>
      </div>
      <div class="flex items-center gap-1">
        <Button type="button" size="small" variant="ghost" onClick={props.onEdit}>
          {props.editLabel}
        </Button>
        <Show
          when={props.paused}
          fallback={
            <Button type="button" size="small" variant="ghost" onClick={props.onPause}>
              暂停
            </Button>
          }
        >
          <Button type="button" size="small" variant="ghost" onClick={props.onResume}>
            恢复
          </Button>
        </Show>
        <Button type="button" size="small" variant="ghost" onClick={props.onDelete}>
          {props.deleteLabel}
        </Button>
      </div>
    </div>
  </div>
)

export const PromptWaitingBanner: Component<{
  title: string
  description: string
  endLabel: string
  onEnd: VoidFunction
}> = (props) => (
  <div class="pointer-events-none absolute inset-x-0 bottom-11 px-3">
    <div class="pointer-events-auto flex items-center justify-between gap-3 rounded-md border border-border-weak-base bg-background-base px-3 py-2 shadow-xs">
      <div class="min-w-0">
        <div class="text-12-medium text-text-strong">{props.title}</div>
        <div class="text-11-regular text-text-weak">{props.description}</div>
      </div>
      <Button type="button" variant="secondary" size="small" class="shrink-0" onClick={props.onEnd}>
        {props.endLabel}
      </Button>
    </div>
  </div>
)
