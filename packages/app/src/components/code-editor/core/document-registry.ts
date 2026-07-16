import { getCodeEditorLanguage } from "@/components/code-editor/core/language"
import { startCodeEditorMetric } from "@/components/code-editor/core/metrics"
import { type CodeEditorRuntime, initializeCodeEditorRuntime } from "@/components/code-editor/core/runtime"

const IDLE_DISPOSE_MS = 60_000
const MAX_IDLE_DOCUMENTS = 8

export type EditorDocument = {
  key: string
  path: string
  language: string
  value: string
  revision: number
  readonly: boolean
}

export type EditorChange = {
  key: string
  baseRevision: number
  modelVersion: number
  value: string
  source: "editor" | "external"
}

type DocumentEntry = {
  key: string
  path: string
  language: string
  revision: number
  dirty: boolean
  promise?: Promise<import("monaco-editor").editor.ITextModel>
  model?: import("monaco-editor").editor.ITextModel
  refCount: number
  releasedAt: number
  disposeTimer?: ReturnType<typeof setTimeout>
}

const entries = new Map<string, DocumentEntry>()
const entriesByPath = new Map<string, DocumentEntry>()
const fallbackDrafts = new Map<
  string,
  {
    path: string
    value: string
    revision: number
    version: number
    dirty: boolean
  }
>()

export type EditorDocumentFallbackStamp = {
  path: string
  value: string
  baseRevision: number
  modelVersion: number
  fallbackVersion: number
}

export async function acquireEditorDocument(
  input: Omit<EditorDocument, "key"> & { dirty?: boolean; force?: boolean },
  runtimeOverride?: CodeEditorRuntime,
) {
  const language = input.language || getCodeEditorLanguage(input.path) || "plaintext"
  const normalizedPath = normalizeDocumentPath(input.path)
  const runtimeMetric = startCodeEditorMetric("runtime:start", { path: input.path, language })
  const runtime = runtimeOverride ?? (await initializeCodeEditorRuntime())
  runtimeMetric("runtime:ready")
  const resource = runtime.monaco.Uri.from({
    scheme: "lfcode-editor",
    authority: "model",
    path: `/${normalizedPath}`,
  })
  const key = resource.toString()
  const entry = entries.get(key) ?? createEntry(key, input.path, language, input.revision)

  if (entry.disposeTimer !== undefined) {
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = undefined
  }
  const modelMetric = startCodeEditorMetric("model:start", { path: input.path, language })
  const model = await runtime
    .ensureLanguageSupport(language)
    .then(() => entry.model ?? loadModel(entry, runtime, resource, input.value, language))
    .catch((error: unknown) => {
      if (entry.refCount === 0 && !entry.model) deleteEntry(entry)
      throw error
    })
  runtime.monaco.editor.setModelLanguage(model, language)
  entry.language = language
  if (input.force || (!entry.dirty && input.revision >= entry.revision)) {
    if (model.getValue() !== input.value) model.setValue(input.value)
    entry.revision = Math.max(entry.revision, input.revision)
    if (input.force) entry.dirty = input.dirty ?? false
  }
  if (input.force) fallbackDrafts.delete(normalizedPath)
  entry.refCount += 1
  modelMetric("model:ready")

  return {
    document: (): EditorDocument => ({
      key,
      path: entry.path,
      language: entry.language,
      value: model.getValue(),
      revision: entry.revision,
      readonly: input.readonly,
    }),
    model,
    applyExternal: (value: string, revision: number, force = false): EditorChange | undefined => {
      if (revision <= entry.revision) return
      if (entry.dirty && !force && model.getValue() !== value) return
      entry.revision = revision
      if (force) entry.dirty = false
      return {
        ...createChange(entry, model, "external"),
        value,
      }
    },
    recordEditorChange: (): EditorChange => {
      entry.dirty = true
      return createChange(entry, model, "editor")
    },
    stamp: () => createChange(entry, model, "editor"),
    markSaved: (stamp: Pick<EditorChange, "baseRevision" | "modelVersion">) => {
      if (entry.revision !== stamp.baseRevision || model.getVersionId() !== stamp.modelVersion) return false
      entry.dirty = false
      return true
    },
    release: () => releaseEntry(entry),
  }
}

export function recordEditorDocumentFallbackChange(input: { path: string; value: string }): EditorDocumentFallbackStamp {
  const normalizedPath = normalizeDocumentPath(input.path)
  const entry = entriesByPath.get(normalizedPath)
  const draft = fallbackDrafts.get(normalizedPath) ?? {
    path: input.path,
    value: input.value,
    revision: entry?.revision ?? 0,
    version: 0,
    dirty: false,
  }
  draft.value = input.value
  draft.revision = entry?.revision ?? draft.revision
  draft.version += 1
  draft.dirty = true
  fallbackDrafts.set(normalizedPath, draft)
  if (entry) {
    if (entry.model && entry.model.getValue() !== input.value) entry.model.setValue(input.value)
    entry.dirty = true
  }
  return {
    path: input.path,
    value: input.value,
    baseRevision: entry?.revision ?? draft.revision,
    modelVersion: entry?.model?.getVersionId() ?? draft.version,
    fallbackVersion: draft.version,
  }
}

export function getEditorDocumentFallbackStamp(input: { path: string; value: string }): EditorDocumentFallbackStamp {
  const normalizedPath = normalizeDocumentPath(input.path)
  const draft = fallbackDrafts.get(normalizedPath)
  if (!draft || draft.value !== input.value) return recordEditorDocumentFallbackChange(input)
  const entry = entriesByPath.get(normalizedPath)
  return {
    path: input.path,
    value: input.value,
    baseRevision: entry?.revision ?? draft.revision,
    modelVersion: entry?.model?.getVersionId() ?? draft.version,
    fallbackVersion: draft.version,
  }
}

export function markEditorDocumentFallbackSaved(stamp: EditorDocumentFallbackStamp) {
  const normalizedPath = normalizeDocumentPath(stamp.path)
  const draft = fallbackDrafts.get(normalizedPath)
  if (!draft || draft.value !== stamp.value || draft.version !== stamp.fallbackVersion) return false
  const entry = entriesByPath.get(normalizedPath)
  if (entry) {
    if (entry.revision !== stamp.baseRevision) return false
    if (entry.model && entry.model.getVersionId() !== stamp.modelVersion) return false
    entry.dirty = false
  }
  draft.dirty = false
  return true
}

export function getEditorDocumentStamp(model: import("monaco-editor").editor.ITextModel) {
  const entry = entries.get(model.uri.toString())
  if (!entry) return
  return {
    key: entry.key,
    revision: entry.revision,
    modelVersion: model.getVersionId(),
  }
}

function createEntry(key: string, path: string, language: string, revision: number) {
  const entry: DocumentEntry = {
    key,
    path,
    language,
    revision,
    dirty: false,
    refCount: 0,
    releasedAt: 0,
  }
  entries.set(key, entry)
  entriesByPath.set(normalizeDocumentPath(path), entry)
  return entry
}

function createChange(
  entry: DocumentEntry,
  model: import("monaco-editor").editor.ITextModel,
  source: EditorChange["source"],
) {
  return {
    key: entry.key,
    baseRevision: entry.revision,
    modelVersion: model.getVersionId(),
    value: model.getValue(),
    source,
  }
}

function loadModel(
  entry: DocumentEntry,
  runtime: CodeEditorRuntime,
  resource: import("monaco-editor").Uri,
  value: string,
  language: string,
) {
  if (entry.promise) return entry.promise
  entry.promise = Promise.resolve(runtime.monaco.editor.getModel(resource) ?? runtime.createModel(value, language, resource))
    .then((model) => {
      entry.model = model
      return model
    })
    .finally(() => {
      entry.promise = undefined
    })
  return entry.promise
}

function releaseEntry(entry: DocumentEntry) {
  if (entry.refCount === 0) return
  entry.refCount -= 1
  if (entry.refCount > 0) return
  entry.releasedAt = Date.now()
  entry.disposeTimer = setTimeout(() => {
    if (entry.refCount === 0) disposeEntry(entry)
  }, IDLE_DISPOSE_MS)
  pruneIdleEntries()
}

function pruneIdleEntries() {
  const idle = Array.from(entries.values())
    .filter((entry) => entry.refCount === 0)
    .sort((left, right) => left.releasedAt - right.releasedAt)
  if (idle.length <= MAX_IDLE_DOCUMENTS) return
  idle.slice(0, idle.length - MAX_IDLE_DOCUMENTS).forEach(disposeEntry)
}

function disposeEntry(entry: DocumentEntry) {
  if (entry.disposeTimer !== undefined) clearTimeout(entry.disposeTimer)
  entry.model?.dispose()
  deleteEntry(entry)
}

function deleteEntry(entry: DocumentEntry) {
  entries.delete(entry.key)
  const normalizedPath = normalizeDocumentPath(entry.path)
  if (entriesByPath.get(normalizedPath) === entry) entriesByPath.delete(normalizedPath)
}

function normalizeDocumentPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "")
}
