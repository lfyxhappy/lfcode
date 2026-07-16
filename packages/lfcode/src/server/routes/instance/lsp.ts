import path from "path"
import { pathToFileURL } from "url"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { AppFileSystem } from "@/filesystem"
import { LSP } from "@/lsp"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const LspLocationInput = z.object({
  line: z.number().int().min(0),
  character: z.number().int().min(0),
})

const LspRangeInput = z.object({
  start: LspLocationInput,
  end: LspLocationInput,
})

const LspFormattingOptionsInput = z.object({
  tabSize: z.number().int().positive(),
  insertSpaces: z.boolean(),
  trimTrailingWhitespace: z.boolean().optional(),
  insertFinalNewline: z.boolean().optional(),
  trimFinalNewlines: z.boolean().optional(),
})

const LspQueryResult = z.object({
  supported: z.boolean(),
  result: z.any().optional(),
})

const LspQueryInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("diagnostics"),
    path: z.string(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("documentSymbol"),
    path: z.string(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("hover"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("completion"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
    triggerCharacter: z.string().optional(),
    maxItems: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("signatureHelp"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
    triggerCharacter: z.string().optional(),
  }),
  z.object({
    kind: z.literal("prepareRename"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("rename"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
    newName: z.string(),
  }),
  z.object({
    kind: z.literal("formatting"),
    path: z.string(),
    text: z.string(),
    options: LspFormattingOptionsInput,
  }),
  z.object({
    kind: z.literal("rangeFormatting"),
    path: z.string(),
    text: z.string(),
    range: LspRangeInput,
    options: LspFormattingOptionsInput,
  }),
  z.object({
    kind: z.literal("codeAction"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
    range: LspRangeInput,
    diagnostics: z.array(z.any()).optional(),
    only: z.string().optional(),
  }),
  z.object({
    kind: z.literal("executeCommand"),
    path: z.string(),
    text: z.string(),
    command: z.string(),
    arguments: z.array(z.any()).optional(),
  }),
  z.object({
    kind: z.literal("declaration"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("definition"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("typeDefinition"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("references"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("implementation"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("documentHighlights"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("incomingCalls"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
  z.object({
    kind: z.literal("outgoingCalls"),
    path: z.string(),
    text: z.string(),
    position: LspLocationInput,
  }),
])

export const LspRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("LspRoutes.status", c, function* () {
          const lsp = yield* LSP.Service
          return yield* lsp.status()
        }),
    )
    .post(
      "/query",
      describeRoute({
        summary: "Query LSP for editor integrations",
        description:
          "Sync the current editor draft to the server-side LSP client and query diagnostics or symbol/navigation data.",
        operationId: "lsp.query",
        responses: {
          200: {
            description: "LSP query result",
            content: {
              "application/json": {
                schema: resolver(LspQueryResult),
              },
            },
          },
        },
      }),
      validator("json", LspQueryInput),
      async (c) =>
        jsonRequest("LspRoutes.query", c, function* () {
          const lsp = yield* LSP.Service
          const body = c.req.valid("json")
          const filePath = resolveLspQueryPath(body.path)
          const supported = yield* lsp.hasClients(filePath)
          if (!supported) return { supported: false } satisfies z.infer<typeof LspQueryResult>

          yield* lsp.syncFile({
            file: filePath,
            text: body.text,
            waitForDiagnostics: body.kind === "diagnostics",
          })

          if (body.kind === "diagnostics") {
            const diagnostics = yield* lsp.diagnostics()
            return {
              supported: true,
              result: diagnostics[filePath] ?? [],
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "documentSymbol") {
            return {
              supported: true,
              result: yield* lsp.documentSymbol(pathToUri(filePath)),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "hover") {
            return {
              supported: true,
              result: yield* lsp.hover({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "completion") {
            return {
              supported: true,
              result: yield* lsp.completion({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
                triggerCharacter: body.triggerCharacter,
                maxItems: body.maxItems,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "signatureHelp") {
            return {
              supported: true,
              result: yield* lsp.signatureHelp({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
                triggerCharacter: body.triggerCharacter,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "prepareRename") {
            return {
              supported: true,
              result: yield* lsp.prepareRename({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "rename") {
            return {
              supported: true,
              result: yield* lsp.rename({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
                newName: body.newName,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "formatting") {
            return {
              supported: true,
              result: yield* lsp.formatting({
                file: filePath,
                options: body.options,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "rangeFormatting") {
            return {
              supported: true,
              result: yield* lsp.rangeFormatting({
                file: filePath,
                startLine: body.range.start.line,
                startCharacter: body.range.start.character,
                endLine: body.range.end.line,
                endCharacter: body.range.end.character,
                options: body.options,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "codeAction") {
            return {
              supported: true,
              result: yield* lsp.codeAction({
                file: filePath,
                startLine: body.range.start.line,
                startCharacter: body.range.start.character,
                endLine: body.range.end.line,
                endCharacter: body.range.end.character,
                diagnostics: body.diagnostics,
                only: body.only,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "executeCommand") {
            return {
              supported: true,
              result: yield* lsp.executeCommand({
                file: filePath,
                command: body.command,
                arguments: body.arguments,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "declaration") {
            return {
              supported: true,
              result: yield* lsp.declaration({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "definition") {
            return {
              supported: true,
              result: yield* lsp.definition({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "typeDefinition") {
            return {
              supported: true,
              result: yield* lsp.typeDefinition({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "references") {
            return {
              supported: true,
              result: yield* lsp.references({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "documentHighlights") {
            return {
              supported: true,
              result: yield* lsp.documentHighlights({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "incomingCalls") {
            return {
              supported: true,
              result: yield* lsp.incomingCalls({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          if (body.kind === "outgoingCalls") {
            return {
              supported: true,
              result: yield* lsp.outgoingCalls({
                file: filePath,
                line: body.position.line,
                character: body.position.character,
              }),
            } satisfies z.infer<typeof LspQueryResult>
          }

          return {
            supported: true,
            result: yield* lsp.implementation({
              file: filePath,
              line: body.position.line,
              character: body.position.character,
            }),
          } satisfies z.infer<typeof LspQueryResult>
        }),
    ),
)

function resolveLspQueryPath(input: string) {
  const resolved = AppFileSystem.normalizePath(path.isAbsolute(input) ? input : path.join(Instance.directory, input))
  if (!Instance.containsPath(resolved, Instance.current)) {
    throw new Error("Access denied: path escapes project boundary")
  }
  return resolved
}

function pathToUri(filePath: string) {
  return pathToFileURL(filePath).href
}
