import { Component, For, Show } from "solid-js"
import { SelectedTextReference } from "@lfcode-ai/ui/selected-text-reference"
import type { SelectedTextAttachmentPart } from "@/context/prompt"

type PromptSelectedTextItemsProps = {
  items: SelectedTextAttachmentPart[]
  remove: (item: SelectedTextAttachmentPart) => void
  t: (key: string) => string
}

export const PromptSelectedTextItems: Component<PromptSelectedTextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div class="flex max-w-full flex-col gap-2 px-3 pt-3">
        <For each={props.items}>
          {(item) => (
            <SelectedTextReference
              text={item.text}
              comment={item.comment}
              onRemove={() => props.remove(item)}
              removeLabel={props.t("prompt.selection.remove")}
            />
          )}
        </For>
      </div>
    </Show>
  )
}
