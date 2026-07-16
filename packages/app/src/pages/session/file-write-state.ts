export function isFileChecksumConflict(message?: string) {
  return typeof message === "string" && message.startsWith("Checksum mismatch for ")
}
