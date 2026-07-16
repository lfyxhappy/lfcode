import { Component, For, Show, createSignal } from "solid-js"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import type { SelectedTextAttachmentPart } from "@/context/prompt"
import { removePromptAttachment } from "./attachment-motion"

type PromptSelectedTextItemsProps = {
  items: SelectedTextAttachmentPart[]
  remove: (item: SelectedTextAttachmentPart) => void
  t: (key: string) => string
}

export const PromptSelectedTextItems: Component<PromptSelectedTextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.items}>
          {(item, index) => {
            const [removing, setRemoving] = createSignal(false)
            return (
              <Tooltip value={item.text} placement="top" contentClass="max-w-[420px] break-words whitespace-pre-wrap">
                <div
                  data-component="prompt-attachment"
                  data-removing={removing() || undefined}
                  class="group inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border-base bg-surface-float-base/90 px-3 py-1.5 shadow-xs-border backdrop-blur-[10px] saturate-150"
                >
                  <div class="flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-[10px] font-medium text-text-weak">
                    "
                  </div>
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="shrink-0 text-11-medium text-text-weak">{props.t("prompt.selection.label")}</span>
                    <span class="shrink-0 text-12-regular text-text-strong">{index() + 1}</span>
                  </div>
                  <IconButton
                    type="button"
                    icon="close-small"
                    variant="ghost"
                    class="size-4 shrink-0 text-text-weak hover:text-text-strong"
                    onClick={() => {
                      if (removing()) return
                      removePromptAttachment(() => props.remove(item), setRemoving)
                    }}
                    aria-label={props.t("prompt.selection.remove")}
                  />
                </div>
              </Tooltip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
