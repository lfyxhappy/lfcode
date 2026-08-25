const MEBIBYTE = 1024 * 1024

export const LAN_INLINE_IMAGE_MAX_BYTES = 2 * MEBIBYTE

const mimePattern = /^data:(image\/(?:gif|jpeg|png|webp));base64$/i

export function readLanInlineImage(value: unknown) {
  if (typeof value !== "string") return
  const separator = value.indexOf(",")
  if (separator <= 0) return
  const mime = mimePattern.exec(value.slice(0, separator))?.[1]?.toLowerCase()
  if (!mime) return
  const encoded = value.slice(separator + 1)
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded)) return
  if (encoded.length > Math.ceil(LAN_INLINE_IMAGE_MAX_BYTES / 3) * 4) return
  const bytes = Buffer.from(encoded, "base64")
  if (!bytes.byteLength || bytes.byteLength > LAN_INLINE_IMAGE_MAX_BYTES || !matchesImageSignature(bytes, mime)) return
  return { mime, bytes }
}

function matchesImageSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mime === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff])
  if (mime === "image/gif") return startsWith(bytes, [0x47, 0x49, 0x46, 0x38])
  if (mime === "image/webp") return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  return false
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value)
}
