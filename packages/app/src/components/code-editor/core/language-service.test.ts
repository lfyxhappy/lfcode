import { describe, expect, test } from "bun:test"
import {
  createJavaScriptDiagnosticsOptions,
  createJsonDiagnosticsOptions,
  createJsonModeConfiguration,
  createTypeScriptDiagnosticsOptions,
  createTypeScriptModeConfiguration,
} from "./language-service"

describe("code editor language service defaults", () => {
  test("enables key TypeScript language service features", () => {
    expect(createTypeScriptModeConfiguration()).toMatchObject({
      completionItems: true,
      hovers: true,
      definitions: true,
      references: true,
      diagnostics: true,
      signatureHelp: true,
    })
  })

  test("enables JSON diagnostics with common schema matches", () => {
    const options = createJsonDiagnosticsOptions()
    expect(options.validate).toBe(true)
    expect(options.enableSchemaRequest).toBe(true)
    expect(options.schemas?.some((schema: { fileMatch?: string[] }) => schema.fileMatch?.includes("package.json"))).toBe(true)
    expect(options.schemas?.some((schema: { fileMatch?: string[] }) => schema.fileMatch?.includes("tsconfig.json"))).toBe(true)
  })

  test("keeps diagnostics enabled for TypeScript and JavaScript", () => {
    expect(createTypeScriptDiagnosticsOptions()).toMatchObject({
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    })
    expect(createJavaScriptDiagnosticsOptions()).toMatchObject({
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    })
  })

  test("keeps JSON editor assistance enabled", () => {
    expect(createJsonModeConfiguration()).toMatchObject({
      completionItems: true,
      hovers: true,
      documentSymbols: true,
      diagnostics: true,
      foldingRanges: true,
    })
  })
})
