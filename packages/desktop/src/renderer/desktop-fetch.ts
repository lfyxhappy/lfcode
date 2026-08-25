type DesktopFetchDiagnostic = {
  at: number
  method: string
  path: string
  directory?: string
  hasAuthorization: boolean
  status?: number
  error?: string
}

const diagnostics: DesktopFetchDiagnostic[] = []
const directoryLabels = new Map<string, string>()
let nextDirectoryLabel = 1

function labelDirectory(directory: string | null) {
  if (!directory) return undefined
  const existing = directoryLabels.get(directory)
  if (existing) return existing
  const label = `directory-${nextDirectoryLabel++}`
  directoryLabels.set(directory, label)
  return label
}

export function snapshotDesktopFetchDiagnostics() {
  return diagnostics.slice()
}

export function resetDesktopFetchDiagnostics() {
  diagnostics.length = 0
  directoryLabels.clear()
  nextDirectoryLabel = 1
}

export function createDesktopFetch(fetcher: typeof globalThis.fetch = globalThis.fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const diagnostic: DesktopFetchDiagnostic = {
      at: Date.now(),
      method: request.method,
      path: url.pathname,
      directory: labelDirectory(url.searchParams.get("directory")),
      hasAuthorization: request.headers.has("authorization"),
    }
    diagnostics.push(diagnostic)
    if (diagnostics.length > 100) diagnostics.shift()
    try {
      const response = await fetcher(request)
      diagnostic.status = response.status
      return response
    } catch (error) {
      diagnostic.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }
}
