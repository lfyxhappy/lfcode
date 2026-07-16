import { Show, type Component } from "solid-js"
import { PromptWaitingBanner } from "./goal-banner"

export const PromptActionBar: Component<{
  waiting: boolean
  waitingTitle: string
  waitingDescription: string
  waitingEndLabel: string
  onWaitingEnd: VoidFunction
  inputRef?: (el: HTMLInputElement) => void
  accept: string
  onFilesSelected: (files: FileList) => void
}> = (props) => (
  <>
    <Show when={props.waiting}>
      <PromptWaitingBanner
        title={props.waitingTitle}
        description={props.waitingDescription}
        endLabel={props.waitingEndLabel}
        onEnd={props.onWaitingEnd}
      />
    </Show>

    <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
      <input
        ref={props.inputRef}
        type="file"
        multiple
        accept={props.accept}
        class="hidden"
        onChange={(event) => {
          const list = event.currentTarget.files
          if (list) props.onFilesSelected(list)
          event.currentTarget.value = ""
        }}
      />
    </div>
  </>
)
