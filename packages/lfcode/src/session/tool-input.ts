/**
 * Normalize provider tool arguments at the boundary between the stream,
 * execution, and model-history projections. Providers sometimes deliver an
 * object-shaped tool payload as a JSON string; parse that shape once without
 * guessing scalar or malformed input.
 */
export function parseToolInput(input: unknown): unknown {
  if (typeof input !== "string") return input
  const value = input.trim()
  if (!value.startsWith("{") || !value.endsWith("}")) return input
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : input
  } catch {
    return input
  }
}

/** OpenAI-compatible tool history requires an object argument encoded once. */
export function toolInputForModel(input: unknown): Record<string, unknown> {
  const parsed = parseToolInput(input)
  return isRecord(parsed) ? parsed : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
