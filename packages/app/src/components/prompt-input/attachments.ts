import { onCleanup, onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { prepareImagePreview } from "@lfcode-ai/ui/image-thumbnail"
import { showToast } from "@lfcode-ai/ui/toast"
import type { ContentPart, ImageAttachmentPart, Prompt, PromptScope } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"
import { attachmentMime } from "./files"
import { normalizePaste } from "./paste"

function dataUrl(file: File, mime: string) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const idx = value.indexOf(",")
      if (idx === -1) {
        resolve(value)
        return
      }
      resolve(`data:${mime};base64,${value.slice(idx + 1)}`)
    })
    reader.readAsDataURL(file)
  })
}

type PromptAttachmentsInput = {
  scope: () => PromptScope | undefined
  root: () => HTMLElement | undefined
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  readDroppedImage?: (path: string) => Promise<{ dataUrl: string; filename: string; mime: string } | null>
  currentPrompt: (scope?: PromptScope) => Prompt
  currentCursor: (scope?: PromptScope) => number | undefined
  setPrompt: (next: Prompt, cursorPosition?: number, scope?: PromptScope) => void
  onNativeFileTransfer?: (cb: (transfer: { dropzone?: string; paths: string[]; images: string[] }) => void) => () => void
}

type TransferData = {
  getData: (type: string) => string
}

function filePath(value: string) {
  const path = value.trim()
  if (!path || path.startsWith("#")) return

  if (path.startsWith("file://")) {
    const encoded = path.slice("file://".length)
    const decoded = (() => {
      try {
        return decodeURIComponent(encoded)
      } catch {
        return encoded
      }
    })()
    return (/^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded).replaceAll("\\", "/")
  }

  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) return path.replaceAll("\\", "/")
}

export function transferredFilePaths(data: TransferData) {
  return [...new Set(
    [data.getData("text/uri-list"), data.getData("text/plain"), data.getData("text")]
      .flatMap((value) => value.split(/\r?\n/))
      .map(filePath)
      .filter((path): path is string => !!path),
  )]
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const language = useLanguage()
  const matchesRoot = (target: EventTarget | null | undefined) => {
    const root = input.root()
    if (!root || !(target instanceof Node)) return false
    if (root.contains(target)) return true
    return target instanceof Element && target.contains(root)
  }

  const warn = () => {
    showToast({
      title: language.t("prompt.toast.pasteUnsupported.title"),
      description: language.t("prompt.toast.pasteUnsupported.description"),
    })
  }

  const addImage = async (
    inputAttachment: Omit<ImageAttachmentPart, "id" | "previewDataUrl" | "byteSize">,
    scope = input.scope(),
  ) => {
    const editor = input.editor()
    if (!editor) return false
    const attachment: ImageAttachmentPart = {
      id: uuid(),
      ...inputAttachment,
    }
    const preview = attachment.mime.startsWith("image/")
      ? await prepareImagePreview({
          src: attachment.dataUrl,
          cacheKey: attachment.id,
        })
      : { previewDataUrl: undefined, byteSize: undefined }
    attachment.previewDataUrl = preview.previewDataUrl
    attachment.byteSize = preview.byteSize
    const cursor = input.currentCursor(scope) ?? getCursorPosition(editor)
    input.setPrompt([...input.currentPrompt(scope), attachment], cursor, scope)
    return true
  }

  const add = async (file: File, toast = true, scope = input.scope()) => {
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) warn()
      return false
    }

    const url = await dataUrl(file, mime)
    if (!url) return false

    return addImage({
      type: "image",
      filename: file.name,
      mime,
      dataUrl: url,
    }, scope)
  }

  const addAttachment = (file: File) => add(file)

  const addAttachments = async (files: File[], toast = true, scope = input.scope()) => {
    let found = false

    for (const file of files) {
      const ok = await add(file, false, scope)
      if (ok) found = true
    }

    if (!found && files.length > 0 && toast) warn()
    return found
  }

  const addDroppedFiles = async (files: File[], scope = input.scope()) => {
    const paths = input.getPathForFile
      ? files.flatMap((file) => {
          try {
            const path = input.getPathForFile?.(file)
            return path ? [path.replaceAll("\\", "/")] : []
          } catch {
            return []
          }
        })
      : []
    if (addFilePaths(paths, scope)) return true
    return addAttachments(files, true, scope)
  }

  const addDroppedImages = async (paths: string[], scope = input.scope()) => {
    if (!input.readDroppedImage) return false
    let found = false
    for (const path of paths) {
      const image = await input.readDroppedImage(path)
      if (!image) continue
      if (await addImage({ type: "image", ...image }, scope)) found = true
    }
    return found
  }

  const removeAttachment = (id: string) => {
    const scope = input.scope()
    const current = input.currentPrompt(scope)
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    input.setPrompt(next, input.currentCursor(scope), scope)
  }

  const addFilePaths = (paths: string[], scope = input.scope()) => {
    const current = input.currentPrompt(scope)
    const existing = new Set(current.filter((part) => part.type === "file").map((part) => part.path))
    const next = paths.reduce<Prompt>((result, path) => {
      if (existing.has(path)) return result
      existing.add(path)
      const start = result.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)
      const content = "@" + path
      return [...result, { type: "file", path, content, start, end: start + content.length }]
    }, current)
    if (next === current) return false
    input.setPrompt(next, next.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0), scope)
    input.focusEditor()
    return true
  }

  const addPastedText = (text: string) => {
    if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
    input.focusEditor()
    return input.addPart({ type: "text", content: text, start: 0, end: 0 })
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const scope = input.scope()
    if (addFilePaths(transferredFilePaths(clipboardData), scope)) return

    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })

    if (files.length > 0) {
      await addAttachments(files, true, scope)
      return
    }

    const text = normalizePaste(clipboardData.getData("text/plain") ?? "")
    if (text) {
      addPastedText(text)
      return
    }

    // Electron exposes some DIB screenshots only through the native clipboard bridge.
    if (input.readClipboardImage) {
      const file = await input.readClipboardImage()
      if (file) {
        await add(file, true, scope)
        return
      }
    }

    return
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!matchesRoot(event.target)) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      input.setDraggingType("image")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!matchesRoot(event.target) && event.relatedTarget && matchesRoot(event.relatedTarget)) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!matchesRoot(event.target)) return

    event.preventDefault()
    input.setDraggingType(null)

    const scope = input.scope()
    if (event.dataTransfer && addFilePaths(transferredFilePaths(event.dataTransfer), scope)) return

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    await addDroppedFiles(Array.from(dropped), scope)
  }

  const handleNativeTransfer = async (transfer: { dropzone?: string; paths: string[]; images: string[] }) => {
    if (input.isDialogActive()) return
    const root = input.root()
    if (!root || (transfer.dropzone && root.dataset.sessionDropzone !== transfer.dropzone)) return
    const scope = input.scope()
    input.setDraggingType(null)
    const added = addFilePaths(transfer.paths.map((path) => path.replaceAll("\\", "/")), scope)
    const addedImages = await addDroppedImages(transfer.images.map((path) => path.replaceAll("\\", "/")), scope)
    if (!added && !addedImages && (transfer.paths.length > 0 || transfer.images.length > 0)) warn()
  }

  onMount(() => {
    makeEventListener(document, "dragover", handleGlobalDragOver)
    makeEventListener(document, "dragleave", handleGlobalDragLeave)
    makeEventListener(document, "drop", handleGlobalDrop)
    const unsubscribe = input.onNativeFileTransfer?.((transfer) => void handleNativeTransfer(transfer))
    if (unsubscribe) onCleanup(unsubscribe)
  })

  return {
    addAttachment,
    addAttachments,
    removeAttachment,
    handlePaste,
  }
}
