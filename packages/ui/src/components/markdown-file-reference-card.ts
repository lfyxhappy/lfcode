import { isAbsoluteFileReferencePath, type FileReferenceKind } from "./file-reference-path"

export type FileReferenceValidation = {
  exists: boolean
  kind: FileReferenceKind
}

export function isCardableFileReference(path: string, result: FileReferenceValidation) {
  return isAbsoluteFileReferencePath(path) && result.exists && (result.kind === "file" || result.kind === "directory")
}

export function getFileReferenceCategory(path: string, kind: "file" | "directory") {
  if (kind === "directory") return "directory"
  const extension = path.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1)?.split(".").at(-1)?.toLowerCase() ?? ""
  if (["zip", "7z", "rar", "tar", "gz", "bz2", "xz"].includes(extension)) return "archive"
  if (["doc", "docx", "pdf", "md", "txt", "rtf", "odt", "xls", "xlsx", "ppt", "pptx"].includes(extension)) return "document"
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"].includes(extension)) return "image"
  if (["mp3", "wav", "ogg", "flac", "mp4", "mkv", "mov", "webm", "avi"].includes(extension)) return "media"
  if (["ts", "tsx", "js", "jsx", "json", "css", "html", "htm", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs", "sh", "ps1", "yaml", "yml", "toml", "xml"].includes(extension)) return "code"
  if (["csv", "sql", "db", "sqlite", "parquet", "jsonl"].includes(extension)) return "data"
  return "other"
}
