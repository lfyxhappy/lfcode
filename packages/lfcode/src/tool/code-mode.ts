import z from "zod"
import type { Def } from "./tool"

export type Presentation = "native" | "code" | "both" | "auto"
export type ResolvedPresentation = "native" | "code" | "both"

export const AUTO_TOOL_COUNT_THRESHOLD = 24
export const AUTO_SCHEMA_BYTES_THRESHOLD = 16 * 1024

export function nativeToolsForPresentation<T extends Pick<Def, "id">>(
  _presentation: ResolvedPresentation,
  tools: T[],
): T[] {
  return tools
}

export function resolvePresentation(input: {
  configured?: Presentation
  tools: Pick<Def, "id" | "parameters">[]
}): ResolvedPresentation {
  if (input.configured === "native" || input.configured === "code" || input.configured === "both") return input.configured
  const schemaBytes = input.tools.reduce(
    (total, tool) => total + new TextEncoder().encode(JSON.stringify(z.toJSONSchema(tool.parameters))).byteLength,
    0,
  )
  if (input.tools.length > AUTO_TOOL_COUNT_THRESHOLD || schemaBytes > AUTO_SCHEMA_BYTES_THRESHOLD) return "code"
  return "native"
}

/**
 * Prompt assembly owns the transport. This deterministic declaration is deliberately
 * dependency-free so its SDK contract can be snapshot-tested separately from the worker.
 */
export function sdkDeclaration(tools: Pick<Def, "id">[]) {
  const members = tools
    .filter((tool) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tool.id))
    .map((tool) => `  ${tool.id}(args: Record<string, unknown>): Promise<unknown>`)
    .join("\n")
  return ["declare const tools: {", members, "}", "", "// Call tools through this SDK; do not use Node, Bun, filesystem, or network globals."].join("\n")
}
