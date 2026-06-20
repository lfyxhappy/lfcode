export function sessionDirectoryAliases(directory: string) {
  const values = new Set([directory])
  if (process.platform === "win32") {
    values.add(directory.replaceAll("\\", "/"))
    values.add(directory.replaceAll("/", "\\"))
  }
  return [...values]
}
