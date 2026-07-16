/// <reference path="../monaco-editor.d.ts" />

import "monaco-editor/min/vs/editor/editor.main.css"
import { StandaloneServices } from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js"
import { ICodeEditorService } from "monaco-editor/esm/vs/editor/browser/services/codeEditorService.js"
import { ICommandService } from "monaco-editor/esm/vs/platform/commands/common/commands.js"

type MonacoApi = typeof import("monaco-editor")
type WorkerConstructor = new () => Worker
type LanguageSupportHook = (monaco: MonacoApi) => void

export type MonacoKernelStatus = "idle" | "initializing" | "ready" | "degraded" | "failed"

export type MonacoKernelSnapshot = {
  status: MonacoKernelStatus
  error?: string
}

export type MonacoCodeEditorOpenHandler = (
  input: {
    resource?: { scheme?: string; toString(): string; fsPath?: string; path?: string }
    options?: {
      selection?: {
        startLineNumber: number
        startColumn: number
        endLineNumber?: number
        endColumn?: number
      }
    }
  },
  source: import("monaco-editor").editor.ICodeEditor | null,
) => Promise<import("monaco-editor").editor.ICodeEditor | null>

export type MonacoKernel = {
  monaco: MonacoApi
  createEditor: MonacoApi["editor"]["create"]
  createDiffEditor: MonacoApi["editor"]["createDiffEditor"]
  createModel: MonacoApi["editor"]["createModel"]
  executeCommand: (commandID: string, ...args: unknown[]) => Promise<unknown>
  ensureLanguageSupport: (language?: string) => Promise<void>
  syncConfiguration: (input: { theme: "light" | "dark" }) => Promise<void>
}

const loadedLanguages = new Set<string>()
const loadingLanguages = new Map<string, Promise<void>>()
const workerConstructors = new Map<string, WorkerConstructor>()
const workerPromises = new Map<string, Promise<void>>()
const languageSupportHooks = new Map<string, Set<LanguageSupportHook>>()
const listeners = new Set<(snapshot: MonacoKernelSnapshot) => void>()

let currentKernel: MonacoKernel | undefined
let kernelPromise: Promise<MonacoKernel> | undefined
let snapshot: MonacoKernelSnapshot = { status: "idle" }

export function getMonacoKernelSnapshot() {
  return snapshot
}

export function subscribeMonacoKernel(listener: (next: MonacoKernelSnapshot) => void) {
  listeners.add(listener)
  listener(snapshot)
  return () => listeners.delete(listener)
}

export function registerMonacoLanguageSupportHook(language: string, hook: LanguageSupportHook) {
  const hooks = languageSupportHooks.get(language) ?? new Set<LanguageSupportHook>()
  hooks.add(hook)
  languageSupportHooks.set(language, hooks)
  if (currentKernel && loadedLanguages.has(language)) hook(currentKernel.monaco)
}

export function initializeMonacoKernel() {
  if (kernelPromise) return kernelPromise

  updateSnapshot({ status: "initializing" })
  kernelPromise = createKernel()
    .then((kernel) => {
      currentKernel = kernel
      updateSnapshot({ status: "ready" })
      return kernel
    })
    .catch((error: unknown) => {
      kernelPromise = undefined
      updateSnapshot({ status: "failed", error: describeError(error) })
      throw error
    })
  return kernelPromise
}

export function retryMonacoKernel() {
  if (snapshot.status === "initializing") return initializeMonacoKernel()
  currentKernel = undefined
  kernelPromise = undefined
  updateSnapshot({ status: "idle" })
  return initializeMonacoKernel()
}

export function preflightMonacoEditor(editor: import("monaco-editor").editor.IStandaloneCodeEditor) {
  const missing = [
    "editor.contrib.suggestController",
    "editor.contrib.codeActionController",
    "css.editor.codeLens",
    "editor.contrib.InlayHints",
  ].filter((id) => !editor.getContribution(id))
  try {
    getCommandService()
  } catch {
    missing.push("commandService")
  }
  try {
    const worker = createWorker("editor")
    worker.terminate()
  } catch {
    missing.push("editorWorker")
  }
  if (missing.length === 0) return

  const error = new Error(`Monaco editor services are unavailable: ${missing.join(", ")}`)
  updateSnapshot({ status: "degraded", error: error.message })
  throw error
}

export function markMonacoKernelDegraded(error: unknown) {
  updateSnapshot({ status: "degraded", error: describeError(error) })
}

export function registerMonacoCodeEditorOpenHandler(handler: MonacoCodeEditorOpenHandler) {
  return getCodeEditorService().registerCodeEditorOpenHandler(handler)
}

async function createKernel(): Promise<MonacoKernel> {
  const monaco = await import("monaco-editor/esm/vs/editor/editor.api")
  await import("monaco-editor/esm/vs/editor/editor.all")
  await ensureWorker("editor")
  installWorkerEnvironment()

  return {
    monaco,
    createEditor: monaco.editor.create,
    createDiffEditor: monaco.editor.createDiffEditor,
    createModel: monaco.editor.createModel,
    executeCommand: (commandID, ...args) => getCommandService().executeCommand(commandID, ...args),
    ensureLanguageSupport: (language?: string) => ensureLanguageSupport(monaco, language),
    syncConfiguration: async (input) => {
      monaco.editor.setTheme(input.theme === "dark" ? "vs-dark" : "vs")
    },
  }
}

function getCommandService() {
  const commandService = StandaloneServices.get(ICommandService) as {
    executeCommand?: (id: string, ...values: unknown[]) => Promise<unknown>
  }
  if (typeof commandService?.executeCommand !== "function") {
    throw new Error("Monaco command service is unavailable")
  }
  return commandService as { executeCommand: (id: string, ...values: unknown[]) => Promise<unknown> }
}

function getCodeEditorService() {
  const codeEditorService = StandaloneServices.get(ICodeEditorService) as {
    registerCodeEditorOpenHandler?: (handler: MonacoCodeEditorOpenHandler) => { dispose(): void }
  }
  if (typeof codeEditorService?.registerCodeEditorOpenHandler !== "function") {
    throw new Error("Monaco code editor service is unavailable")
  }
  return codeEditorService as {
    registerCodeEditorOpenHandler: (handler: MonacoCodeEditorOpenHandler) => { dispose(): void }
  }
}

function updateSnapshot(next: MonacoKernelSnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener(next))
}

function installWorkerEnvironment() {
  const target = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker?: (moduleID: string, label: string) => Worker
    }
  }
  target.MonacoEnvironment = {
    getWorker: (_, label) => createWorker(label),
  }
}

async function ensureLanguageSupport(monaco: MonacoApi, language?: string) {
  if (!language || language === "plaintext" || loadedLanguages.has(language)) return
  const pending = loadingLanguages.get(language)
  if (pending) return pending

  const next = loadLanguageSupport(language)
    .then(() => {
      loadedLanguages.add(language)
      languageSupportHooks.get(language)?.forEach((hook) => hook(monaco))
    })
    .finally(() => loadingLanguages.delete(language))
  loadingLanguages.set(language, next)
  return next
}

async function loadLanguageSupport(language: string) {
  if (language === "json") {
    await ensureWorker("json")
    await import("monaco-editor/esm/vs/language/json/monaco.contribution")
    return
  }
  if (language === "typescript" || language === "javascript") {
    await ensureWorker("typescript")
    await Promise.all([
      import("monaco-editor/esm/vs/language/typescript/monaco.contribution"),
      import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"),
      import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"),
    ])
    return
  }
  if (language === "html") {
    await ensureWorker("html")
    await import("monaco-editor/esm/vs/language/html/monaco.contribution")
    return
  }
  if (language === "css" || language === "scss" || language === "less") {
    await ensureWorker("css")
    await import("monaco-editor/esm/vs/language/css/monaco.contribution")
    return
  }
  await loadBasicLanguage(language)
}

async function loadBasicLanguage(language: string) {
  if (language === "bat") return import("monaco-editor/esm/vs/basic-languages/bat/bat.contribution")
  if (language === "cpp" || language === "c") return import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution")
  if (language === "csharp") return import("monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution")
  if (language === "dockerfile") return import("monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution")
  if (language === "go") return import("monaco-editor/esm/vs/basic-languages/go/go.contribution")
  if (language === "graphql") return import("monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution")
  if (language === "ini") return import("monaco-editor/esm/vs/basic-languages/ini/ini.contribution")
  if (language === "java") return import("monaco-editor/esm/vs/basic-languages/java/java.contribution")
  if (language === "kotlin") return import("monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution")
  if (language === "lua") return import("monaco-editor/esm/vs/basic-languages/lua/lua.contribution")
  if (language === "markdown") return import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution")
  if (language === "php") return import("monaco-editor/esm/vs/basic-languages/php/php.contribution")
  if (language === "powershell") return import("monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution")
  if (language === "protobuf") return import("monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution")
  if (language === "python") return import("monaco-editor/esm/vs/basic-languages/python/python.contribution")
  if (language === "r") return import("monaco-editor/esm/vs/basic-languages/r/r.contribution")
  if (language === "ruby") return import("monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution")
  if (language === "rust") return import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution")
  if (language === "scala") return import("monaco-editor/esm/vs/basic-languages/scala/scala.contribution")
  if (language === "shell") return import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution")
  if (language === "sql") return import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution")
  if (language === "swift") return import("monaco-editor/esm/vs/basic-languages/swift/swift.contribution")
  if (language === "xml") return import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution")
  if (language === "yaml") return import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution")
  throw new Error(`Unsupported Monaco language: ${language}`)
}

function normalizeWorkerLabel(label: string) {
  if (label === "json") return "json"
  if (label === "css" || label === "scss" || label === "less") return "css"
  if (label === "html" || label === "handlebars" || label === "razor") return "html"
  if (label === "typescript" || label === "javascript") return "typescript"
  return "editor"
}

async function ensureWorker(label: string) {
  const normalized = normalizeWorkerLabel(label)
  if (workerConstructors.has(normalized)) return
  const pending = workerPromises.get(normalized)
  if (pending) return pending

  const next = loadWorker(normalized)
    .then((worker) => {
      workerConstructors.set(normalized, worker)
    })
    .finally(() => workerPromises.delete(normalized))
  workerPromises.set(normalized, next)
  await next
}

function createWorker(label: string) {
  const worker = workerConstructors.get(normalizeWorkerLabel(label)) ?? workerConstructors.get("editor")
  if (!worker) throw new Error(`Monaco worker is unavailable for ${label}`)
  return new worker()
}

async function loadWorker(label: string): Promise<WorkerConstructor> {
  if (label === "json") return (await import("monaco-editor/esm/vs/language/json/json.worker?worker")).default
  if (label === "css") return (await import("monaco-editor/esm/vs/language/css/css.worker?worker")).default
  if (label === "html") return (await import("monaco-editor/esm/vs/language/html/html.worker?worker")).default
  if (label === "typescript") return (await import("monaco-editor/esm/vs/language/typescript/ts.worker?worker")).default
  return (await import("monaco-editor/esm/vs/editor/editor.worker?worker")).default
}

function describeError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
