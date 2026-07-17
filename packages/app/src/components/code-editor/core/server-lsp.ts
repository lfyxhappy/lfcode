import type { editor } from "monaco-editor"
import type { ServerConnection } from "@/context/server"
import type { CodeEditorDocumentSymbolItem, CodeEditorHoverItem } from "@/components/code-editor/core/command-handle"
import type { CodeEditorNavigationSelection } from "@/components/code-editor/core/navigation"
import type { CodeEditorNavigationTargetItem } from "@/components/code-editor/core/navigation-targets"
import { getEditorDocumentStamp } from "@/components/code-editor/core/document-registry"
import { normalizeCodeEditorNavigationPath } from "@/components/code-editor/core/navigation"

type ServerLspPosition = {
  line: number
  character: number
}

type ServerLspRange = {
  start: ServerLspPosition
  end: ServerLspPosition
}

type ServerLspLocation = {
  uri?: string
  range?: ServerLspRange
  targetUri?: string
  targetRange?: ServerLspRange
  targetSelectionRange?: ServerLspRange
}

type ServerLspDiagnostic = {
  severity?: number
  message: string
  source?: string
  code?: string | number
  range: ServerLspRange
}

type ServerLspTextEdit = {
  range: ServerLspRange
  newText: string
}

type ServerLspInsertReplaceEdit = {
  insert: ServerLspRange
  replace: ServerLspRange
  newText: string
}

type ServerLspCompletionItem = {
  label:
    | string
    | {
        label: string
        detail?: string
        description?: string
      }
  kind?: number
  detail?: string
  documentation?: HoverContent
  insertText?: string
  insertTextFormat?: number
  filterText?: string
  sortText?: string
  preselect?: boolean
  commitCharacters?: string[]
  textEdit?: ServerLspTextEdit | ServerLspInsertReplaceEdit
  additionalTextEdits?: ServerLspTextEdit[]
}

type ServerLspCompletionList = {
  items: ServerLspCompletionItem[]
  isIncomplete?: boolean
}

type ServerLspParameterInformation = {
  label: string | [number, number]
  documentation?: HoverContent
}

type ServerLspSignatureInformation = {
  label: string
  documentation?: HoverContent
  parameters?: ServerLspParameterInformation[]
  activeParameter?: number
}

type ServerLspSignatureHelp = {
  signatures: ServerLspSignatureInformation[]
  activeSignature?: number
  activeParameter?: number
}

type ServerLspRenameLocation = {
  range: ServerLspRange
  placeholder?: string
  defaultBehavior?: boolean
}

type ServerLspDocumentHighlight = {
  range: ServerLspRange
  kind?: number
}

type ServerLspDocumentSymbol = {
  name: string
  detail?: string
  kind?: number
  range: ServerLspRange
  selectionRange: ServerLspRange
  children?: ServerLspDocumentSymbol[]
}

type ServerLspSymbolInformation = {
  name: string
  containerName?: string
  kind?: number
  location: {
    uri: string
    range: ServerLspRange
  }
}

type ServerLspCommand = {
  title: string
  command: string
  arguments?: unknown[]
}

const DEFAULT_COMPLETION_TRIGGER_CHARACTERS = [".", ":", ">", "/", "\\", "'", "\"", "@", "("]

type ServerLspCodeActionDisabled = {
  reason: string
}

type ServerLspAnnotatedTextEdit = ServerLspTextEdit & {
  annotationId?: string
}

type ServerLspTextDocumentEdit = {
  textDocument?: {
    uri?: string
    version?: number | null
  }
  edits?: ServerLspAnnotatedTextEdit[]
}

type ServerLspCreateFile = {
  kind: "create"
  uri: string
  options?: {
    overwrite?: boolean
    ignoreIfExists?: boolean
  }
}

type ServerLspRenameFile = {
  kind: "rename"
  oldUri: string
  newUri: string
  options?: {
    overwrite?: boolean
    ignoreIfExists?: boolean
  }
}

type ServerLspDeleteFile = {
  kind: "delete"
  uri: string
  options?: {
    recursive?: boolean
    ignoreIfNotExists?: boolean
  }
}

type ServerLspWorkspaceEdit = {
  changes?: Record<string, ServerLspTextEdit[]>
  documentChanges?: Array<ServerLspTextDocumentEdit | ServerLspCreateFile | ServerLspRenameFile | ServerLspDeleteFile>
}

type ServerLspCodeAction = {
  title: string
  kind?: string
  diagnostics?: ServerLspDiagnostic[]
  edit?: ServerLspWorkspaceEdit
  command?: ServerLspCommand
  isPreferred?: boolean
  disabled?: ServerLspCodeActionDisabled
}

type ServerLspQueryResult = {
  supported: boolean
  result?: unknown
}

type ServerLspPositionQuery = {
  kind:
    | "hover"
    | "signatureHelp"
    | "prepareRename"
    | "rename"
    | "declaration"
    | "definition"
    | "typeDefinition"
    | "references"
    | "implementation"
    | "documentHighlights"
    | "incomingCalls"
    | "outgoingCalls"
  position: { lineNumber: number; column: number }
  newName?: string
  triggerCharacter?: string
  maxItems?: number
}

type ServerLspCompletionQuery = {
  kind: "completion"
  position: { lineNumber: number; column: number }
  triggerCharacter?: string
  maxItems?: number
}

type ServerLspCompletionResolveQuery = {
  kind: "completionResolve"
  item: unknown
}

type ServerLspCodeActionQuery = {
  kind: "codeAction"
  position: { lineNumber: number; column: number }
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  diagnostics?: unknown[]
  only?: string
}

type ServerLspExecuteCommandQuery = {
  kind: "executeCommand"
  command: string
  arguments?: unknown[]
}

type ServerLspFormattingOptions = {
  tabSize: number
  insertSpaces: boolean
  trimTrailingWhitespace?: boolean
  insertFinalNewline?: boolean
  trimFinalNewlines?: boolean
}

type ServerLspFormattingQuery = {
  kind: "formatting"
  options: ServerLspFormattingOptions
}

type ServerLspRangeFormattingQuery = {
  kind: "rangeFormatting"
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  options: ServerLspFormattingOptions
}

type ServerLspQuery =
  | { kind: "diagnostics" | "documentSymbol" }
  | ServerLspPositionQuery
  | ServerLspCompletionQuery
  | ServerLspCompletionResolveQuery
  | ServerLspFormattingQuery
  | ServerLspRangeFormattingQuery
  | ServerLspCodeActionQuery
  | ServerLspExecuteCommandQuery

type ServerLspExecuteCommandPayload = {
  registryKey: string
  model: editor.ITextModel
  binding: ServerLspModelBinding
  command: string
  arguments?: unknown[]
}

type ServerLspModelStamp = NonNullable<ReturnType<typeof getEditorDocumentStamp>>

type ServerLspModelBinding = {
  path: string
  normalizedPath: string
  stamp: ServerLspModelStamp
  modelVersion: number
}

type ServerLspProviderRegistryEntry = {
  key: string
  count: number
  server: ServerConnection.HttpBase
  directory: string
  language: string
  paths: Map<string, number>
  requests: Map<string, Set<AbortController>>
  completionRequests: Map<string, AbortController>
  completionCache: Map<string, { expiresAt: number; promise: Promise<ServerLspModelQueryResult> }>
  disposables: import("monaco-editor").IDisposable[]
  disposeGeneration: number
}

type HoverContent =
  | string
  | {
      language?: string
      kind?: string
      value?: string
    }

const SERVER_LSP_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "python",
  "c",
  "cpp",
  "go",
  "rust",
  "java",
  "kotlin",
  "csharp",
  "ruby",
  "php",
  "lua",
  "yaml",
  "shell",
  "dockerfile",
  "swift",
])
const SERVER_LSP_EXECUTE_COMMAND_ID = "lfcode.serverLsp.executeCommand"
const SERVER_LSP_COMPLETION_CACHE_MS = 180
let serverLspExecuteCommandRegistration: import("monaco-editor").IDisposable | undefined

export function shouldUseCodeEditorServerLsp(language?: string) {
  return Boolean(language && SERVER_LSP_LANGUAGES.has(language))
}

export async function requestCodeEditorServerLsp(input: {
  server?: ServerConnection.HttpBase
  directory: string
  path: string
  text: string
  signal?: AbortSignal
  query: ServerLspQuery
}) {
  if (!input.server) return { supported: false } satisfies ServerLspQueryResult
  const url = apiUrl(input.server.url, input.directory, "/lsp/query")
  const headers = {
    "content-type": "application/json",
    ...createBasicAuthHeader(input.server),
  }
  const body =
    input.query.kind === "completionResolve"
      ? {
          kind: input.query.kind,
          path: input.path,
          text: input.text,
          item: input.query.item,
        }
      : input.query.kind === "codeAction"
      ? {
          kind: input.query.kind,
          path: input.path,
          text: input.text,
          position: {
            line: Math.max(0, input.query.position.lineNumber - 1),
            character: Math.max(0, input.query.position.column - 1),
          },
          range: {
            start: {
              line: Math.max(0, input.query.range.startLineNumber - 1),
              character: Math.max(0, input.query.range.startColumn - 1),
            },
            end: {
              line: Math.max(0, input.query.range.endLineNumber - 1),
              character: Math.max(0, input.query.range.endColumn - 1),
            },
          },
          diagnostics: input.query.diagnostics,
          only: input.query.only,
        }
      : input.query.kind === "rangeFormatting"
        ? {
            kind: input.query.kind,
            path: input.path,
            text: input.text,
            range: {
              start: {
                line: Math.max(0, input.query.range.startLineNumber - 1),
                character: Math.max(0, input.query.range.startColumn - 1),
              },
              end: {
                line: Math.max(0, input.query.range.endLineNumber - 1),
                character: Math.max(0, input.query.range.endColumn - 1),
              },
            },
            options: input.query.options,
          }
        : input.query.kind === "formatting"
          ? {
              kind: input.query.kind,
              path: input.path,
              text: input.text,
              options: input.query.options,
            }
      : input.query.kind === "executeCommand"
        ? {
            kind: input.query.kind,
            path: input.path,
            text: input.text,
            command: input.query.command,
            arguments: input.query.arguments,
          }
        : "position" in input.query
          ? {
              kind: input.query.kind,
              path: input.path,
              text: input.text,
              position: {
                line: Math.max(0, input.query.position.lineNumber - 1),
                character: Math.max(0, input.query.position.column - 1),
              },
              newName: input.query.kind === "completion" ? undefined : input.query.newName,
              triggerCharacter: input.query.triggerCharacter,
              maxItems: input.query.maxItems,
            }
          : {
              kind: input.query.kind,
              path: input.path,
              text: input.text,
            }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: input.signal,
  })
  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : response.statusText || "LSP query failed"
    throw new Error(message)
  }
  return (payload ?? { supported: false }) as ServerLspQueryResult
}

export function getCodeEditorServerLspRegistryKey(input: {
  serverURL: string
  directory: string
  language: string
}) {
  return [input.serverURL, input.directory, input.language].join("\n")
}

export function getCodeEditorServerLspCompletionTriggerCharacters(value?: string[]) {
  const source = value?.length ? value : DEFAULT_COMPLETION_TRIGGER_CHARACTERS
  return Array.from(new Set(source.filter((item) => item.length === 1)))
}

export function registerCodeEditorServerLspProviders(input: {
  monaco: typeof import("monaco-editor")
  server?: ServerConnection.HttpBase
  directory: string
  path: string
  language: string
  getText?: () => string
  enabled?: () => boolean
  completionTriggerCharacters?: string[]
}) {
  const server = input.server
  if (!server || !shouldUseCodeEditorServerLsp(input.language)) return () => {}
  ensureServerLspExecuteCommandRegistration(input.monaco)

  const key = getCodeEditorServerLspRegistryKey({
    serverURL: server.url,
    directory: input.directory,
    language: input.language,
  })
  const path = normalizeCodeEditorNavigationPath(input.path)
  const existing = serverLspProviderRegistry.get(key)
  if (existing) {
    existing.count += 1
    existing.server = server
    retainCodeEditorServerLspPath(existing, path)
    existing.disposeGeneration += 1
    return createCodeEditorServerLspProviderRelease(key, path)
  }

  const registry: ServerLspProviderRegistryEntry = {
    key,
    count: 1,
    server,
    directory: input.directory,
    language: input.language,
    paths: new Map([[path, 1]]),
    requests: new Map(),
    completionRequests: new Map(),
    completionCache: new Map(),
    disposables: [],
    disposeGeneration: 1,
  }
  serverLspProviderRegistry.set(key, registry)
  const request = (
    model: editor.ITextModel,
    query: ServerLspQuery,
    token?: import("monaco-editor").CancellationToken,
  ) => {
    if (input.enabled && !input.enabled()) return Promise.resolve({ supported: false } satisfies ServerLspQueryResult)
    return requestCodeEditorServerLspForModel({
      registry,
      model,
      query,
      token,
    })
  }
  const completionResolveItems = new WeakMap<
    import("monaco-editor").languages.CompletionItem,
    { model: editor.ITextModel; item: unknown; position: import("monaco-editor").Position }
  >()

  const completion = input.monaco.languages.registerCompletionItemProvider(input.language, {
    triggerCharacters: getCodeEditorServerLspCompletionTriggerCharacters(input.completionTriggerCharacters),
    provideCompletionItems: async (model, position, context, token) => {
      const response = await request(
        model,
        {
          kind: "completion",
          position,
          triggerCharacter: context.triggerCharacter,
          maxItems: 200,
        },
        token,
      )
      if (!response.supported) return { suggestions: [] }
      const list = normalizeServerLspCompletionList({
        result: response.result,
        monaco: input.monaco,
        model,
        position,
      })
      const items = getServerLspCompletionItems(response.result)
      list.suggestions.forEach((item, index) => {
        const source = items[index]
        if (!source) return
        completionResolveItems.set(item, { model, item: source, position })
      })
      return list
    },
    resolveCompletionItem: async (item, token) => {
      const context = completionResolveItems.get(item)
      if (!context) return item
      const response = await request(context.model, { kind: "completionResolve", item: context.item }, token)
      if (!response.supported) return item
      const resolved = normalizeServerLspCompletionList({
        result: [response.result],
        monaco: input.monaco,
        model: context.model,
        position: context.position,
      }).suggestions[0]
      if (!resolved) return item
      completionResolveItems.set(resolved, { ...context, item: response.result })
      return { ...item, ...resolved }
    },
  })

  const signatureHelp = input.monaco.languages.registerSignatureHelpProvider(input.language, {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [",", ")"],
    provideSignatureHelp: async (model, position, token, context) => {
      const response = await request(
        model,
        {
          kind: "signatureHelp",
          position,
          triggerCharacter: context.triggerCharacter,
        },
        token,
      )
      if (!response.supported) return null
      return normalizeServerLspSignatureHelp({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const hover = input.monaco.languages.registerHoverProvider(input.language, {
    provideHover: async (model, position, token) => {
      const response = await request(model, { kind: "hover", position }, token)
      if (!response.supported) return null
      return normalizeServerLspHover({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const documentSymbol = input.monaco.languages.registerDocumentSymbolProvider(input.language, {
    provideDocumentSymbols: async (model, token) => {
      const response = await request(model, { kind: "documentSymbol" }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoDocumentSymbols({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const declaration = input.monaco.languages.registerDeclarationProvider(input.language, {
    provideDeclaration: async (model, position, token) => {
      const response = await request(model, { kind: "declaration", position }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoLocations({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const definition = input.monaco.languages.registerDefinitionProvider(input.language, {
    provideDefinition: async (model, position, token) => {
      const response = await request(model, { kind: "definition", position }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoLocations({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const typeDefinition = input.monaco.languages.registerTypeDefinitionProvider(input.language, {
    provideTypeDefinition: async (model, position, token) => {
      const response = await request(model, { kind: "typeDefinition", position }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoLocations({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const implementation = input.monaco.languages.registerImplementationProvider(input.language, {
    provideImplementation: async (model, position, token) => {
      const response = await request(model, { kind: "implementation", position }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoLocations({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const references = input.monaco.languages.registerReferenceProvider(input.language, {
    provideReferences: async (model, position, _context, token) => {
      const response = await request(model, { kind: "references", position }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoLocations({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const documentHighlights = input.monaco.languages.registerDocumentHighlightProvider(input.language, {
    provideDocumentHighlights: async (model, position, token) => {
      const response = await request(model, { kind: "documentHighlights", position }, token)
      if (!response.supported) return []
      return normalizeServerLspMonacoDocumentHighlights({
        result: response.result,
        monaco: input.monaco,
      })
    },
  })

  const rename = input.monaco.languages.registerRenameProvider(input.language, {
    provideRenameEdits: async (model, position, newName, token) => {
      const response = await request(model, { kind: "rename", position, newName }, token)
      if (!response.supported) return { edits: [], rejectReason: "Rename is not supported" }
      return normalizeServerLspRenameEdit({
        result: response.result,
        monaco: input.monaco,
      })
    },
    resolveRenameLocation: async (model, position, token) => {
      const response = await request(model, { kind: "prepareRename", position }, token)
      if (!response.supported) return null
      return normalizeServerLspRenameLocation({
        result: response.result,
        model,
        monaco: input.monaco,
      })
    },
  })

  const documentFormatting = input.monaco.languages.registerDocumentFormattingEditProvider(input.language, {
    provideDocumentFormattingEdits: async (model, options, token) => {
      const response = await request(
        model,
        {
          kind: "formatting",
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        },
        token,
      )
      if (!response.supported) return []
      return normalizeServerLspMonacoTextEdits(response.result)
    },
  })

  const documentRangeFormatting = input.monaco.languages.registerDocumentRangeFormattingEditProvider(input.language, {
    provideDocumentRangeFormattingEdits: async (model, range, options, token) => {
      const response = await request(
        model,
        {
          kind: "rangeFormatting",
          range: {
            startLineNumber: range.startLineNumber,
            startColumn: range.startColumn,
            endLineNumber: range.endLineNumber,
            endColumn: range.endColumn,
          },
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        },
        token,
      )
      if (!response.supported) return []
      return normalizeServerLspMonacoTextEdits(response.result)
    },
  })

  const codeAction = input.monaco.languages.registerCodeActionProvider(input.language, {
    provideCodeActions: async (model, range, context, token) => {
      const response = await request(
        model,
        {
          kind: "codeAction",
          position: {
            lineNumber: range.startLineNumber,
            column: range.startColumn,
          },
          range: {
            startLineNumber: range.startLineNumber,
            startColumn: range.startColumn,
            endLineNumber: range.endLineNumber,
            endColumn: range.endColumn,
          },
          diagnostics: context.markers,
          only: context.only,
        },
        token,
      )
      if (!response.supported || !response.binding) return { actions: [], dispose: () => {} }
      return {
        actions: normalizeServerLspCodeActions({
          result: response.result,
          monaco: input.monaco,
          registryKey: key,
          model,
          binding: response.binding,
        }),
        dispose: () => {},
      }
    },
  })

  registry.disposables = [
    completion,
    signatureHelp,
    hover,
    documentSymbol,
    declaration,
    definition,
    typeDefinition,
    implementation,
    references,
    documentHighlights,
    rename,
    documentFormatting,
    documentRangeFormatting,
    codeAction,
  ]
  return createCodeEditorServerLspProviderRelease(key, path)
}

export function normalizeServerLspNavigationTargets(input: { currentPath: string; result: unknown }) {
  if (!Array.isArray(input.result)) return [] as CodeEditorNavigationTargetItem[]
  const currentPath = normalizeCodeEditorNavigationPath(input.currentPath)
  const deduped = new Map<string, CodeEditorNavigationTargetItem>()

  for (const item of input.result.filter(isServerLspLocation)) {
    const uri = item.targetUri ?? item.uri
    const range = item.targetSelectionRange ?? item.targetRange ?? item.range
    const path = getCodeEditorFilePathFromUri(uri) ?? input.currentPath
    if (!range) continue

    const normalizedPath = normalizeCodeEditorNavigationPath(path)
    const selection = toEditorSelection(range)
    const key = `${normalizedPath}:${selection.startLineNumber}:${selection.startColumn}:${selection.endLineNumber}:${selection.endColumn}`
    if (deduped.has(key)) continue

    deduped.set(key, {
      id: key,
      path,
      label: `${getPathBaseName(path)}:${selection.startLineNumber}`,
      detail: `${normalizedPath === currentPath ? getPathBaseName(path) : normalizedPath}:${selection.startLineNumber}:${selection.startColumn}`,
      selection,
    })
  }

  return Array.from(deduped.values())
}

export function flattenServerLspDocumentSymbols(input: unknown) {
  if (!Array.isArray(input)) return [] as CodeEditorDocumentSymbolItem[]
  if (input.every(isServerLspDocumentSymbol)) {
    let index = 0
    return input.flatMap((symbol) => flattenServerDocumentSymbol(symbol, 0, () => String(index++)))
  }
  if (input.every(isServerLspSymbolInformation)) {
    return input.map((symbol, index) => ({
      id: String(index),
      label: symbol.name,
      detail: symbol.containerName,
      depth: 0,
      selection: toEditorSelection(symbol.location.range),
      range: toEditorSelection(symbol.location.range),
    })) satisfies CodeEditorDocumentSymbolItem[]
  }
  return [] as CodeEditorDocumentSymbolItem[]
}

export function normalizeServerLspDiagnostics(
  input: unknown,
  monaco: typeof import("monaco-editor"),
): editor.IMarkerData[] {
  if (!Array.isArray(input)) return []
  return input.filter(isServerLspDiagnostic).map((item) => ({
    message: item.message,
    severity: toMonacoSeverity(item.severity, monaco),
    source: item.source,
    code: item.code === undefined ? undefined : String(item.code),
    startLineNumber: item.range.start.line + 1,
    startColumn: item.range.start.character + 1,
    endLineNumber: item.range.end.line + 1,
    endColumn: item.range.end.character + 1,
  }))
}

export function normalizeCodeEditorHoverItems(input: unknown) {
  const blocks: CodeEditorHoverItem[] = []

  const push = (value: { kind: "text" | "markdown" | "code"; text?: string; language?: string }) => {
    const text = value.text?.trim()
    if (!text) return
    blocks.push({
      id: String(blocks.length),
      kind: value.kind,
      text,
      language: value.language,
    })
  }

  const visitHoverContent = (content: HoverContent) => {
    if (typeof content === "string") {
      push({ kind: "text", text: content })
      return
    }
    if (content.language && typeof content.value === "string") {
      push({ kind: "code", text: content.value, language: content.language })
      return
    }
    if (content.kind === "markdown" && typeof content.value === "string") {
      push({ kind: "markdown", text: content.value })
      return
    }
    if (content.kind === "plaintext" && typeof content.value === "string") {
      push({ kind: "text", text: content.value })
      return
    }
    if (typeof content.value === "string") {
      push({ kind: "text", text: content.value })
    }
  }

  const visit = (value: unknown) => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value === "string") {
      push({ kind: "text", text: value })
      return
    }
    if (typeof value !== "object") return
    if ("contents" in value) {
      visit((value as { contents?: unknown }).contents)
      return
    }
    if ("language" in value || "kind" in value || "value" in value) {
      visitHoverContent(value as HoverContent)
    }
  }

  visit(input)
  return blocks
}

export function normalizeServerLspHover(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}): import("monaco-editor").languages.Hover | null {
  if (!input.result || typeof input.result !== "object") return null
  const hover = input.result as {
    contents?: unknown
    range?: ServerLspRange
  }
  const items = normalizeCodeEditorHoverItems(hover.contents ?? input.result)
  if (items.length === 0) return null
  return {
    contents: items.map((item) => {
      if (item.kind === "code") {
        return {
          value: ["```" + (item.language ?? ""), item.text, "```"].join("\n"),
        }
      }
      return {
        value: item.text,
      }
    }),
    range: hover.range ? new input.monaco.Range(
      hover.range.start.line + 1,
      hover.range.start.character + 1,
      hover.range.end.line + 1,
      hover.range.end.character + 1,
    ) : undefined,
  }
}

export function normalizeServerLspCompletionList(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
  model: editor.ITextModel
  position: { lineNumber: number; column: number }
}): import("monaco-editor").languages.CompletionList {
  const items = getServerLspCompletionItems(input.result)
  const word = input.model.getWordUntilPosition(input.position)
  const defaultRange = new input.monaco.Range(
    input.position.lineNumber,
    word.startColumn,
    input.position.lineNumber,
    word.endColumn,
  )
  return {
    suggestions: items.flatMap((item) => {
      const label = normalizeServerLspCompletionLabel(item.label)
      if (!label) return []
      return [
        {
          label,
          kind: toMonacoCompletionItemKind(item.kind, input.monaco),
          detail: item.detail,
          documentation: toMonacoHoverValue(item.documentation),
          insertText: getServerLspCompletionInsertText(item),
          insertTextRules:
            item.insertTextFormat === 2
              ? input.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          filterText: item.filterText,
          sortText: item.sortText,
          preselect: item.preselect,
          commitCharacters: item.commitCharacters,
          additionalTextEdits: item.additionalTextEdits?.filter(isServerLspTextEdit).map((edit) => ({
            range: toMonacoRange(edit.range),
            text: edit.newText,
          })),
          range: toMonacoCompletionRange(item.textEdit, defaultRange),
        } satisfies import("monaco-editor").languages.CompletionItem,
      ]
    }),
    incomplete: isServerLspCompletionList(input.result) ? Boolean(input.result.isIncomplete) : false,
  }
}

export function normalizeServerLspSignatureHelp(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}): import("monaco-editor").languages.SignatureHelpResult | null {
  if (!isServerLspSignatureHelp(input.result)) return null
  if (input.result.signatures.length === 0) return null
  return {
    value: {
      activeSignature: clampIndex(input.result.activeSignature, input.result.signatures.length),
      activeParameter: Math.max(0, input.result.activeParameter ?? 0),
      signatures: input.result.signatures.map((signature) => ({
        label: signature.label,
        documentation: toMonacoHoverValue(signature.documentation),
        parameters: (signature.parameters ?? []).map((parameter) => ({
          label:
            typeof parameter.label === "string"
              ? parameter.label
              : signature.label.slice(parameter.label[0], parameter.label[1]),
          documentation: toMonacoHoverValue(parameter.documentation),
        })),
      })),
    },
    dispose: () => {},
  }
}

export function normalizeServerLspDocumentHighlights(input: {
  currentPath: string
  currentModel: editor.ITextModel
  result: unknown
}) {
  if (!Array.isArray(input.result)) return [] as CodeEditorNavigationTargetItem[]
  const normalizedPath = normalizeCodeEditorNavigationPath(input.currentPath)
  const deduped = new Map<string, CodeEditorNavigationTargetItem>()

  for (const item of input.result.filter(isServerLspDocumentHighlight)) {
    const selection = toEditorSelection(item.range)
    const key = `${normalizedPath}:${selection.startLineNumber}:${selection.startColumn}:${selection.endLineNumber}:${selection.endColumn}`
    if (deduped.has(key)) continue

    deduped.set(key, {
      id: key,
      path: input.currentPath,
      label: `${getPathBaseName(input.currentPath)}:${selection.startLineNumber}`,
      detail: compactLine(input.currentModel.getLineContent(selection.startLineNumber)),
      selection,
    })
  }

  return Array.from(deduped.values())
}

export function normalizeServerLspMonacoDocumentHighlights(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}) {
  if (!Array.isArray(input.result)) return [] as import("monaco-editor").languages.DocumentHighlight[]
  return input.result.filter(isServerLspDocumentHighlight).map((item) => ({
    range: new input.monaco.Range(
      item.range.start.line + 1,
      item.range.start.character + 1,
      item.range.end.line + 1,
      item.range.end.character + 1,
    ),
    kind: toMonacoDocumentHighlightKind(item.kind, input.monaco),
  }))
}

export function normalizeServerLspMonacoLocations(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}) {
  if (!Array.isArray(input.result)) return [] as import("monaco-editor").languages.Location[]
  return input.result.filter(isServerLspLocation).flatMap((item) => {
    const uri = item.targetUri ?? item.uri
    const range = item.targetSelectionRange ?? item.targetRange ?? item.range
    if (!uri || !range) return []
    return [
      {
        uri: input.monaco.Uri.parse(uri),
        range: toMonacoRange(range),
      } satisfies import("monaco-editor").languages.Location,
    ]
  })
}

export function normalizeServerLspMonacoDocumentSymbols(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}) {
  if (!Array.isArray(input.result)) return [] as import("monaco-editor").languages.DocumentSymbol[]
  if (input.result.every(isServerLspDocumentSymbol)) {
    return input.result.map((symbol) => toMonacoDocumentSymbol(symbol, input.monaco))
  }
  if (input.result.every(isServerLspSymbolInformation)) {
    return input.result.map((symbol) => ({
      name: symbol.name,
      detail: symbol.containerName ?? "",
      kind: toMonacoSymbolKind(symbol.kind, input.monaco),
      tags: [],
      range: toMonacoRange(symbol.location.range),
      selectionRange: toMonacoRange(symbol.location.range),
      children: [],
    })) satisfies import("monaco-editor").languages.DocumentSymbol[]
  }
  return [] as import("monaco-editor").languages.DocumentSymbol[]
}

export function normalizeServerLspRenameEdit(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}): import("monaco-editor").languages.WorkspaceEdit & import("monaco-editor").languages.Rejection {
  const edit = normalizeServerLspWorkspaceEdit({
    result: input.result,
    monaco: input.monaco,
  })
  if (edit) return edit
  return {
    edits: [],
    rejectReason: "Rename returned no edits",
  }
}

export function normalizeServerLspMonacoTextEdits(result: unknown) {
  if (!Array.isArray(result)) return [] as import("monaco-editor").languages.TextEdit[]
  return result.flatMap((item) =>
    isServerLspTextEdit(item)
      ? [
          {
            range: toMonacoRange(item.range),
            text: item.newText,
          } satisfies import("monaco-editor").languages.TextEdit,
        ]
      : [],
  )
}

export function normalizeServerLspCodeActions(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
  registryKey: string
  model: editor.ITextModel
  binding: ServerLspModelBinding
}) {
  if (!Array.isArray(input.result)) return [] as import("monaco-editor").languages.CodeAction[]
  return input.result.flatMap((item) => {
    if (isServerLspCommandObject(item)) {
      return [
        {
          title: item.title,
          command: normalizeServerLspCommand({
            command: item,
            registryKey: input.registryKey,
            model: input.model,
            binding: input.binding,
          }),
        } satisfies import("monaco-editor").languages.CodeAction,
      ]
    }
    if (!isServerLspCodeAction(item)) return []
    return [
      {
      title: item.title,
      kind: item.kind,
      diagnostics: item.diagnostics?.map((diagnostic) => ({
        severity: toMonacoSeverity(diagnostic.severity, input.monaco),
        message: diagnostic.message,
        source: diagnostic.source,
        code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
      })),
      edit: normalizeServerLspWorkspaceEdit({
        result: item.edit,
        monaco: input.monaco,
      }) ?? undefined,
      command: normalizeServerLspCommand({
        command: item.command,
        registryKey: input.registryKey,
        model: input.model,
        binding: input.binding,
      }),
      isPreferred: item.isPreferred,
      disabled: item.disabled?.reason,
      } satisfies import("monaco-editor").languages.CodeAction,
    ]
  })
}

export function normalizeServerLspRenameLocation(input: {
  result: unknown
  model: editor.ITextModel
  monaco: typeof import("monaco-editor")
}): (import("monaco-editor").languages.RenameLocation & import("monaco-editor").languages.Rejection) | null {
  if (isServerLspRange(input.result)) {
    const range = toMonacoRange(input.result)
    return {
      range,
      text: input.model.getValueInRange(range),
    }
  }
  if (!isServerLspRenameLocation(input.result)) return null
  if (input.result.defaultBehavior) return null
  const range = toMonacoRange(input.result.range)
  return {
    range,
    text: input.result.placeholder ?? input.model.getValueInRange(range),
  }
}

export function normalizeServerLspWorkspaceEdit(input: {
  result: unknown
  monaco: typeof import("monaco-editor")
}): import("monaco-editor").languages.WorkspaceEdit | null {
  if (!isServerLspWorkspaceEdit(input.result)) return null

  const edits: import("monaco-editor").languages.WorkspaceEdit["edits"] = []

  if (input.result.changes) {
    for (const [uri, itemEdits] of Object.entries(input.result.changes)) {
      const resource = safeParseMonacoUri(uri, input.monaco)
      if (!resource) continue
      for (const edit of itemEdits.filter(isServerLspTextEdit)) {
        edits.push({
          resource,
          textEdit: {
            range: toMonacoRange(edit.range),
            text: edit.newText,
          },
          versionId: undefined,
        })
      }
    }
  }

  for (const change of input.result.documentChanges ?? []) {
    if (isServerLspTextDocumentEdit(change)) {
      const resource = safeParseMonacoUri(change.textDocument?.uri, input.monaco)
      if (!resource) continue
      for (const edit of (change.edits ?? []).filter(isServerLspTextEdit)) {
        edits.push({
          resource,
          textEdit: {
            range: toMonacoRange(edit.range),
            text: edit.newText,
          },
          versionId: change.textDocument?.version ?? undefined,
        })
      }
      continue
    }
    if (isServerLspCreateFile(change)) {
      const resource = safeParseMonacoUri(change.uri, input.monaco)
      if (!resource) continue
      edits.push({
        newResource: resource,
        options: {
          overwrite: change.options?.overwrite,
          ignoreIfExists: change.options?.ignoreIfExists,
        },
      })
      continue
    }
    if (isServerLspRenameFile(change)) {
      const oldResource = safeParseMonacoUri(change.oldUri, input.monaco)
      const newResource = safeParseMonacoUri(change.newUri, input.monaco)
      if (!oldResource || !newResource) continue
      edits.push({
        oldResource,
        newResource,
        options: {
          overwrite: change.options?.overwrite,
          ignoreIfExists: change.options?.ignoreIfExists,
        },
      })
      continue
    }
    if (!isServerLspDeleteFile(change)) continue
    const resource = safeParseMonacoUri(change.uri, input.monaco)
    if (!resource) continue
    edits.push({
      oldResource: resource,
      options: {
        recursive: change.options?.recursive,
        ignoreIfNotExists: change.options?.ignoreIfNotExists,
      },
    })
  }

  if (edits.length === 0) return null
  return { edits }
}

const serverLspProviderRegistry = new Map<string, ServerLspProviderRegistryEntry>()

type ServerLspModelQueryResult = ServerLspQueryResult & {
  binding?: ServerLspModelBinding
}

async function requestCodeEditorServerLspForModel(input: {
  registry: ServerLspProviderRegistryEntry
  model: editor.ITextModel
  query: ServerLspQuery
  token?: import("monaco-editor").CancellationToken
  binding?: ServerLspModelBinding
}): Promise<ServerLspModelQueryResult> {
  const binding = input.binding ?? getCodeEditorServerLspModelBinding(input.registry, input.model)
  if (!binding || input.model.isDisposed() || input.token?.isCancellationRequested) return { supported: false }
  if (input.query.kind !== "completion") {
    return requestCodeEditorServerLspForModelUncached({ ...input, binding })
  }

  const cacheKey = getCodeEditorServerLspCompletionCacheKey({ binding, query: input.query })
  const cached = input.registry.completionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  input.registry.completionCache.forEach((entry, key) => {
    if (entry.expiresAt <= Date.now()) input.registry.completionCache.delete(key)
  })
  const promise = requestCodeEditorServerLspForModelUncached({ ...input, binding })
  input.registry.completionCache.set(cacheKey, {
    expiresAt: Date.now() + SERVER_LSP_COMPLETION_CACHE_MS,
    promise,
  })
  return promise
}

export function getCodeEditorServerLspCompletionCacheKey(input: {
  binding: Pick<ServerLspModelBinding, "stamp">
  query: ServerLspCompletionQuery
}) {
  return [
    input.binding.stamp.key,
    input.binding.stamp.revision,
    input.binding.stamp.modelVersion,
    input.query.position.lineNumber,
    input.query.position.column,
    input.query.triggerCharacter ?? "",
    input.query.maxItems ?? "",
  ].join("\\n")
}

async function requestCodeEditorServerLspForModelUncached(input: {
  registry: ServerLspProviderRegistryEntry
  model: editor.ITextModel
  query: ServerLspQuery
  token?: import("monaco-editor").CancellationToken
  binding: ServerLspModelBinding
}): Promise<ServerLspModelQueryResult> {
  const binding = input.binding
  if (!isCodeEditorServerLspBindingCurrent({ registry: input.registry, model: input.model, binding, token: input.token })) {
    return { supported: false }
  }

  const text = input.model.getValue()
  if (!isCodeEditorServerLspBindingCurrent({ registry: input.registry, model: input.model, binding, token: input.token })) {
    return { supported: false }
  }

  const controller = new AbortController()
  const cancellation = input.token?.onCancellationRequested(() => controller.abort())
  const contentChange = input.model.onDidChangeContent(() => controller.abort())
  trackCodeEditorServerLspRequest(input.registry, binding, controller)
  if (input.query.kind === "completion") {
    input.registry.completionRequests.get(binding.stamp.key)?.abort()
    input.registry.completionRequests.set(binding.stamp.key, controller)
  }

  try {
    const response = await requestCodeEditorServerLsp({
      server: input.registry.server,
      directory: input.registry.directory,
      path: binding.path,
      text,
      signal: controller.signal,
      query: input.query,
    })
    if (
      !isCodeEditorServerLspBindingCurrent({
        registry: input.registry,
        model: input.model,
        binding,
        token: input.token,
        controller,
      })
    ) {
      return { supported: false }
    }
    return {
      ...response,
      binding,
    }
  } catch {
    return { supported: false }
  } finally {
    cancellation?.dispose()
    contentChange.dispose()
    releaseCodeEditorServerLspRequest(input.registry, binding, controller)
  }
}

export function shouldAcceptCodeEditorCompletionResult(input: {
  aborted: boolean
  expectedVersion: number
  currentVersion: number
}) {
  return !input.aborted && input.expectedVersion === input.currentVersion
}

export function shouldAcceptCodeEditorServerLspResult(input: {
  aborted: boolean
  expectedVersion: number
  currentVersion: number
  expectedPath: string
  currentPath?: string
  pathIsRegistered: boolean
  expectedStamp: {
    key: string
    revision: number
    modelVersion: number
  }
  currentStamp?: {
    key: string
    revision: number
    modelVersion: number
  }
}) {
  if (
    !shouldAcceptCodeEditorCompletionResult({
      aborted: input.aborted,
      expectedVersion: input.expectedVersion,
      currentVersion: input.currentVersion,
    })
  ) {
    return false
  }
  if (!input.pathIsRegistered || input.expectedPath !== input.currentPath || !input.currentStamp) return false
  return (
    input.expectedStamp.key === input.currentStamp.key &&
    input.expectedStamp.revision === input.currentStamp.revision &&
    input.expectedStamp.modelVersion === input.currentStamp.modelVersion
  )
}

function getCodeEditorServerLspModelBinding(
  registry: ServerLspProviderRegistryEntry,
  model: editor.ITextModel,
): ServerLspModelBinding | undefined {
  if (model.isDisposed()) return
  const path = getCodeEditorFilePathFromUri(model.uri.toString())
  if (!path) return
  const normalizedPath = normalizeCodeEditorNavigationPath(path)
  if (!registry.paths.has(normalizedPath)) return
  const stamp = getEditorDocumentStamp(model)
  if (!stamp) return
  return {
    path,
    normalizedPath,
    stamp,
    modelVersion: model.getVersionId(),
  }
}

function isCodeEditorServerLspBindingCurrent(input: {
  registry: ServerLspProviderRegistryEntry
  model: editor.ITextModel
  binding: ServerLspModelBinding
  token?: import("monaco-editor").CancellationToken
  controller?: AbortController
}) {
  if (input.model.isDisposed()) return false
  const path = getCodeEditorFilePathFromUri(input.model.uri.toString())
  const currentPath = path ? normalizeCodeEditorNavigationPath(path) : undefined
  return (
    serverLspProviderRegistry.get(input.registry.key) === input.registry &&
    shouldAcceptCodeEditorServerLspResult({
      aborted: Boolean(input.controller?.signal.aborted || input.token?.isCancellationRequested),
      expectedVersion: input.binding.modelVersion,
      currentVersion: input.model.getVersionId(),
      expectedPath: input.binding.normalizedPath,
      currentPath,
      pathIsRegistered: input.registry.paths.has(input.binding.normalizedPath),
      expectedStamp: input.binding.stamp,
      currentStamp: getEditorDocumentStamp(input.model),
    })
  )
}

function trackCodeEditorServerLspRequest(
  registry: ServerLspProviderRegistryEntry,
  binding: ServerLspModelBinding,
  controller: AbortController,
) {
  const requests = registry.requests.get(binding.normalizedPath) ?? new Set<AbortController>()
  requests.add(controller)
  registry.requests.set(binding.normalizedPath, requests)
}

function releaseCodeEditorServerLspRequest(
  registry: ServerLspProviderRegistryEntry,
  binding: ServerLspModelBinding,
  controller: AbortController,
) {
  const requests = registry.requests.get(binding.normalizedPath)
  requests?.delete(controller)
  if (requests?.size === 0) registry.requests.delete(binding.normalizedPath)
  if (registry.completionRequests.get(binding.stamp.key) === controller) {
    registry.completionRequests.delete(binding.stamp.key)
  }
}

function flattenServerDocumentSymbol(
  symbol: ServerLspDocumentSymbol,
  depth: number,
  nextID: () => string,
): CodeEditorDocumentSymbolItem[] {
  return [
    {
      id: nextID(),
      label: symbol.name,
      detail: symbol.detail,
      depth,
      selection: toEditorSelection(symbol.selectionRange),
      range: toEditorSelection(symbol.range),
    },
    ...(symbol.children ?? []).flatMap((child) => flattenServerDocumentSymbol(child, depth + 1, nextID)),
  ]
}

function toEditorSelection(range: ServerLspRange): CodeEditorNavigationSelection {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function toMonacoSeverity(severity: number | undefined, monaco: typeof import("monaco-editor")) {
  if (severity === 1) return monaco.MarkerSeverity.Error
  if (severity === 2) return monaco.MarkerSeverity.Warning
  if (severity === 3) return monaco.MarkerSeverity.Info
  return monaco.MarkerSeverity.Hint
}

function toMonacoDocumentHighlightKind(kind: number | undefined, monaco: typeof import("monaco-editor")) {
  if (kind === 2) return monaco.languages.DocumentHighlightKind.Read
  if (kind === 3) return monaco.languages.DocumentHighlightKind.Write
  return monaco.languages.DocumentHighlightKind.Text
}

function toMonacoDocumentSymbol(
  symbol: ServerLspDocumentSymbol,
  monaco: typeof import("monaco-editor"),
): import("monaco-editor").languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail ?? "",
    kind: toMonacoSymbolKind(symbol.kind, monaco),
    tags: [],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: (symbol.children ?? []).map((child) => toMonacoDocumentSymbol(child, monaco)),
  }
}

function toMonacoSymbolKind(kind: number | undefined, monaco: typeof import("monaco-editor")) {
  if (kind === 1) return monaco.languages.SymbolKind.File
  if (kind === 2) return monaco.languages.SymbolKind.Module
  if (kind === 3) return monaco.languages.SymbolKind.Namespace
  if (kind === 4) return monaco.languages.SymbolKind.Package
  if (kind === 5) return monaco.languages.SymbolKind.Class
  if (kind === 6) return monaco.languages.SymbolKind.Method
  if (kind === 7) return monaco.languages.SymbolKind.Property
  if (kind === 8) return monaco.languages.SymbolKind.Field
  if (kind === 9) return monaco.languages.SymbolKind.Constructor
  if (kind === 10) return monaco.languages.SymbolKind.Enum
  if (kind === 11) return monaco.languages.SymbolKind.Interface
  if (kind === 12) return monaco.languages.SymbolKind.Function
  if (kind === 13) return monaco.languages.SymbolKind.Variable
  if (kind === 14) return monaco.languages.SymbolKind.Constant
  if (kind === 15) return monaco.languages.SymbolKind.String
  if (kind === 16) return monaco.languages.SymbolKind.Number
  if (kind === 17) return monaco.languages.SymbolKind.Boolean
  if (kind === 18) return monaco.languages.SymbolKind.Array
  if (kind === 19) return monaco.languages.SymbolKind.Object
  if (kind === 20) return monaco.languages.SymbolKind.Key
  if (kind === 21) return monaco.languages.SymbolKind.Null
  if (kind === 22) return monaco.languages.SymbolKind.EnumMember
  if (kind === 23) return monaco.languages.SymbolKind.Struct
  if (kind === 24) return monaco.languages.SymbolKind.Event
  if (kind === 25) return monaco.languages.SymbolKind.Operator
  if (kind === 26) return monaco.languages.SymbolKind.TypeParameter
  return monaco.languages.SymbolKind.Object
}

function apiUrl(base: string, directory: string, input: string) {
  const url = new URL(input, base)
  url.searchParams.set("directory", directory)
  return url.toString()
}

function createCodeEditorServerLspProviderRelease(key: string, path: string) {
  let released = false
  return () => {
    if (released) return
    released = true
    releaseCodeEditorServerLspProviders(key, path)
  }
}

function retainCodeEditorServerLspPath(registry: ServerLspProviderRegistryEntry, path: string) {
  registry.paths.set(path, (registry.paths.get(path) ?? 0) + 1)
}

function releaseCodeEditorServerLspProviders(key: string, path: string) {
  const registry = serverLspProviderRegistry.get(key)
  if (!registry) return
  registry.count -= 1
  const pathCount = registry.paths.get(path) ?? 0
  if (pathCount > 1) registry.paths.set(path, pathCount - 1)
  if (pathCount === 1) {
    registry.paths.delete(path)
    abortCodeEditorServerLspRequests(registry, path)
  }
  if (registry.count > 0) return
  abortCodeEditorServerLspRequests(registry)
  const generation = ++registry.disposeGeneration
  queueMicrotask(() => {
    if (serverLspProviderRegistry.get(key) !== registry || registry.count > 0 || generation !== registry.disposeGeneration) {
      return
    }
    registry.disposables.forEach((disposable) => disposable.dispose())
    serverLspProviderRegistry.delete(key)
  })
}

function abortCodeEditorServerLspRequests(registry: ServerLspProviderRegistryEntry, path?: string) {
  if (path) {
    const requests = registry.requests.get(path)
    if (!requests) return
    requests.forEach((controller) => controller.abort())
    registry.requests.delete(path)
    registry.completionRequests.forEach((controller, key) => {
      if (requests.has(controller)) registry.completionRequests.delete(key)
    })
    return
  }
  registry.requests.forEach((requests) => requests.forEach((controller) => controller.abort()))
  registry.requests.clear()
  registry.completionRequests.forEach((controller) => controller.abort())
  registry.completionRequests.clear()
}

function createBasicAuthHeader(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${btoa(`${server.username ?? "lfcode"}:${server.password}`)}`,
  }
}

export function getCodeEditorFilePathFromUri(uri?: string) {
  if (!uri) return
  if (uri.startsWith("file://") || uri.startsWith("lfcode-editor://")) {
    try {
      return decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, "$1")
    } catch {
      return
    }
  }
  return uri
}

function getPathBaseName(path: string) {
  const normalized = normalizeCodeEditorNavigationPath(path)
  const parts = normalized.split("/")
  return parts.at(-1) ?? normalized
}

function compactLine(input: string) {
  const line = input.replace(/\s+/g, " ").trim()
  if (line) return line
  return " "
}

function getServerLspCompletionItems(result: unknown) {
  if (Array.isArray(result)) return result.filter(isServerLspCompletionItem)
  if (isServerLspCompletionList(result)) return result.items.filter(isServerLspCompletionItem)
  return [] as ServerLspCompletionItem[]
}

function normalizeServerLspCompletionLabel(label: ServerLspCompletionItem["label"]) {
  if (typeof label === "string") return label
  if (!label || typeof label !== "object") return
  return {
    label: label.label,
    detail: label.detail,
    description: label.description,
  }
}

function getServerLspCompletionInsertText(item: ServerLspCompletionItem) {
  if (isServerLspTextEdit(item.textEdit)) return item.textEdit.newText
  if (isServerLspInsertReplaceEdit(item.textEdit)) return item.textEdit.newText
  return item.insertText ?? (typeof item.label === "string" ? item.label : item.label.label)
}

function toMonacoCompletionRange(
  edit: ServerLspCompletionItem["textEdit"],
  defaultRange: import("monaco-editor").IRange,
): import("monaco-editor").IRange | import("monaco-editor").languages.CompletionItemRanges {
  if (isServerLspTextEdit(edit)) return toMonacoRange(edit.range)
  if (isServerLspInsertReplaceEdit(edit)) {
    return {
      insert: toMonacoRange(edit.insert),
      replace: toMonacoRange(edit.replace),
    }
  }
  return defaultRange
}

function toMonacoCompletionItemKind(kind: number | undefined, monaco: typeof import("monaco-editor")) {
  if (kind === 2) return monaco.languages.CompletionItemKind.Method
  if (kind === 3) return monaco.languages.CompletionItemKind.Function
  if (kind === 4) return monaco.languages.CompletionItemKind.Constructor
  if (kind === 5) return monaco.languages.CompletionItemKind.Field
  if (kind === 6) return monaco.languages.CompletionItemKind.Variable
  if (kind === 7) return monaco.languages.CompletionItemKind.Class
  if (kind === 8) return monaco.languages.CompletionItemKind.Interface
  if (kind === 9) return monaco.languages.CompletionItemKind.Module
  if (kind === 10) return monaco.languages.CompletionItemKind.Property
  if (kind === 11) return monaco.languages.CompletionItemKind.Unit
  if (kind === 12) return monaco.languages.CompletionItemKind.Value
  if (kind === 13) return monaco.languages.CompletionItemKind.Enum
  if (kind === 14) return monaco.languages.CompletionItemKind.Keyword
  if (kind === 15) return monaco.languages.CompletionItemKind.Snippet
  if (kind === 16) return monaco.languages.CompletionItemKind.Color
  if (kind === 17) return monaco.languages.CompletionItemKind.File
  if (kind === 18) return monaco.languages.CompletionItemKind.Reference
  if (kind === 19) return monaco.languages.CompletionItemKind.Folder
  if (kind === 20) return monaco.languages.CompletionItemKind.EnumMember
  if (kind === 21) return monaco.languages.CompletionItemKind.Constant
  if (kind === 22) return monaco.languages.CompletionItemKind.Struct
  if (kind === 23) return monaco.languages.CompletionItemKind.Event
  if (kind === 24) return monaco.languages.CompletionItemKind.Operator
  if (kind === 25) return monaco.languages.CompletionItemKind.TypeParameter
  return monaco.languages.CompletionItemKind.Text
}

function toMonacoRange(range: ServerLspRange): import("monaco-editor").IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function safeParseMonacoUri(uri: string | undefined, monaco: typeof import("monaco-editor")) {
  if (!uri) return
  try {
    return monaco.Uri.parse(uri)
  } catch {
    return
  }
}

function toMonacoHoverValue(value: HoverContent | undefined) {
  if (!value) return
  if (typeof value === "string") return value
  if (value.language && typeof value.value === "string") {
    return {
      value: ["```" + value.language, value.value, "```"].join("\n"),
    }
  }
  if (typeof value.value === "string") return { value: value.value }
}

function clampIndex(value: number | undefined, length: number) {
  if (length <= 0) return 0
  if (value === undefined || value < 0) return 0
  if (value >= length) return length - 1
  return value
}

function isServerLspLocation(value: unknown): value is ServerLspLocation {
  if (!value || typeof value !== "object") return false
  const item = value as ServerLspLocation
  return Boolean(item.range || item.targetRange || item.targetSelectionRange)
}

function isServerLspDiagnostic(value: unknown): value is ServerLspDiagnostic {
  if (!value || typeof value !== "object") return false
  return typeof (value as ServerLspDiagnostic).message === "string" && Boolean((value as ServerLspDiagnostic).range)
}

function isServerLspTextEdit(value: unknown): value is ServerLspTextEdit {
  if (!value || typeof value !== "object") return false
  return typeof (value as ServerLspTextEdit).newText === "string" && Boolean((value as ServerLspTextEdit).range)
}

function isServerLspInsertReplaceEdit(value: unknown): value is ServerLspInsertReplaceEdit {
  if (!value || typeof value !== "object") return false
  const item = value as ServerLspInsertReplaceEdit
  return typeof item.newText === "string" && Boolean(item.insert) && Boolean(item.replace)
}

function isServerLspCompletionItem(value: unknown): value is ServerLspCompletionItem {
  if (!value || typeof value !== "object") return false
  const item = value as ServerLspCompletionItem
  return typeof item.label === "string" || (typeof item.label === "object" && typeof item.label?.label === "string")
}

function isServerLspCompletionList(value: unknown): value is ServerLspCompletionList {
  if (!value || typeof value !== "object") return false
  return Array.isArray((value as ServerLspCompletionList).items)
}

function isServerLspSignatureHelp(value: unknown): value is ServerLspSignatureHelp {
  if (!value || typeof value !== "object") return false
  return Array.isArray((value as ServerLspSignatureHelp).signatures)
}

function isServerLspRange(value: unknown): value is ServerLspRange {
  if (!value || typeof value !== "object") return false
  const range = value as ServerLspRange
  return Boolean(range.start && range.end)
}

function isServerLspRenameLocation(value: unknown): value is ServerLspRenameLocation {
  if (!value || typeof value !== "object") return false
  const location = value as ServerLspRenameLocation
  return Boolean(location.range) || Boolean(location.defaultBehavior)
}

function isServerLspCodeAction(value: unknown): value is ServerLspCodeAction {
  if (!value || typeof value !== "object") return false
  return typeof (value as ServerLspCodeAction).title === "string"
}

function isServerLspCommandObject(value: unknown): value is ServerLspCommand {
  if (!value || typeof value !== "object") return false
  const command = value as ServerLspCommand
  return typeof command.title === "string" && typeof command.command === "string"
}

function isServerLspDocumentSymbol(value: unknown): value is ServerLspDocumentSymbol {
  if (!value || typeof value !== "object") return false
  const symbol = value as ServerLspDocumentSymbol
  return (
    typeof symbol.name === "string" &&
    Boolean(symbol.selectionRange) &&
    (symbol.children === undefined || Array.isArray(symbol.children))
  )
}

function isServerLspDocumentHighlight(value: unknown): value is ServerLspDocumentHighlight {
  if (!value || typeof value !== "object") return false
  return Boolean((value as ServerLspDocumentHighlight).range)
}

function isServerLspSymbolInformation(value: unknown): value is ServerLspSymbolInformation {
  if (!value || typeof value !== "object") return false
  const symbol = value as ServerLspSymbolInformation
  return typeof symbol.name === "string" && Boolean(symbol.location?.range)
}

function isServerLspWorkspaceEdit(value: unknown): value is ServerLspWorkspaceEdit {
  if (!value || typeof value !== "object") return false
  const edit = value as ServerLspWorkspaceEdit
  return Boolean(edit.changes) || Array.isArray(edit.documentChanges)
}

function isServerLspTextDocumentEdit(value: unknown): value is ServerLspTextDocumentEdit {
  if (!value || typeof value !== "object") return false
  const edit = value as ServerLspTextDocumentEdit
  return Boolean(edit.textDocument?.uri) && Array.isArray(edit.edits)
}

function isServerLspCreateFile(value: unknown): value is ServerLspCreateFile {
  if (!value || typeof value !== "object") return false
  const edit = value as ServerLspCreateFile
  return edit.kind === "create" && typeof edit.uri === "string"
}

function isServerLspRenameFile(value: unknown): value is ServerLspRenameFile {
  if (!value || typeof value !== "object") return false
  const edit = value as ServerLspRenameFile
  return edit.kind === "rename" && typeof edit.oldUri === "string" && typeof edit.newUri === "string"
}

function isServerLspDeleteFile(value: unknown): value is ServerLspDeleteFile {
  if (!value || typeof value !== "object") return false
  const edit = value as ServerLspDeleteFile
  return edit.kind === "delete" && typeof edit.uri === "string"
}

function normalizeServerLspCommand(input: {
  command: ServerLspCommand | undefined
  registryKey: string
  model: editor.ITextModel
  binding: ServerLspModelBinding
}) {
  if (!input.command) return
  return {
    id: SERVER_LSP_EXECUTE_COMMAND_ID,
    title: input.command.title,
    tooltip: input.command.title,
    arguments: [
      {
        registryKey: input.registryKey,
        model: input.model,
        binding: input.binding,
        command: input.command.command,
        arguments: input.command.arguments,
      } satisfies ServerLspExecuteCommandPayload,
    ],
  } satisfies import("monaco-editor").languages.Command
}

function ensureServerLspExecuteCommandRegistration(monaco: typeof import("monaco-editor")) {
  if (serverLspExecuteCommandRegistration) return
  serverLspExecuteCommandRegistration = monaco.editor.registerCommand(
    SERVER_LSP_EXECUTE_COMMAND_ID,
    async (_accessor, payload: unknown) => {
      if (!isServerLspExecuteCommandPayload(payload)) return
      const registry = serverLspProviderRegistry.get(payload.registryKey)
      if (!registry) return
      await requestCodeEditorServerLspForModel({
        registry,
        model: payload.model,
        binding: payload.binding,
        query: {
          kind: "executeCommand",
          command: payload.command,
          arguments: payload.arguments,
        },
      }).catch(() => undefined)
    },
  )
}

function isServerLspExecuteCommandPayload(value: unknown): value is ServerLspExecuteCommandPayload {
  if (!value || typeof value !== "object") return false
  const payload = value as Partial<ServerLspExecuteCommandPayload>
  return (
    typeof payload.registryKey === "string" &&
    typeof payload.command === "string" &&
    Boolean(payload.model) &&
    Boolean(payload.binding)
  )
}
