import path from "path"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { Global } from "../global"
import type { MessageV2 } from "./message-v2"

const FILE_PART_BLOB_MAX_INLINE_BYTES = 256 * 1024
const FILE_PART_BLOB_DIR = path.join(Global.Path.data, "blobs", "attachments")
const DATA_URL_BASE64_MARKER = ";base64,"

type StoredFilePart = Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">
type StoredFileBlobRef = {
  mode: "blob"
  sha256: string
  bytes: number
  path: string
  mime: string
}
type StoredFilePartWithBlob = Omit<StoredFilePart, "url"> & {
  url: string
  blob?: StoredFileBlobRef
}

export function storePartData<T extends Omit<MessageV2.Part, "id" | "sessionID" | "messageID">>(part: T): T {
  if (part.type !== "file") return part
  const filePart = part as T & StoredFilePartWithBlob
  if (!filePart.url.startsWith("data:")) return part
  const bytes = estimateDataUrlBytes(filePart.url)
  if (bytes === undefined || bytes <= FILE_PART_BLOB_MAX_INLINE_BYTES) return part

  const sha256 = createHash("sha256").update(filePart.url).digest("hex")
  const target = path.join(FILE_PART_BLOB_DIR, sha256.slice(0, 2), `${sha256}.txt`)
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, filePart.url)
  }

  return {
    ...filePart,
    url: `lfcode-blob://${sha256}`,
    blob: {
      mode: "blob",
      sha256,
      bytes,
      path: path.relative(Global.Path.data, target),
      mime: filePart.mime,
    },
  }
}

export function hydrateStoredPart<T extends MessageV2.Part>(part: T): T {
  if (part.type !== "file") return part
  const blob = (part as T & { blob?: StoredFileBlobRef }).blob
  if (!blob || blob.mode !== "blob") return part
  const target = path.isAbsolute(blob.path) ? blob.path : path.join(Global.Path.data, blob.path)
  const url = readStoredBlobUrl(target) ?? part.url
  return {
    ...part,
    url,
  }
}

function readStoredBlobUrl(target: string) {
  if (!existsSync(target)) return
  try {
    return readFileSync(target, "utf8")
  } catch {
    return
  }
}

export function estimateDataUrlBytes(url: string) {
  const index = url.indexOf(DATA_URL_BASE64_MARKER)
  if (index === -1) return
  const body = url.slice(index + DATA_URL_BASE64_MARKER.length)
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding)
}

export function isStoredBlobPart(part: unknown): part is { blob: StoredFileBlobRef } {
  if (!part || typeof part !== "object") return false
  if (!("blob" in part)) return false
  const blob = (part as { blob?: StoredFileBlobRef }).blob
  return !!blob && blob.mode === "blob" && typeof blob.path === "string"
}

export function dropStoredPartBlob(part: unknown) {
  if (!isStoredBlobPart(part)) return
  const target = path.isAbsolute(part.blob.path) ? part.blob.path : path.join(Global.Path.data, part.blob.path)
  if (!existsSync(target)) return
  rmSync(target, { force: true })
}
