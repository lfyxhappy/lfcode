import { parse } from "jsonc-parser"
import { normalizeCodeEditorNavigationPath } from "@/components/code-editor/core/navigation"
import { getCodeEditorFilePathFromUri } from "@/components/code-editor/core/server-lsp"

const CACHE_TTL_MS = 3_000

export type CodeEditorSnippetFile = {
  path: string
  content: string
}

export type CodeEditorSnippet = {
  label: string
  prefix: string
  body: string
  description?: string
}

type RawSnippet = {
  prefix?: string | string[]
  body?: string | string[]
  description?: string | string[]
  scope?: string
}

type SnippetProviderRegistryEntry = {
  count: number
  paths: Map<string, number>
  cache?: { expiresAt: number; value: Promise<CodeEditorSnippet[]> }
  loadFiles: (directory: string) => Promise<CodeEditorSnippetFile[]>
  provider: import("monaco-editor").IDisposable
  disposeGeneration: number
}

const snippetProviderRegistry = new Map<string, SnippetProviderRegistryEntry>()

export function parseCodeEditorSnippetFiles(input: { files: CodeEditorSnippetFile[]; language: string }) {
  return input.files.flatMap((file) => {
    const snippets = parse(file.content) as Record<string, RawSnippet> | undefined
    if (!snippets || typeof snippets !== "object" || Array.isArray(snippets)) return []

    return Object.entries(snippets).flatMap(([label, snippet]) => {
      if (!snippet || typeof snippet !== "object" || Array.isArray(snippet)) return []
      if (!isSnippetForLanguage(snippet, input.language, file.path)) return []
      const body = normalizeSnippetBody(snippet.body)
      if (!body) return []
      const description = normalizeSnippetText(snippet.description)
      return normalizeSnippetPrefixes(snippet.prefix).map((prefix) => ({
        label,
        prefix,
        body,
        ...(description ? { description } : {}),
      }))
    })
  })
}

export function registerCodeEditorSnippetProvider(input: {
  monaco: typeof import("monaco-editor")
  directory: string
  path: string
  language: string
  loadFiles: (directory: string) => Promise<CodeEditorSnippetFile[]>
}) {
  const key = [normalizeCodeEditorNavigationPath(input.directory), input.language].join("\n")
  const path = normalizeCodeEditorNavigationPath(input.path)
  const entry = snippetProviderRegistry.get(key) ?? createSnippetProviderRegistryEntry(input)
  snippetProviderRegistry.set(key, entry)
  entry.count += 1
  entry.paths.set(path, (entry.paths.get(path) ?? 0) + 1)
  entry.disposeGeneration += 1

  let disposed = false
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      releaseCodeEditorSnippetProvider(key, path, entry)
    },
  } satisfies import("monaco-editor").IDisposable
}

function createSnippetProviderRegistryEntry(input: {
  monaco: typeof import("monaco-editor")
  directory: string
  language: string
  loadFiles: (directory: string) => Promise<CodeEditorSnippetFile[]>
}) {
  const entry: SnippetProviderRegistryEntry = {
    count: 0,
    paths: new Map(),
    loadFiles: input.loadFiles,
    provider: { dispose: () => {} },
    disposeGeneration: 0,
  }
  entry.provider = input.monaco.languages.registerCompletionItemProvider(input.language, {
    provideCompletionItems: async (model, position, _context, token) => {
      const actualPath = getCodeEditorFilePathFromUri(model.uri.toString())
      const path = actualPath && normalizeCodeEditorNavigationPath(actualPath)
      if (!path || !entry.paths.has(path)) return { suggestions: [] }
      const version = model.getVersionId()
      const snippets = await loadCodeEditorSnippets(entry, input.directory, input.language)
      if (
        token.isCancellationRequested ||
        model.isDisposed() ||
        model.getVersionId() !== version ||
        !entry.paths.has(path)
      ) {
        return { suggestions: [] }
      }
      const word = model.getWordUntilPosition(position)
      const range = new input.monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      return {
        suggestions: snippets.map((snippet) => ({
          label: snippet.label,
          kind: input.monaco.languages.CompletionItemKind.Snippet,
          detail: snippet.description ?? "Snippet",
          documentation: snippet.description ? { value: snippet.description } : undefined,
          filterText: snippet.prefix,
          insertText: snippet.body,
          insertTextRules: input.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
      }
    },
  })
  return entry
}

function loadCodeEditorSnippets(entry: SnippetProviderRegistryEntry, directory: string, language: string) {
  if (entry.cache && entry.cache.expiresAt > Date.now()) return entry.cache.value
  const value = entry
    .loadFiles(directory)
    .then((files) => parseCodeEditorSnippetFiles({ files, language }))
    .catch(() => [])
  entry.cache = { expiresAt: Date.now() + CACHE_TTL_MS, value }
  return value
}

function releaseCodeEditorSnippetProvider(key: string, path: string, entry: SnippetProviderRegistryEntry) {
  if (snippetProviderRegistry.get(key) !== entry) return
  const count = entry.paths.get(path) ?? 0
  if (count > 1) entry.paths.set(path, count - 1)
  if (count === 1) entry.paths.delete(path)
  entry.count = Math.max(0, entry.count - 1)
  if (entry.count > 0) return

  const generation = ++entry.disposeGeneration
  queueMicrotask(() => {
    if (snippetProviderRegistry.get(key) !== entry || entry.count > 0 || generation !== entry.disposeGeneration) return
    entry.provider.dispose()
    snippetProviderRegistry.delete(key)
  })
}

function isSnippetForLanguage(snippet: RawSnippet, language: string, path: string) {
  const scope = normalizeSnippetScope(snippet.scope)
  if (scope.length > 0) return scope.some((item) => snippetLanguageMatches(item, language))
  const filename = path.split(/[\\/]/).at(-1)?.replace(/(?:\.code-snippets|\.snippets|\.json)$/i, "")
  if (!filename || filename === "global") return true
  return snippetLanguageMatches(filename, language)
}

function normalizeSnippetScope(scope: string | undefined) {
  return scope?.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean) ?? []
}

function snippetLanguageMatches(scope: string, language: string) {
  const normalized = scope.toLowerCase()
  if (normalized === language) return true
  if (language === "typescript") return normalized === "ts" || normalized === "tsx" || normalized === "typescriptreact"
  if (language === "javascript") return normalized === "js" || normalized === "jsx" || normalized === "javascriptreact"
  if (language === "cpp") return normalized === "c++" || normalized === "cc" || normalized === "cxx"
  if (language === "powershell") return normalized === "pwsh" || normalized === "ps1"
  if (language === "shell") return normalized === "sh" || normalized === "bash" || normalized === "shellscript"
  return false
}

function normalizeSnippetPrefixes(prefix: RawSnippet["prefix"]) {
  if (typeof prefix === "string") return prefix.trim() ? [prefix] : []
  if (!Array.isArray(prefix)) return []
  return prefix.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function normalizeSnippetBody(body: RawSnippet["body"]) {
  if (typeof body === "string") return body
  if (!Array.isArray(body) || !body.every((item) => typeof item === "string")) return
  return body.join("\n")
}

function normalizeSnippetText(value: RawSnippet["description"]) {
  if (typeof value === "string") return value
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return
  return value.join("\n")
}
