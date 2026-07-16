import { extname, relative, resolve } from "node:path"

const SAFE_DOCUMENT_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".json",
  ".md",
  ".pdf",
  ".png",
  ".txt",
  ".webp",
])

export function downloadNeedsOpenConfirmation(filename: string) {
  const extension = extname(filename).toLowerCase()
  return !extension || !SAFE_DOCUMENT_EXTENSIONS.has(extension)
}

export function isManagedAutomationDownload(path: string, userData: string) {
  const root = resolve(userData, "output", "browser-downloads")
  const nested = relative(root, resolve(path))
  return nested !== "" && !nested.startsWith("..") && !nested.includes(":")
}
