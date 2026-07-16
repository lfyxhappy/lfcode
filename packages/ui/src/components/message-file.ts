import type { FilePart } from "@lfcode-ai/sdk/v2"
import { isInlineImageCacheUrl } from "./inline-image-cache"

export function attached(part: FilePart) {
  return part.url.startsWith("data:") || isInlineImageCacheUrl(part.url)
}

export function inline(part: FilePart) {
  if (attached(part)) return false
  return part.source?.text?.start !== undefined && part.source?.text?.end !== undefined
}

export function kind(part: FilePart) {
  return part.mime.startsWith("image/") ? "image" : "file"
}
