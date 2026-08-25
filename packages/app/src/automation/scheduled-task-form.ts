import type { AutomationModel } from "@lfcode-ai/sdk/v2/client"

type DateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function buildModel(providerID: string, modelID: string): AutomationModel | false | undefined {
  const provider = providerID.trim()
  const model = modelID.trim()
  if (!provider && !model) return
  if (!provider || !model) return false
  return { providerID: provider, modelID: model }
}

export function modelPatchValue(model: AutomationModel | false | undefined) {
  return model === false ? null : model ?? null
}

export function defaultTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

export function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function localDateTimeInput(time: number, timezone = defaultTimeZone()) {
  const parts = dateTimeParts(time, timezone)
  if (!parts) return ""
  return `${parts.year}-${padTime(parts.month)}-${padTime(parts.day)}T${padTime(parts.hour)}:${padTime(parts.minute)}`
}

export function zonedDateTimeToTimestamp(value: string, timezone: string) {
  const input = parseDateTimeInput(value)
  if (!input) return
  if (!isValidTimeZone(timezone)) return

  const wallTime = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second)
  const initialOffset = timeZoneOffset(wallTime, timezone)
  if (initialOffset === undefined) return
  const firstCandidate = wallTime - initialOffset
  const correctedOffset = timeZoneOffset(firstCandidate, timezone)
  const candidate = correctedOffset === undefined ? firstCandidate : wallTime - correctedOffset
  const resolved = dateTimeParts(candidate, timezone)
  if (!resolved || !sameDateTime(resolved, input)) return
  return candidate
}

function parseDateTimeInput(value: string): DateTimeParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number)
  const second = Number(match[6] ?? "0")
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) return
  return { year, month, day, hour, minute, second }
}

function dateTimeParts(time: number, timezone: string): DateTimeParts | undefined {
  try {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        calendar: "gregory",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(time))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    )
    const parts = {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    }
    if (Object.values(parts).some((part) => !Number.isFinite(part))) return
    return parts
  } catch {
    return
  }
}

function timeZoneOffset(time: number, timezone: string) {
  const parts = dateTimeParts(time, timezone)
  if (!parts) return
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - time
}

function sameDateTime(left: DateTimeParts, right: DateTimeParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  )
}

function padTime(value: number) {
  return String(value).padStart(2, "0")
}
