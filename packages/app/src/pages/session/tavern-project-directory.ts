export function isTavernManagedDirectory(directory: string) {
  const value = directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  return value.endsWith("/plugins/lfcode-tavern/data/projects/tavern")
}
