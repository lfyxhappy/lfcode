import { Button } from "@lfcode-ai/ui/button"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { type Component } from "solid-js"

export const PromptGoalDialog: Component<{
  mode: "create" | "edit"
  value: string
  saving: boolean
  cancelLabel: string
  saveLabel: string
  onInput: (value: string) => void
  onCancel: VoidFunction
  onSave: VoidFunction
}> = (props) => (
  <Dialog title={props.mode === "edit" ? "编辑 Goal" : "创建 Goal"} fit>
    <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
      <div class="flex flex-col gap-2">
        <span class="text-14-regular text-text-weak">
          {props.mode === "edit" ? "修改当前 goal，保留累计统计。" : "创建一个会话级 goal，模型会持续工作到它满足或被你终止。"}
        </span>
        <textarea
          class="min-h-[140px] w-[520px] max-w-full resize-y rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-strong outline-none"
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          placeholder="例如：完成当前版本发布，并确认安装包可正常安装"
        />
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="large" onClick={props.onCancel}>
          {props.cancelLabel}
        </Button>
        <Button variant="primary" size="large" disabled={!props.value.trim() || props.saving} onClick={props.onSave}>
          {props.saveLabel}
        </Button>
      </div>
    </div>
  </Dialog>
)
