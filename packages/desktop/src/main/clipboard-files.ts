import { isAbsolute } from "node:path"

type ClipboardFileBuffers = {
  fileDrop?: Uint8Array
  fileNameWide?: Uint8Array
  fileName?: Uint8Array
}

function decodePaths(bytes: Uint8Array, encoding: "utf-16le" | "utf-8") {
  return new TextDecoder(encoding)
    .decode(bytes)
    .split("\0")
    .map((path) => path.trim())
    .filter((path) => isAbsolute(path))
}

function dropFiles(bytes: Uint8Array) {
  if (bytes.byteLength < 20) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(0, true)
  if (offset < 20 || offset >= bytes.byteLength) return []
  return decodePaths(bytes.subarray(offset), view.getUint32(16, true) === 0 ? "utf-8" : "utf-16le")
}

export function clipboardFilePaths(input: ClipboardFileBuffers) {
  return [...new Set([...dropFiles(input.fileDrop ?? new Uint8Array()), ...decodePaths(input.fileNameWide ?? new Uint8Array(), "utf-16le"), ...decodePaths(input.fileName ?? new Uint8Array(), "utf-8")])]
}
