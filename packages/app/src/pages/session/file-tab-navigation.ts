import {
  normalizeCodeEditorNavigationPath,
  queueCodeEditorNavigation,
  type CodeEditorNavigationSelection,
} from "@/components/code-editor/core/navigation"

export function createLfcodeEditorPath(input: {
  normalizePath: (path: string) => string | undefined
  loadFile: (path: string) => Promise<void> | void
  tabForPath: (path: string) => string
  openTab: (tab: string) => Promise<void> | void
  setActiveTab: (tab: string) => void
}) {
  return async (request: {
    path: string
    selection?: CodeEditorNavigationSelection
  }) => {
    const nextPath = input.normalizePath(request.path)
    if (!nextPath) return
    const normalizedPath = normalizeCodeEditorNavigationPath(nextPath)

    queueCodeEditorNavigation({
      path: normalizedPath,
      selection: request.selection,
    })

    await input.loadFile(normalizedPath)
    const nextTab = input.tabForPath(normalizedPath)
    await input.openTab(nextTab)
    input.setActiveTab(nextTab)
  }
}
