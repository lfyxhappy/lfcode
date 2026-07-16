import { describe, expect, test } from "bun:test"
import type { CodeEditorRuntime } from "./runtime"

type FakeModel = {
  uri: { toString: () => string }
  dispose: () => void
  getValue: () => string
  setValue: (value: string) => void
  getVersionId: () => number
}

const models = new Map<string, FakeModel>()

const runtime = {
  monaco: {
    Uri: {
      from: (input: { scheme: string; authority: string; path: string }) => ({
        toString: () => `${input.scheme}://${input.authority}${input.path}`,
      }),
    },
    editor: {
      getModel: (resource: { toString: () => string }) => models.get(resource.toString()),
      setModelLanguage: () => {},
    },
  },
  createModel: (value: string, _language: string, resource: { toString: () => string }) => {
    let currentValue = value
    let version = 1
    const model: FakeModel = {
      uri: resource,
      dispose: () => {
        models.delete(resource.toString())
      },
      getValue: () => currentValue,
      setValue: (next) => {
        if (currentValue === next) return
        currentValue = next
        version += 1
      },
      getVersionId: () => version,
    }
    models.set(resource.toString(), model)
    return model
  },
  ensureLanguageSupport: async () => {},
} as unknown as CodeEditorRuntime

import {
  acquireEditorDocument,
  getEditorDocumentFallbackStamp,
  markEditorDocumentFallbackSaved,
  recordEditorDocumentFallbackChange,
} from "./document-registry"

describe("editor document registry", () => {
  test("advances an external revision even when the model already has that value", async () => {
    const lease = await acquireEditorDocument({
      path: "C:\\repo\\revision.ts",
      value: "const revision = 1",
      language: "typescript",
      revision: 1,
      readonly: false,
    }, runtime)

    const change = lease.applyExternal("const revision = 1", 2)

    expect(change).toMatchObject({
      baseRevision: 2,
      value: "const revision = 1",
      source: "external",
    })
    expect(lease.document().revision).toBe(2)
    lease.release()
  })

  test("only clears dirty state when the saved model stamp is still current", async () => {
    const lease = await acquireEditorDocument({
      path: "C:\\repo\\save-stamp.ts",
      value: "const value = 1",
      language: "typescript",
      revision: 4,
      readonly: false,
    }, runtime)
    lease.recordEditorChange()
    const saved = lease.stamp()

    lease.model.setValue("const value = 2")
    lease.recordEditorChange()

    expect(lease.markSaved(saved)).toBe(false)
    expect(lease.markSaved(lease.stamp())).toBe(true)
    lease.release()
  })

  test("keeps fallback text authoritative until a retry force-applies it to the Monaco model", async () => {
    const path = "C:\\repo\\fallback.ts"
    const lease = await acquireEditorDocument({
      path,
      value: "const before = true",
      language: "typescript",
      revision: 7,
      readonly: false,
    }, runtime)
    const stale = recordEditorDocumentFallbackChange({
      path,
      value: "const fallback = 1",
    })
    const current = recordEditorDocumentFallbackChange({
      path,
      value: "const fallback = 2",
    })

    expect(markEditorDocumentFallbackSaved(stale)).toBe(false)
    expect(markEditorDocumentFallbackSaved(current)).toBe(true)
    expect(getEditorDocumentFallbackStamp({ path, value: "const fallback = 2" })).toMatchObject({
      value: "const fallback = 2",
      modelVersion: lease.model.getVersionId(),
    })

    const retry = await acquireEditorDocument({
      path,
      value: "const fallback = 2",
      language: "typescript",
      revision: 6,
      readonly: false,
      dirty: true,
      force: true,
    }, runtime)

    expect(retry.model.getValue()).toBe("const fallback = 2")
    retry.release()
    lease.release()
  })
})
