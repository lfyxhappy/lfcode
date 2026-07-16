type TypeScriptCompilerOptions = {
  allowNonTsExtensions?: boolean
  allowJs?: boolean
  checkJs?: boolean
  jsx?: number
  target?: number
  module?: number
  moduleResolution?: number
  resolveJsonModule?: boolean
  esModuleInterop?: boolean
  noEmit?: boolean
  strict?: boolean
}

type TypeScriptDiagnosticsOptions = {
  noSemanticValidation?: boolean
  noSyntaxValidation?: boolean
  noSuggestionDiagnostics?: boolean
  onlyVisible?: boolean
  diagnosticCodesToIgnore?: number[]
}

type TypeScriptModeConfiguration = {
  completionItems?: boolean
  hovers?: boolean
  documentSymbols?: boolean
  definitions?: boolean
  references?: boolean
  documentHighlights?: boolean
  rename?: boolean
  diagnostics?: boolean
  signatureHelp?: boolean
  codeActions?: boolean
  inlayHints?: boolean
}

type JsonSchemaConfig = {
  uri: string
  fileMatch: string[]
}

type JsonDiagnosticsOptions = {
  validate?: boolean
  allowComments?: boolean
  enableSchemaRequest?: boolean
  schemaValidation?: "warning" | "error" | "ignore"
  schemaRequest?: "warning" | "error" | "ignore"
  trailingCommas?: "warning" | "error" | "ignore"
  comments?: "warning" | "error" | "ignore"
  schemas?: JsonSchemaConfig[]
}

type JsonModeConfiguration = {
  completionItems?: boolean
  hovers?: boolean
  documentSymbols?: boolean
  diagnostics?: boolean
  documentFormattingEdits?: boolean
  documentRangeFormattingEdits?: boolean
  tokens?: boolean
  colors?: boolean
  foldingRanges?: boolean
  selectionRanges?: boolean
}

type TypeScriptDefaultsLike = {
  setEagerModelSync(value: boolean): void
  setCompilerOptions(value: TypeScriptCompilerOptions): void
  setDiagnosticsOptions(value: TypeScriptDiagnosticsOptions): void
  setModeConfiguration(value: TypeScriptModeConfiguration): void
}

type JsonDefaultsLike = {
  setDiagnosticsOptions(value: JsonDiagnosticsOptions): void
  setModeConfiguration(value: JsonModeConfiguration): void
}

type MonacoEditorModule = {
  languages: {
    typescript?: {
      typescriptDefaults: TypeScriptDefaultsLike
      javascriptDefaults: TypeScriptDefaultsLike
      JsxEmit: Record<string, number>
      ScriptTarget: Record<string, number>
      ModuleKind: Record<string, number>
      ModuleResolutionKind: Record<string, number>
    }
    json?: {
      jsonDefaults: JsonDefaultsLike
    }
  }
}

export function applyCodeEditorLanguageServiceDefaults(monaco: MonacoEditorModule) {
  applyTypeScriptLanguageServiceDefaults(monaco)
  applyJsonLanguageServiceDefaults(monaco)
}

export function applyCodeEditorLanguageServiceDefaultsUnsafe(monaco: typeof import("monaco-editor")) {
  applyCodeEditorLanguageServiceDefaults(monaco as unknown as MonacoEditorModule)
}

export function applyTypeScriptLanguageServiceDefaults(monaco: MonacoEditorModule) {
  const typescript = monaco.languages.typescript
  if (!typescript) return false
  typescript.typescriptDefaults.setEagerModelSync(true)
  typescript.javascriptDefaults.setEagerModelSync(true)
  typescript.typescriptDefaults.setCompilerOptions(createTypeScriptCompilerOptions(monaco))
  typescript.javascriptDefaults.setCompilerOptions(createJavaScriptCompilerOptions(monaco))
  typescript.typescriptDefaults.setDiagnosticsOptions(createTypeScriptDiagnosticsOptions())
  typescript.javascriptDefaults.setDiagnosticsOptions(createJavaScriptDiagnosticsOptions())
  typescript.typescriptDefaults.setModeConfiguration(createTypeScriptModeConfiguration())
  typescript.javascriptDefaults.setModeConfiguration(createTypeScriptModeConfiguration())
  return true
}

export function applyJsonLanguageServiceDefaults(monaco: MonacoEditorModule) {
  const json = monaco.languages.json
  if (!json) return false
  json.jsonDefaults.setDiagnosticsOptions(createJsonDiagnosticsOptions())
  json.jsonDefaults.setModeConfiguration(createJsonModeConfiguration())
  return true
}

export function applyTypeScriptLanguageServiceDefaultsUnsafe(monaco: typeof import("monaco-editor")) {
  return applyTypeScriptLanguageServiceDefaults(monaco as unknown as MonacoEditorModule)
}

export function applyJsonLanguageServiceDefaultsUnsafe(monaco: typeof import("monaco-editor")) {
  return applyJsonLanguageServiceDefaults(monaco as unknown as MonacoEditorModule)
}

export function createTypeScriptCompilerOptions(monaco: MonacoEditorModule) {
  const typescript = requireTypeScriptLanguage(monaco)
  return {
    allowNonTsExtensions: true,
    allowJs: true,
    jsx: typescript.JsxEmit.ReactJSX,
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    resolveJsonModule: true,
    esModuleInterop: true,
    noEmit: true,
    strict: false,
  } satisfies TypeScriptCompilerOptions
}

export function createJavaScriptCompilerOptions(monaco: MonacoEditorModule) {
  return {
    ...createTypeScriptCompilerOptions(monaco),
    checkJs: false,
  } satisfies TypeScriptCompilerOptions
}

export function createTypeScriptDiagnosticsOptions() {
  return {
    // Monaco's browser worker cannot read a project's node_modules or path aliases.
    // Keep syntax diagnostics here and use the server LSP for project-aware semantics.
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
    onlyVisible: false,
  } satisfies TypeScriptDiagnosticsOptions
}

export function createJavaScriptDiagnosticsOptions() {
  return {
    ...createTypeScriptDiagnosticsOptions(),
  } satisfies TypeScriptDiagnosticsOptions
}

export function createTypeScriptModeConfiguration() {
  return {
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    definitions: true,
    references: true,
    documentHighlights: true,
    rename: true,
    diagnostics: true,
    signatureHelp: true,
    codeActions: true,
    inlayHints: true,
  } satisfies TypeScriptModeConfiguration
}

export function createJsonDiagnosticsOptions() {
  return {
    validate: true,
    allowComments: true,
    enableSchemaRequest: true,
    schemaValidation: "warning",
    schemaRequest: "warning",
    trailingCommas: "ignore",
    comments: "ignore",
    schemas: [
      {
        uri: "https://json.schemastore.org/package.json",
        fileMatch: ["package.json"],
      },
      {
        uri: "https://json.schemastore.org/tsconfig.json",
        fileMatch: ["tsconfig.json", "tsconfig.*.json", "jsconfig.json"],
      },
      {
        uri: "https://json.schemastore.org/prettierrc.json",
        fileMatch: [".prettierrc", ".prettierrc.json"],
      },
      {
        uri: "https://json.schemastore.org/eslintrc.json",
        fileMatch: [".eslintrc", ".eslintrc.json"],
      },
    ],
  } satisfies JsonDiagnosticsOptions
}

export function createJsonModeConfiguration() {
  return {
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    diagnostics: true,
    documentFormattingEdits: true,
    documentRangeFormattingEdits: true,
    tokens: true,
    colors: true,
    foldingRanges: true,
    selectionRanges: true,
  } satisfies JsonModeConfiguration
}

function requireTypeScriptLanguage(monaco: MonacoEditorModule) {
  const typescript = monaco.languages.typescript
  if (!typescript) throw new Error("TypeScript language service is not available")
  return typescript
}
