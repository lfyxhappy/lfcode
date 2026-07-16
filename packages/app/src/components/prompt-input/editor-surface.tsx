import { type Component, type ComponentProps, type JSX } from "solid-js"
import { PromptActionBar } from "./action-bar"
import { PromptContextItems } from "./context-items"
import { PromptDragOverlay } from "./drag-overlay"
import { PromptImageAttachments } from "./image-attachments"
import { PromptSelectedTextItems } from "./selected-text-items"

type PromptDragType = Parameters<typeof PromptDragOverlay>[0]["type"]
type PromptContextItemsProps = Parameters<typeof PromptContextItems>[0]
type PromptImageAttachmentsProps = Parameters<typeof PromptImageAttachments>[0]
type PromptActionBarProps = Parameters<typeof PromptActionBar>[0]
type PromptSelectedTextItemsProps = Parameters<typeof PromptSelectedTextItems>[0]

export const PromptEditorSurface: Component<{
  dragType: PromptDragType
  dragLabel: string
  selectedTextItems: PromptSelectedTextItemsProps["items"]
  onRemoveSelectedText: PromptSelectedTextItemsProps["remove"]
  contextItems: PromptContextItemsProps["items"]
  contextItemActive: PromptContextItemsProps["active"]
  onOpenContextComment: PromptContextItemsProps["openComment"]
  onRemoveContextItem: PromptContextItemsProps["remove"]
  t: PromptContextItemsProps["t"]
  imageAttachments: PromptImageAttachmentsProps["attachments"]
  onOpenImage: PromptImageAttachmentsProps["onOpen"]
  onRemoveImage: PromptImageAttachmentsProps["onRemove"]
  imageRemoveLabel: string
  setScrollRef: (el: HTMLDivElement) => void
  scrollPaddingBottom: string
  setEditorRef: (el: HTMLDivElement) => void
  editorLabel: string
  autocapitalize: "off" | "sentences"
  autocorrect: "off" | "on"
  spellcheck: boolean
  onInput: JSX.EventHandlerUnion<HTMLDivElement, InputEvent>
  onPaste: JSX.EventHandlerUnion<HTMLDivElement, ClipboardEvent>
  onCompositionStart: JSX.EventHandlerUnion<HTMLDivElement, CompositionEvent>
  onCompositionEnd: JSX.EventHandlerUnion<HTMLDivElement, CompositionEvent>
  onBlur: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  onKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
  editorClassList: ComponentProps<"div">["classList"]
  editorStyle: JSX.CSSProperties
  placeholder: string
  placeholderClassList: ComponentProps<"div">["classList"]
  placeholderStyle: JSX.CSSProperties
  placeholderHidden: boolean
  actionBar: PromptActionBarProps
}> = (props) => (
  <>
    <PromptDragOverlay type={props.dragType} label={props.dragLabel} />
    <PromptSelectedTextItems items={props.selectedTextItems} remove={props.onRemoveSelectedText} t={props.t} />
    <PromptContextItems
      items={props.contextItems}
      active={props.contextItemActive}
      openComment={props.onOpenContextComment}
      remove={props.onRemoveContextItem}
      t={props.t}
    />
    <PromptImageAttachments
      attachments={props.imageAttachments}
      onOpen={props.onOpenImage}
      onRemove={props.onRemoveImage}
      removeLabel={props.imageRemoveLabel}
    />
    <div class="relative">
      <div
        class="relative max-h-[240px] overflow-y-auto no-scrollbar"
        ref={props.setScrollRef}
        style={{ "scroll-padding-bottom": props.scrollPaddingBottom }}
      >
        <div
          data-component="prompt-input"
          ref={props.setEditorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={props.editorLabel}
          contenteditable="true"
          autocapitalize={props.autocapitalize}
          autocorrect={props.autocorrect}
          spellcheck={props.spellcheck}
          inputMode="text"
          // @ts-expect-error
          autocomplete="off"
          onInput={props.onInput}
          onPaste={props.onPaste}
          onCompositionStart={props.onCompositionStart}
          onCompositionEnd={props.onCompositionEnd}
          onBlur={props.onBlur}
          onKeyDown={props.onKeyDown}
          classList={props.editorClassList}
          style={props.editorStyle}
        />
        <div
          class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
          classList={props.placeholderClassList}
          style={{ ...props.placeholderStyle, display: props.placeholderHidden ? "none" : undefined }}
        >
          {props.placeholder}
        </div>
      </div>

      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: props.scrollPaddingBottom,
          "background-color": "var(--prompt-composer-surface, var(--surface-raised-stronger-non-alpha))",
        }}
      />

      <PromptActionBar {...props.actionBar} />
    </div>
  </>
)
