import { Component, For, Show, createSignal } from "solid-js"
import { Icon } from "@lfcode-ai/ui/icon"
import { ThumbnailImage } from "@lfcode-ai/ui/image-thumbnail"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import type { ImageAttachmentPart } from "@/context/prompt"
import { removePromptAttachment } from "./attachment-motion"

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
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.attachments}>
          {(attachment) => {
            const [removing, setRemoving] = createSignal(false)
            return (
              <Tooltip value={attachment.filename} placement="top" contentClass="break-all">
                <div data-component="prompt-attachment" data-removing={removing() || undefined} class="relative group">
                <Show
                  when={attachment.mime.startsWith("image/")}
                  fallback={
                    <div class={fallbackClass}>
                      <Icon name="folder" class="size-6 text-text-weak" />
                    </div>
                  }
                >
                  <button
                    type="button"
                    class="block rounded-md bg-transparent p-0 border-0"
                    onClick={() => props.onOpen(attachment)}
                  >
                    <ThumbnailImage
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      previewSrc={attachment.previewDataUrl}
                      byteSize={attachment.byteSize}
                      cacheKey={attachment.id}
                      class={imageClass}
                      placeholderClass={imageClass}
                    />
                  </button>
                </Show>
                <button
                  type="button"
                  onClick={() => {
                    if (removing()) return
                    removePromptAttachment(() => props.onRemove(attachment.id), setRemoving)
                  }}
                  class={removeClass}
                  aria-label={props.removeLabel}
                >
                  <Icon name="close" class="size-3 text-text-weak" />
                </button>
                <div class={nameClass}>
                  <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                </div>
                </div>
              </Tooltip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
