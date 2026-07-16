import type { ImageAttachmentPart, Prompt } from "@/context/prompt"
import type { SlashCommand } from "./slash-popover"

export function promptSlashSelectionResult(
  command: SlashCommand,
  emptyPrompt: Prompt,
  images: ImageAttachmentPart[],
) {
  if (command.type === "custom") {
    const text = `/${command.trigger} `
    return {
      kind: "custom" as const,
      text,
      prompt: [{ type: "text", content: text, start: 0, end: text.length }, ...images] satisfies Prompt,
      cursor: text.length,
    }
  }

  return {
    kind: "builtin" as const,
    prompt: [...emptyPrompt, ...images] satisfies Prompt,
    commandID: command.id,
  }
}
