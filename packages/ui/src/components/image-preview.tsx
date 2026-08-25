import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createMemo, createSignal, Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface ImagePreviewItem {
  src: string
  alt?: string
}

export interface ImagePreviewProps {
  src: string
  alt?: string
  images?: ImagePreviewItem[]
  initialIndex?: number
}

export function ImagePreview(props: ImagePreviewProps) {
  const i18n = useI18n()
  const images = createMemo(() => (props.images?.length ? props.images : [{ src: props.src, alt: props.alt }]))
  const [index, setIndex] = createSignal(Math.min(Math.max(props.initialIndex ?? 0, 0), images().length - 1))
  const image = createMemo(() => images()[index()])
  const hasPrevious = () => index() > 0
  const hasNext = () => index() < images().length - 1

  const move = (offset: -1 | 1) => {
    const next = index() + offset
    if (next < 0 || next >= images().length) return
    setIndex(next)
  }

  return (
    <div data-component="image-preview">
      <div data-slot="image-preview-container">
        <Kobalte.Content
          data-slot="image-preview-content"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              move(-1)
            }
            if (event.key === "ArrowRight") {
              event.preventDefault()
              move(1)
            }
          }}
        >
          <div data-slot="image-preview-header">
            <Kobalte.CloseButton
              data-slot="image-preview-close"
              as={IconButton}
              icon="close"
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
            />
          </div>
          <div data-slot="image-preview-body">
            <Show when={images().length > 1}>
              <IconButton
                data-slot="image-preview-previous"
                icon="chevron-left"
                variant="ghost"
                aria-label={i18n.t("ui.common.previous")}
                disabled={!hasPrevious()}
                onClick={() => move(-1)}
              />
            </Show>
            <img src={image().src} alt={image().alt ?? i18n.t("ui.imagePreview.alt")} data-slot="image-preview-image" />
            <Show when={images().length > 1}>
              <IconButton
                data-slot="image-preview-next"
                icon="chevron-right"
                variant="ghost"
                aria-label={i18n.t("ui.common.next")}
                disabled={!hasNext()}
                onClick={() => move(1)}
              />
            </Show>
          </div>
        </Kobalte.Content>
      </div>
    </div>
  )
}
