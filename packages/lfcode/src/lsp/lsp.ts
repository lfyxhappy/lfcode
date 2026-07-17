import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util"
import * as LSPClient from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import * as LSPServer from "./server"
import z from "zod"
import { Config } from "../config"
import { Flag } from "@/flag/flag"
import { Process } from "../util"
import { spawn as lspspawn } from "./launch"
import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect"
import { AppFileSystem } from "@/filesystem"

const log = Log.create({ service: "lsp" })

export const Event = {
  Updated: BusEvent.define("lsp.updated", z.object({})),
}

export const Range = z
  .object({
    start: z.object({
      line: z.number(),
      character: z.number(),
    }),
    end: z.object({
      line: z.number(),
      character: z.number(),
    }),
  })
  .meta({
    ref: "Range",
  })
export type Range = z.infer<typeof Range>

export const Symbol = z
  .object({
    name: z.string(),
    kind: z.number(),
    location: z.object({
      uri: z.string(),
      range: Range,
    }),
  })
  .meta({
    ref: "Symbol",
  })
export type Symbol = z.infer<typeof Symbol>

export const DocumentSymbol = z
  .object({
    name: z.string(),
    detail: z.string().optional(),
    kind: z.number(),
    range: Range,
    selectionRange: Range,
  })
  .meta({
    ref: "DocumentSymbol",
  })
export type DocumentSymbol = z.infer<typeof DocumentSymbol>

export const Status = z
  .object({
    id: z.string(),
    name: z.string(),
    root: z.string().optional(),
    extensions: z.array(z.string()),
    capabilities: z.object({
      completion: z.boolean(),
      completionTriggerCharacters: z.array(z.string()),
      hover: z.boolean(),
      diagnostics: z.boolean(),
      definition: z.boolean(),
      formatting: z.boolean(),
    }),
    status: z.union([z.literal("available"), z.literal("connected"), z.literal("error")]),
    error: z.string().optional(),
  })
  .meta({
    ref: "LSPStatus",
  })
export type Status = z.infer<typeof Status>

const defaultCapabilities = {
  completion: true,
  completionTriggerCharacters: [],
  hover: true,
  diagnostics: true,
  definition: true,
  formatting: true,
}

enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

const kinds = [
  SymbolKind.Class,
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Interface,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
  SymbolKind.Enum,
]

const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
  if (Flag.LFCODE_EXPERIMENTAL_LSP_TY) {
    if (servers["pyright"]) {
      log.info("LSP server pyright is disabled because LFCODE_EXPERIMENTAL_LSP_TY is enabled")
      delete servers["pyright"]
    }
  } else {
    if (servers["ty"]) {
      delete servers["ty"]
    }
  }
}

type LocInput = { file: string; line: number; character: number }
type CompletionInput = LocInput & { triggerCharacter?: string; maxItems?: number }
type CompletionResolveInput = { file: string; item: unknown }
type SignatureHelpInput = LocInput & { triggerCharacter?: string }
type RenameInput = LocInput & { newName: string }
type FormattingOptions = {
  tabSize: number
  insertSpaces: boolean
  trimTrailingWhitespace?: boolean
  insertFinalNewline?: boolean
  trimFinalNewlines?: boolean
}
type RangeInput = {
  file: string
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}
type RangeFormattingInput = RangeInput & {
  options: FormattingOptions
}
type FormattingInput = {
  file: string
  options: FormattingOptions
}
type CodeActionInput = RangeInput & {
  diagnostics?: unknown[]
  only?: string
}
type ExecuteCommandInput = {
  file: string
  command: string
  arguments?: unknown[]
}
type SyncInput = { file: string; text: string; waitForDiagnostics?: boolean }

interface State {
  clients: LSPClient.Info[]
  servers: Record<string, LSPServer.Info>
  broken: Set<string>
  spawning: Map<string, Promise<LSPClient.Info | undefined>>
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (input: string, waitForDiagnostics?: boolean) => Effect.Effect<void>
  readonly syncFile: (input: SyncInput) => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, LSPClient.Diagnostic[]>>
  readonly hover: (input: LocInput) => Effect.Effect<any>
  readonly completion: (input: CompletionInput) => Effect.Effect<any>
  readonly completionResolve?: (input: CompletionResolveInput) => Effect.Effect<any>
  readonly signatureHelp: (input: SignatureHelpInput) => Effect.Effect<any>
  readonly prepareRename: (input: LocInput) => Effect.Effect<any>
  readonly rename: (input: RenameInput) => Effect.Effect<any>
  readonly formatting: (input: FormattingInput) => Effect.Effect<any[]>
  readonly rangeFormatting: (input: RangeFormattingInput) => Effect.Effect<any[]>
  readonly codeAction: (input: CodeActionInput) => Effect.Effect<any[]>
  readonly executeCommand: (input: ExecuteCommandInput) => Effect.Effect<any>
  readonly declaration: (input: LocInput) => Effect.Effect<any[]>
  readonly definition: (input: LocInput) => Effect.Effect<any[]>
  readonly typeDefinition: (input: LocInput) => Effect.Effect<any[]>
  readonly references: (input: LocInput) => Effect.Effect<any[]>
  readonly implementation: (input: LocInput) => Effect.Effect<any[]>
  readonly documentHighlights: (input: LocInput) => Effect.Effect<any[]>
  readonly documentSymbol: (uri: string) => Effect.Effect<(DocumentSymbol | Symbol)[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<Symbol[]>
  readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<any[]>
  readonly incomingCalls: (input: LocInput) => Effect.Effect<any[]>
  readonly outgoingCalls: (input: LocInput) => Effect.Effect<any[]>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/LSP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("LSP.state")(function* (ctx) {
        const cfg = yield* config.get()

        const servers: Record<string, LSPServer.Info> = {}

        if (!cfg.lsp) {
          log.info("all LSPs are disabled")
        } else {
          for (const server of Object.values(LSPServer)) {
            servers[server.id] = server
          }

          filterExperimentalServers(servers)

          if (cfg.lsp !== true) {
            for (const [name, item] of Object.entries(cfg.lsp)) {
              const existing = servers[name]
              if (item.disabled) {
                log.info(`LSP server ${name} is disabled`)
                delete servers[name]
                continue
              }
              servers[name] = {
                ...existing,
                id: name,
                root: existing?.root ?? (async (_file, ctx) => ctx.directory),
                extensions: item.extensions ?? existing?.extensions ?? [],
                spawn: async (root) => ({
                  process: lspspawn(item.command[0], item.command.slice(1), {
                    cwd: root,
                    env: { ...process.env, ...item.env },
                  }),
                  initialization: item.initialization,
                }),
              }
            }
          }

          log.info("enabled LSP servers", {
            serverIds: Object.values(servers)
              .map((server) => server.id)
              .join(", "),
          })
        }

        const s: State = {
          clients: [],
          servers,
          broken: new Set(),
          spawning: new Map(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await Promise.all(s.clients.map((client) => client.shutdown()))
          }),
        )

        return s
      }),
    )

    const getClients = Effect.fnUntraced(function* (file: string) {
      const ctx = yield* InstanceState.context
      if (
        !AppFileSystem.contains(ctx.directory, file) &&
        (ctx.worktree === "/" || !AppFileSystem.contains(ctx.worktree, file))
      ) {
        return [] as LSPClient.Info[]
      }
      const s = yield* InstanceState.get(state)
      return yield* Effect.promise(async () => {
        const extension = path.parse(file).ext || file
        const result: LSPClient.Info[] = []

        async function schedule(server: LSPServer.Info, root: string, key: string) {
          const handle = await server
            .spawn(root, ctx)
            .then((value) => {
              if (!value) s.broken.add(key)
              return value
            })
            .catch((err) => {
              s.broken.add(key)
              log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
              return undefined
            })

          if (!handle) return undefined
          log.info("spawned lsp server", { serverID: server.id, root })

          const client = await LSPClient.create({
            serverID: server.id,
            server: handle,
            root,
            directory: ctx.directory,
          }).catch(async (err) => {
            s.broken.add(key)
            await Process.stop(handle.process)
            log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
            return undefined
          })

          if (!client) return undefined

          const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
          if (existing) {
            await Process.stop(handle.process)
            return existing
          }

          s.clients.push(client)
          return client
        }

        for (const server of Object.values(s.servers)) {
          if (server.extensions.length && !server.extensions.includes(extension)) continue

          const root = await server.root(file, ctx)
          if (!root) continue
          if (s.broken.has(root + server.id)) continue

          const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
          if (match) {
            result.push(match)
            continue
          }

          const inflight = s.spawning.get(root + server.id)
          if (inflight) {
            const client = await inflight
            if (!client) continue
            result.push(client)
            continue
          }

          const task = schedule(server, root, root + server.id)
          s.spawning.set(root + server.id, task)

          task.finally(() => {
            if (s.spawning.get(root + server.id) === task) {
              s.spawning.delete(root + server.id)
            }
          })

          const client = await task
          if (!client) continue

          result.push(client)
          Bus.publish(Event.Updated, {})
        }

        return result
      })
    })

    const run = Effect.fnUntraced(function* <T>(file: string, fn: (client: LSPClient.Info) => Promise<T>) {
      const clients = yield* getClients(file)
      return yield* Effect.promise(() => Promise.all(clients.map((x) => fn(x))))
    })

    const runAll = Effect.fnUntraced(function* <T>(fn: (client: LSPClient.Info) => Promise<T>) {
      const s = yield* InstanceState.get(state)
      return yield* Effect.promise(() => Promise.all(s.clients.map((x) => fn(x))))
    })

    const init = Effect.fn("LSP.init")(function* () {
      yield* InstanceState.get(state)
    })

    const status = Effect.fn("LSP.status")(function* () {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      const result: Status[] = []
      for (const server of Object.values(s.servers).toSorted((a, b) => a.id.localeCompare(b.id))) {
        const clients = s.clients.filter((client) => client.serverID === server.id)
        if (clients.length === 0) {
          const failed = Array.from(s.broken).some((key) => key.endsWith(server.id))
          result.push({
            id: server.id,
            name: server.id,
            extensions: server.extensions,
            capabilities: defaultCapabilities,
            status: failed ? "error" : "available",
            ...(failed ? { error: "Failed to start language server" } : {}),
          })
          continue
        }
        for (const client of clients) {
          result.push({
            id: client.serverID,
            name: server.id,
            root: path.relative(ctx.directory, client.root),
            extensions: server.extensions,
            capabilities: client.capabilities,
            status: "connected",
          })
        }
      }
      return result
    })

    const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
      return (yield* getClients(file)).length > 0
    })

    const touchFile = Effect.fn("LSP.touchFile")(function* (input: string, waitForDiagnostics?: boolean) {
      log.info("touching file", { file: input })
      const clients = yield* getClients(input)
      yield* Effect.promise(() =>
        Promise.all(
          clients.map(async (client) => {
            const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
            await client.notify.open({ path: input })
            return wait
          }),
        ).catch((err) => {
          log.error("failed to touch file", { err, file: input })
        }),
      )
    })

    const syncFile = Effect.fn("LSP.syncFile")(function* (input: SyncInput) {
      log.info("syncing file", { file: input.file, textLength: input.text.length })
      const clients = yield* getClients(input.file)
      yield* Effect.promise(() =>
        Promise.all(
          clients.map(async (client) => {
            const wait = input.waitForDiagnostics ? client.waitForDiagnostics({ path: input.file }) : Promise.resolve()
            await client.notify.open({ path: input.file, text: input.text })
            return wait
          }),
        ).catch((err) => {
          log.error("failed to sync file", { err, file: input.file })
        }),
      )
    })

    const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
      const results: Record<string, LSPClient.Diagnostic[]> = {}
      const all = yield* runAll(async (client) => client.diagnostics)
      for (const result of all) {
        for (const [p, diags] of result.entries()) {
          const arr = results[p] || []
          arr.push(...diags)
          results[p] = arr
        }
      }
      return results
    })

    const hover = Effect.fn("LSP.hover")(function* (input: LocInput) {
      return yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/hover", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
    })

    const completion = Effect.fn("LSP.completion")(function* (input: CompletionInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/completion", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: input.triggerCharacter
              ? {
                  triggerKind: 2,
                  triggerCharacter: input.triggerCharacter,
                }
              : {
                  triggerKind: 1,
                },
          })
          .catch(() => null),
      )
      const result = results.find(Boolean)
      if (!result) return null
      if (Array.isArray(result)) return input.maxItems ? result.slice(0, input.maxItems) : result
      if (typeof result === "object" && result && "items" in result && Array.isArray(result.items)) {
        return {
          ...result,
          items: input.maxItems ? result.items.slice(0, input.maxItems) : result.items,
        }
      }
      return result
    })

    const completionResolve = Effect.fn("LSP.completionResolve")(function* (input: CompletionResolveInput) {
      const results = yield* run(input.file, (client) =>
        client.connection.sendRequest("completionItem/resolve", input.item).catch(() => null),
      )
      return results.find(Boolean) ?? null
    })

    const signatureHelp = Effect.fn("LSP.signatureHelp")(function* (input: SignatureHelpInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/signatureHelp", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: input.triggerCharacter
              ? {
                  triggerKind: 2,
                  triggerCharacter: input.triggerCharacter,
                  isRetrigger: true,
                }
              : {
                  triggerKind: 1,
                  isRetrigger: false,
                },
          })
          .catch(() => null),
      )
      return results.find(Boolean) ?? null
    })

    const prepareRename = Effect.fn("LSP.prepareRename")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/prepareRename", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.find(Boolean) ?? null
    })

    const rename = Effect.fn("LSP.rename")(function* (input: RenameInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/rename", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            newName: input.newName,
          })
          .catch(() => null),
      )
      return results.find(Boolean) ?? null
    })

    const formatting = Effect.fn("LSP.formatting")(function* (input: FormattingInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/formatting", {
            textDocument: { uri: pathToFileURL(input.file).href },
            options: input.options,
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const rangeFormatting = Effect.fn("LSP.rangeFormatting")(function* (input: RangeFormattingInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/rangeFormatting", {
            textDocument: { uri: pathToFileURL(input.file).href },
            range: {
              start: {
                line: input.startLine,
                character: input.startCharacter,
              },
              end: {
                line: input.endLine,
                character: input.endCharacter,
              },
            },
            options: input.options,
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const codeAction = Effect.fn("LSP.codeAction")(function* (input: CodeActionInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/codeAction", {
            textDocument: { uri: pathToFileURL(input.file).href },
            range: {
              start: {
                line: input.startLine,
                character: input.startCharacter,
              },
              end: {
                line: input.endLine,
                character: input.endCharacter,
              },
            },
            context: {
              diagnostics: normalizeCodeActionDiagnostics(input.diagnostics),
              only: input.only ? [input.only] : undefined,
            },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const executeCommand = Effect.fn("LSP.executeCommand")(function* (input: ExecuteCommandInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("workspace/executeCommand", {
            command: input.command,
            arguments: input.arguments,
          })
          .catch(() => null),
      )
      return results.find(Boolean) ?? null
    })

    const declaration = Effect.fn("LSP.declaration")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/declaration", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const definition = Effect.fn("LSP.definition")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/definition", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const typeDefinition = Effect.fn("LSP.typeDefinition")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/typeDefinition", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const references = Effect.fn("LSP.references")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/references", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: { includeDeclaration: true },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const documentHighlights = Effect.fn("LSP.documentHighlights")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/documentHighlight", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const implementation = Effect.fn("LSP.implementation")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/implementation", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
      const file = fileURLToPath(uri)
      const results = yield* run(file, (client) =>
        client.connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }).catch(() => []),
      )
      return (results.flat() as (DocumentSymbol | Symbol)[]).filter(Boolean)
    })

    const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
      const results = yield* runAll((client) =>
        client.connection
          .sendRequest<Symbol[]>("workspace/symbol", { query })
          .then((result) => result.filter((x) => kinds.includes(x.kind)).slice(0, 10))
          .catch(() => [] as Symbol[]),
      )
      return results.flat()
    })

    const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const callHierarchyRequest = Effect.fnUntraced(function* (
      input: LocInput,
      direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
    ) {
      const results = yield* run(input.file, async (client) => {
        const items = await client.connection
          .sendRequest<unknown[] | null>("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => [] as unknown[])
        if (!items?.length) return []
        return client.connection.sendRequest(direction, { item: items[0] }).catch(() => [])
      })
      return results.flat().filter(Boolean)
    })

    const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
    })

    const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls")
    })

    return Service.of({
      init,
      status,
      hasClients,
      touchFile,
      syncFile,
      diagnostics,
      hover,
      completion,
      completionResolve,
      signatureHelp,
      prepareRename,
      rename,
      formatting,
      rangeFormatting,
      codeAction,
      executeCommand,
      declaration,
      definition,
      typeDefinition,
      references,
      implementation,
      documentHighlights,
      documentSymbol,
      workspaceSymbol,
      prepareCallHierarchy,
      incomingCalls,
      outgoingCalls,
    })
  }),
)

function normalizeCodeActionDiagnostics(input: unknown[] | undefined) {
  if (!input) return []
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const diagnostic = item as {
      message?: unknown
      severity?: unknown
      source?: unknown
      code?: unknown
      startLineNumber?: unknown
      startColumn?: unknown
      endLineNumber?: unknown
      endColumn?: unknown
    }
    if (typeof diagnostic.message !== "string") return []
    if (typeof diagnostic.startLineNumber !== "number") return []
    if (typeof diagnostic.startColumn !== "number") return []
    if (typeof diagnostic.endLineNumber !== "number") return []
    if (typeof diagnostic.endColumn !== "number") return []
    return [
      {
        message: diagnostic.message,
        severity: normalizeCodeActionDiagnosticSeverity(diagnostic.severity),
        source: typeof diagnostic.source === "string" ? diagnostic.source : undefined,
        code: typeof diagnostic.code === "string" || typeof diagnostic.code === "number" ? diagnostic.code : undefined,
        range: {
          start: {
            line: diagnostic.startLineNumber - 1,
            character: diagnostic.startColumn - 1,
          },
          end: {
            line: diagnostic.endLineNumber - 1,
            character: diagnostic.endColumn - 1,
          },
        },
      },
    ]
  })
}

function normalizeCodeActionDiagnosticSeverity(severity: unknown) {
  if (severity === 8 || severity === "Error") return 1
  if (severity === 4 || severity === "Warning") return 2
  if (severity === 2 || severity === "Info") return 3
  return 4
}

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as Diagnostic from "./diagnostic"

