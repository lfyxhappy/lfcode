import { Show, type Component } from "solid-js"
import { IconButton } from "./icon-button"

export type SelectedTextReferenceProps = {
  text: string
  comment?: string
  onRemove?: () => void
  removeLabel?: string
}

export const SelectedTextReference: Component<SelectedTextReferenceProps> = (props) => {
  const comment = () => props.comment?.trim()

  return (
    <div
      data-component="prompt-attachment"
      data-reference-type="selected-text"
      class="group flex min-w-0 max-w-full items-start gap-2 rounded-md border border-border-base bg-surface-raised-base px-2.5 py-2 shadow-xs-border"
    >
      <div class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-[10px] font-medium text-text-weak">
        "
      </div>
      <div class="min-w-0 flex-1">
        <div class="line-clamp-2 whitespace-pre-wrap break-words text-12-regular leading-5 text-text-strong">{props.text}</div>
        <Show when={comment()}>
          <div class="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-12-regular leading-5 text-text-weak">{comment()}</div>
        </Show>
      </div>
      <Show when={props.onRemove}>
        <IconButton
          type="button"
          icon="close-small"
          variant="ghost"
          class="-mr-1 -mt-1 size-7 shrink-0 text-text-weak opacity-0 pointer-events-none transition-[opacity,color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:text-text-strong focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base"
          onClick={() => props.onRemove?.()}
          aria-label={props.removeLabel}
        />
      </Show>
    </div>
  )
}
