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
  let cache: { expiresAt: number; value: Promise<CodeEditorSnippet[]> } | undefined
  const load = () => {
    if (cache && cache.expiresAt > Date.now()) return cache.value
    const value = input
      .loadFiles(input.directory)
      .then((files) => parseCodeEditorSnippetFiles({ files, language: input.language }))
      .catch(() => [])
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, value }
    return value
  }

  return input.monaco.languages.registerCompletionItemProvider(input.language, {
    provideCompletionItems: async (model, position, _context, token) => {
      const actualPath = getCodeEditorFilePathFromUri(model.uri.toString())
      if (!actualPath || normalizeCodeEditorNavigationPath(actualPath) !== normalizeCodeEditorNavigationPath(input.path)) {
        return { suggestions: [] }
      }

      const snippets = await load()
      if (token.isCancellationRequested) return { suggestions: [] }
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
