type OpenExternalDeps = {
  openExternal: (url: string) => Promise<void>
  logError: (message: string, data: { url: string; error: unknown }) => void
}

export function createOpenExternal(deps: OpenExternalDeps) {
  return async (url: string) => {
    try {
      await deps.openExternal(url)
    } catch (error) {
      deps.logError("failed to open external link", { url, error })
    }
  }
}
