import {
  uiDriverTokenValues,
  type UiDriverCatalogEntry,
  type UiDriverEditorInput,
  type UiDriverNodeSnapshot,
  type UiDriverOperation,
  type UiDriverQueryInput,
  type UiDriverReadTextInput,
  type UiDriverToken,
  type UiDriverTypeInput,
  type UiDriverWaitInput,
} from "./ui-driver"

export type UiAutomationProvider = {
  id: string
  tokens: readonly UiDriverToken[]
  query: (input: UiDriverQueryInput) => UiDriverNodeSnapshot
  click?: (input: UiDriverQueryInput) => Promise<UiDriverNodeSnapshot>
  type?: (input: UiDriverTypeInput) => Promise<UiDriverNodeSnapshot>
  readText?: (input: UiDriverReadTextInput) => string
  wait?: (input: UiDriverWaitInput) => Promise<UiDriverNodeSnapshot>
  editor?: (input: UiDriverEditorInput) => Promise<unknown>
}

const providers = new Map<string, UiAutomationProvider>()

export const UiAutomationRegistry = {
  register(provider: UiAutomationProvider) {
    providers.set(provider.id, provider)
    return () => {
      if (providers.get(provider.id) === provider) providers.delete(provider.id)
    }
  },
  query(input: UiDriverQueryInput) {
    return requireProvider(input.token).query(input)
  },
  async click(input: UiDriverQueryInput) {
    const provider = requireProvider(input.token)
    if (provider.click) return await provider.click(input)
    throw unavailableOperation(input.token, "click")
  },
  async type(input: UiDriverTypeInput) {
    const provider = requireProvider(input.token)
    if (provider.type) return await provider.type(input)
    throw unavailableOperation(input.token, "type")
  },
  readText(input: UiDriverReadTextInput) {
    const provider = requireProvider(input.token)
    if (provider.readText) return provider.readText(input)
    return provider.query(input).value ?? provider.query(input).text ?? ""
  },
  async wait(input: UiDriverWaitInput) {
    const provider = requireProvider(input.token)
    if (provider.wait) return await provider.wait(input)
    return provider.query(input)
  },
  async editor(input: UiDriverEditorInput) {
    const provider = requireProvider(input.token)
    if (provider.editor) return await provider.editor(input)
    throw unavailableOperation(input.token, "editor")
  },
  catalog(): UiDriverCatalogEntry[] {
    return uiDriverTokenValues.map((token) => {
      const provider = findProvider(token)
      return {
        token,
        available: !!provider,
        ...(provider ? { source: provider.id } : {}),
        operations: provider ? availableOperations(provider) : [],
      }
    })
  },
}

function findProvider(token: UiDriverToken) {
  return Array.from(providers.values())
    .reverse()
    .find((provider) => provider.tokens.includes(token))
}

function requireProvider(token: UiDriverToken) {
  const provider = findProvider(token)
  if (provider) return provider
  throw new Error(`UI token is not available on the current app surface: ${token}`)
}

function unavailableOperation(token: UiDriverToken, operation: UiDriverOperation) {
  return new Error(`UI token does not support ${operation}: ${token}`)
}

function availableOperations(provider: UiAutomationProvider): UiDriverOperation[] {
  return [
    "query",
    ...(provider.click ? (["click"] as const) : []),
    ...(provider.type ? (["type"] as const) : []),
    ...(provider.readText ? (["readText"] as const) : []),
    ...(provider.wait ? (["wait"] as const) : []),
    ...(provider.editor ? (["editor"] as const) : []),
  ]
}
