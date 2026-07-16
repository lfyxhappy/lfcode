import path from "path"

const ARCHIVE_EXTENSIONS = new Set(["zip", "tar", "gz", "tgz", "bz2", "7z", "rar"])
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp"])
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

export type ReadKind = "file" | "directory" | "image" | "pdf" | "binary" | "archive" | "document"

const docxTextEntry = /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/u
const xlsxTextEntry = /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/u
const pptxTextEntry = /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/u

export function inferReadKind(filepath: string, mime: string): ReadKind {
  const ext = path.extname(filepath).toLowerCase().slice(1)
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive"
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document"
  return "file"
}

export function isBinaryFile(filepath: string, bytes: Uint8Array) {
  const ext = path.extname(filepath).toLowerCase()
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
  }

  if (bytes.length === 0) return false

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) nonPrintableCount++
  }

  return nonPrintableCount / bytes.length > 0.3
}

function decodeXmlEntities(input: string) {
  return input
    .replace(/&#x([0-9a-f]+);/giu, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/gu, (_, value: string) => String.fromCodePoint(parseInt(value, 10)))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
}

function extractOfficeXmlText(input: string) {
  return decodeXmlEntities(
    input
      .replace(/<w:tab[^>]*\/>/gu, "\t")
      .replace(/<w:br[^>]*\/>/gu, "\n")
      .replace(/<w:cr[^>]*\/>/gu, "\n")
      .replace(/<\/w:p>/gu, "\n")
      .replace(/<\/w:tr>/gu, "\n")
      .replace(/<\/w:tc>/gu, "\t")
      .replace(/<\/si>/gu, "\n")
      .replace(/<\/row>/gu, "\n")
      .replace(/<\/c>/gu, "\t")
      .replace(/<\/a:p>/gu, "\n")
      .replace(/<a:br[^>]*\/>/gu, "\n")
      .replace(/<[^>]+>/gu, ""),
  )
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export async function inspectArchiveFile(filepath: string, bytes: Uint8Array) {
  const zip = await import("@zip.js/zip.js")
  const ext = path.extname(filepath).toLowerCase().slice(1)
  const mime = ext === "docx" ? DOCX_MIME : "application/zip"
  const buffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : Uint8Array.from(bytes).buffer
  const reader = new zip.ZipReader(new zip.BlobReader(new Blob([buffer], { type: mime })))

  try {
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory)
    const names = entries.map((entry) => entry.filename).sort((a, b) => a.localeCompare(b))
    const pattern = ext === "docx" ? docxTextEntry : ext === "xlsx" ? xlsxTextEntry : ext === "pptx" ? pptxTextEntry : undefined
    if (!pattern) {
      return {
        kind: inferReadKind(filepath, mime),
        entries: names,
      }
    }

    const chunks: string[] = []
    for (const entry of entries) {
      if (!pattern.test(entry.filename) || !entry.getData) continue
      const xml = await entry.getData(new zip.TextWriter())
      const text = extractOfficeXmlText(xml)
      if (text) chunks.push(text)
    }

    return {
      kind: "document" as const,
      entries: names,
      text: chunks.join("\n\n").trim(),
    }
  } finally {
    await reader.close().catch(() => undefined)
  }
}
