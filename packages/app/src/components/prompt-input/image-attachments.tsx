import { Component, Index, Show } from "solid-js"
import { Icon } from "@lfcode-ai/ui/icon"
import { ThumbnailImage } from "@lfcode-ai/ui/image-thumbnail"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import type { ImageAttachmentPart } from "@/context/prompt"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute right-1 top-1 z-10 flex size-7 items-center justify-center rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-weak opacity-0 shadow-xs-border pointer-events-none transition-[opacity,background-color,color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-surface-raised-base-hover hover:text-text-strong focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <Index each={props.attachments}>
          {(attachment) => {
            return (
              <Tooltip value={attachment().filename} placement="top" contentClass="break-all">
                <div data-component="prompt-attachment" class="relative group">
                  <Show
                    when={attachment().mime.startsWith("image/")}
                    fallback={
                      <div class={fallbackClass}>
                        <Icon name="folder" class="size-6 text-text-weak" />
                      </div>
                    }
                  >
                    <button
                      type="button"
                      class="block rounded-md bg-transparent p-0 border-0"
                      onClick={() => props.onOpen(attachment())}
                    >
                      <ThumbnailImage
                        src={attachment().dataUrl}
                        alt={attachment().filename}
                        previewSrc={attachment().previewDataUrl}
                        byteSize={attachment().byteSize}
                        cacheKey={attachment().id}
                        class={imageClass}
                        placeholderClass={imageClass}
                      />
                    </button>
                  </Show>
                  <button
                    type="button"
                    onClick={() => props.onRemove(attachment().id)}
                    class={removeClass}
                    aria-label={props.removeLabel}
                  >
                    <Icon name="close" class="size-3.5" />
                  </button>
                  <div class={nameClass}>
                    <span class="text-10-regular text-white truncate block">{attachment().filename}</span>
                  </div>
                </div>
              </Tooltip>
            )
          }}
        </Index>
      </div>
    </Show>
  )
}
