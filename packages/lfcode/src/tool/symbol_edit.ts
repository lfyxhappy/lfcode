import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect } from "effect"
import { AppFileSystem } from "@/filesystem"
import { LSP } from "../lsp"
import * as Tool from "./tool"
import { ApplyPatchTool } from "./apply_patch"
import DESCRIPTION from "./symbol_edit.txt"
import { assertWriteAllowed } from "./external-directory"
import { buildRangePatchText, type RangeEdit } from "./range-patch"
import { SessionCwd } from "./session-cwd"

const Parameters = z
  .object({
    filePath: z.string().describe("The absolute or relative path to the file that contains the symbol."),
    symbol: z.string().optional().describe("The leaf symbol name to edit, such as a function or method name."),
    symbolPath: z
      .string()
      .optional()
      .describe("A more specific symbol selector such as ClassName.method or Namespace::function."),
    mode: z
      .enum(["replace", "before", "after"])
      .optional()
      .describe("replace: rewrite the whole symbol range. before/after: insert text at the symbol boundary."),
    newText: z.string().describe("The new text to place at the selected symbol range or boundary."),
  })
  .refine((value) => value.symbol || value.symbolPath, {
    message: "Provide at least one of symbol or symbolPath.",
    path: ["symbol"],
  })

type SymbolLike = LSP.DocumentSymbol | LSP.Symbol

type ResolvedSymbol = {
  name: string
  detail?: string
  range: LSP.Range
  line: number
  selector: string
  alternatives: string[]
}

export const SymbolEditTool = Tool.define(
  "symbol_edit",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const lsp = yield* LSP.Service
    const patch = yield* ApplyPatchTool
    const applyPatch = yield* Tool.init(patch)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const search = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.resolve(SessionCwd.get(ctx.sessionID), params.filePath)
          const filePath = process.platform === "win32" ? AppFileSystem.normalizePath(search) : search
          yield* assertWriteAllowed(ctx, filePath)

          const stat = yield* fs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!stat || stat.type !== "File") throw new Error(`symbol_edit path must be a file: ${filePath}`)

          const available = yield* lsp.hasClients(filePath)
          if (!available) {
            throw new Error(
              'No LSP server available for this file type. Fall back to "replace_range" for an exact span edit or "apply_patch" for a broader patch.',
            )
          }

          yield* lsp.touchFile(filePath, true)

          const symbols = yield* lsp.documentSymbol(pathToFileURL(filePath).href)
          const resolved = resolveSymbol(symbols, params)
          const content = yield* fs.readFileString(filePath)
          const patchText = buildRangePatchText(filePath, content, selectEditRange(resolved.range, params.mode ?? "replace", params.newText))
          const result = yield* applyPatch.execute({ patchText }, ctx)

          return {
            ...result,
            title: `${params.mode ?? "replace"} ${resolved.selector}`,
            metadata: {
              ...result.metadata,
              symbol: {
                name: resolved.name,
                detail: resolved.detail,
                selector: resolved.selector,
                line: resolved.line,
                mode: params.mode ?? "replace",
              },
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function resolveSymbol(symbols: SymbolLike[], params: z.infer<typeof Parameters>) {
  const resolved = symbols.map(normalizeSymbol)
  if (resolved.length === 0) throw new Error("No document symbols were returned for this file.")

  if (params.symbolPath) {
    const byPath = resolved.filter((item) => item.alternatives.some((alt) => normalizeSelector(alt) === normalizeSelector(params.symbolPath!)))
    if (byPath.length === 1) return byPath[0]!
    if (byPath.length > 1) {
      throw new Error(`Multiple symbols matched symbolPath '${params.symbolPath}'. Candidates:\n${renderCandidates(byPath)}`)
    }
  }

  if (!params.symbol) {
    throw new Error(`Could not find symbolPath '${params.symbolPath}'. Available symbols:\n${renderCandidates(resolved)}`)
  }

  const byName = resolved.filter((item) => item.name === params.symbol)
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    throw new Error(`Multiple symbols matched symbol '${params.symbol}'. Provide symbolPath to disambiguate.\n${renderCandidates(byName)}`)
  }

  throw new Error(`Could not find symbol '${params.symbol}'. Available symbols:\n${renderCandidates(resolved)}`)
}

function normalizeSymbol(symbol: SymbolLike): ResolvedSymbol {
  const range = "range" in symbol ? symbol.range : symbol.location.range
  const detail = "detail" in symbol ? symbol.detail : undefined
  const alternatives = [symbol.name]
  if (detail) {
    alternatives.push(detail, `${detail}.${symbol.name}`, `${detail}::${symbol.name}`)
  }

  return {
    name: symbol.name,
    detail,
    range,
    line: range.start.line + 1,
    selector: detail ? `${detail}.${symbol.name}` : symbol.name,
    alternatives: [...new Set(alternatives)],
  }
}

function selectEditRange(range: LSP.Range, mode: "replace" | "before" | "after", newText: string): RangeEdit {
  if (mode === "replace") {
    return {
      startLine: range.start.line + 1,
      startChar: range.start.character + 1,
      endLine: range.end.line + 1,
      endChar: range.end.character + 1,
      newText,
    }
  }

  if (mode === "before") {
    return {
      startLine: range.start.line + 1,
      startChar: range.start.character + 1,
      endLine: range.start.line + 1,
      endChar: range.start.character + 1,
      newText,
    }
  }

  return {
    startLine: range.end.line + 1,
    startChar: range.end.character + 1,
    endLine: range.end.line + 1,
    endChar: range.end.character + 1,
    newText,
  }
}

function normalizeSelector(value: string) {
  return value.replaceAll(/\s+/g, "").toLowerCase()
}

function renderCandidates(items: ResolvedSymbol[]) {
  return items
    .slice(0, 20)
    .map((item) => `- ${item.selector} @ line ${item.line}`)
    .join("\n")
}
