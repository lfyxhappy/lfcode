export type CodeEditorDiagnosticItem = {
  message: string
  severity: "error" | "warning"
  line: number
  column: number
  endLine: number
  endColumn: number
  source?: string
  code?: string
}

export function collectCodeEditorDiagnostics(input: {
  monaco: typeof import("monaco-editor")
  model: import("monaco-editor").editor.ITextModel
}) {
  const markers = input.monaco.editor
    .getModelMarkers({ resource: input.model.uri })
    .flatMap((marker) => {
      const severity = normalizeSeverity(input.monaco, marker.severity)
      if (!severity) return []
      return [
        {
          message: marker.message,
          severity,
          line: marker.startLineNumber,
          column: marker.startColumn,
          endLine: marker.endLineNumber,
          endColumn: marker.endColumn,
          source: marker.source,
          code: typeof marker.code === "string" ? marker.code : typeof marker.code?.value === "string" ? marker.code.value : undefined,
        } satisfies CodeEditorDiagnosticItem,
      ]
    })
    .sort((a, b) => {
      const severityDelta = severityOrder(a.severity) - severityOrder(b.severity)
      if (severityDelta !== 0) return severityDelta
      if (a.line !== b.line) return a.line - b.line
      if (a.column !== b.column) return a.column - b.column
      return a.message.localeCompare(b.message)
    })

  return {
    errors: markers.filter((marker) => marker.severity === "error").length,
    warnings: markers.filter((marker) => marker.severity === "warning").length,
    items: markers,
  }
}

export function suppressBrowserOnlyModuleResolutionDiagnostics(input: {
  monaco: typeof import("monaco-editor")
  model: import("monaco-editor").editor.ITextModel
}) {
  if (input.model.uri.scheme !== "lfcode-editor") return false
  const markers = input.monaco.editor.getModelMarkers({ resource: input.model.uri })
  const affectedOwners = new Set(
    markers
      .filter((marker) => isBrowserOnlyModuleResolutionDiagnostic(marker))
      .map((marker) => marker.owner),
  )
  if (affectedOwners.size === 0) return false

  for (const owner of affectedOwners) {
    input.monaco.editor.setModelMarkers(
      input.model,
      owner,
      markers
        .filter((marker) => marker.owner === owner && !isBrowserOnlyModuleResolutionDiagnostic(marker))
        .map((marker) => ({
          code: marker.code,
          severity: marker.severity,
          message: marker.message,
          source: marker.source,
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn,
          modelVersionId: marker.modelVersionId,
          relatedInformation: marker.relatedInformation,
          tags: marker.tags,
        })),
    )
  }
  return true
}

function isBrowserOnlyModuleResolutionDiagnostic(marker: import("monaco-editor").editor.IMarker) {
  if (marker.owner !== "typescript" && marker.owner !== "javascript") return false
  const code = typeof marker.code === "string" ? marker.code : marker.code?.value
  return code === "2307" || code === "2792"
}

function normalizeSeverity(monaco: typeof import("monaco-editor"), severity: import("monaco-editor").MarkerSeverity) {
  if (severity === monaco.MarkerSeverity.Error) return "error"
  if (severity === monaco.MarkerSeverity.Warning) return "warning"
}

function severityOrder(severity: CodeEditorDiagnosticItem["severity"]) {
  if (severity === "error") return 0
  return 1
}
