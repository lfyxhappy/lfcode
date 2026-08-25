import type { ImageAttachmentPart } from "@/context/prompt"
import { attachmentMime } from "@/components/prompt-input/files"
import { uuid } from "@/utils/uuid"

export async function tavernImageAttachments(files: File[]) {
  const attachments = await Promise.all(files.map(tavernImageAttachment))
  return attachments.filter((attachment): attachment is ImageAttachmentPart => !!attachment)
}

export async function tavernImageAttachment(file: File): Promise<ImageAttachmentPart | undefined> {
  const mime = await attachmentMime(file)
  if (!mime?.startsWith("image/")) return
  const dataUrl = await fileDataUrl(file, mime)
  if (!dataUrl) return
  return { type: "image", id: uuid(), filename: file.name || "image", mime, dataUrl }
}

export function tavernCanSend(text: string, attachments: ImageAttachmentPart[]) {
  return !!text.trim() || attachments.length > 0
}

export function tavernNativeImageAttachment(input: Pick<ImageAttachmentPart, "filename" | "mime" | "dataUrl">): ImageAttachmentPart {
  return { type: "image", id: uuid(), ...input }
}

function fileDataUrl(file: File, mime: string) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const separator = value.indexOf(",")
      resolve(separator === -1 ? value : `data:${mime};base64,${value.slice(separator + 1)}`)
    })
    reader.readAsDataURL(file)
  })
}
