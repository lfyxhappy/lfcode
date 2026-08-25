export interface ToolDiagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
}

export type ToolDiffChanges = {
  additions: number
  deletions: number
}

export type ToolFileDiff = ToolDiffChanges & {
  file?: string
  before?: string
  after?: string
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function readStringField(source: Record<string, unknown> | undefined, key: string) {
  return readString(source?.[key])
}

export function readActorToolOutput(value: unknown) {
  if (typeof value !== "string") return
  try {
    const output = record(JSON.parse(value))
    if (!output) return
    const status = readString(output.status)
    const actorID = readString(output.actor_id)
    const description = readString(output.description)
    const agent = readString(output.agent)
    const error = readString(output.error)
    if (!status && !actorID && !description && !agent && !error) return
    return { status, actorID, description, agent, error }
  } catch {
    return
  }
}

function diagnostic(value: unknown): value is ToolDiagnostic {
  const item = record(value)
  return !!item && typeof item.message === "string" && !!record(item.range)
}

export function readDiagnosticsByFile(value: unknown) {
  const entries = record(value)
  if (!entries) return

  const output = Object.entries(entries).reduce<Record<string, ToolDiagnostic[]>>((acc, [path, diagnostics]) => {
    if (!Array.isArray(diagnostics)) return acc
    const list = diagnostics.filter(diagnostic)
    if (list.length === 0) return acc
    acc[path] = list
    return acc
  }, {})

  if (Object.keys(output).length === 0) return
  return output
}

export function readDiffChanges(value: unknown) {
  const item = record(value)
  if (!item) return
  if (typeof item.additions !== "number" || typeof item.deletions !== "number") return
  return {
    additions: item.additions,
    deletions: item.deletions,
  } satisfies ToolDiffChanges
}

export function readFileDiff(value: unknown) {
  const diff = readDiffChanges(value)
  if (!diff) return
  const item = record(value)
  if (!item) return
  return {
    ...diff,
    file: readString(item.file),
    before: readString(item.before),
    after: readString(item.after),
  } satisfies ToolFileDiff
}
