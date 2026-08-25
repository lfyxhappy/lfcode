import type { AssistantMessage } from "@lfcode-ai/sdk/v2/client"

type Labels = {
  ended: string
  first: string
  total: string
  input: string
  output: string
  tokens: string
  in: string
  out: string
  hit: string
  write: string
  tps: string
}

function tokenCount(message: AssistantMessage) {
  const tokens = message.responseMetrics?.tokens
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function formatSeconds(value: number, locale: string) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}s`
}

export function formatResponseTokenCount(value: number, locale: string) {
  const absolute = Math.abs(value)
  const precise = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (absolute < 1_000) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
  if (absolute < 1_000_000) return `${precise.format(value / 1_000)}K`
  if (absolute < 1_000_000_000) return `${precise.format(value / 1_000_000)}M`
  return `${precise.format(value / 1_000_000_000)}B`
}

export function getTurnResponseMetricsLine(input: {
  locale: string
  labels: Labels
  messages: AssistantMessage[]
  startedAt: number | undefined
}) {
  if (typeof input.startedAt !== "number") return
  if (!input.messages.length) return
  if (input.messages.some((message) => message.error)) return
  if (input.messages.some((message) => typeof message.time.completed !== "number")) return

  const finishedAt = input.messages.reduce<number | undefined>((latest, message) => {
    const completed = message.time.completed
    if (typeof completed !== "number") return latest
    if (latest === undefined) return completed
    return Math.max(latest, completed)
  }, undefined)
  if (typeof finishedAt !== "number" || finishedAt < input.startedAt) return

  const firstTokenAt = input.messages.reduce<number | undefined>((earliest, message) => {
    const current = message.responseMetrics?.firstTokenAt
    if (typeof current !== "number") return earliest
    if (earliest === undefined) return current
    return Math.min(earliest, current)
  }, undefined)
  if (typeof firstTokenAt !== "number") return

  const totals = input.messages.reduce(
    (acc, message) => {
      const tokens = message.responseMetrics?.tokens
      if (!tokens) return acc
      acc.input += tokens.input
      acc.output += tokens.output + tokens.reasoning
      acc.hit += tokens.cache.read
      acc.write += tokens.cache.write
      return acc
    },
    { input: 0, output: 0, hit: 0, write: 0 },
  )
  const totalTokens = totals.input + totals.output + totals.hit + totals.write
  if (totalTokens <= 0) return
  if (!input.messages.some((message) => tokenCount(message) > 0)) return

  const totalSeconds = (finishedAt - input.startedAt) / 1000
  if (!(totalSeconds > 0)) return
  const firstSeconds = Math.max(0, (firstTokenAt - input.startedAt) / 1000)
  const outputSeconds = (finishedAt - firstTokenAt) / 1000
  const formatTps = new Intl.NumberFormat(input.locale, { maximumFractionDigits: 1 })
  const time = new Intl.DateTimeFormat(input.locale, { timeStyle: "medium" }).format(finishedAt)

  const line = [
    `${input.labels.ended} ${time}`,
    `${input.labels.first} ${formatSeconds(firstSeconds, input.locale)} / ${input.labels.total} ${formatSeconds(totalSeconds, input.locale)}`,
    `${input.labels.tokens} ${formatResponseTokenCount(totalTokens, input.locale)} (${input.labels.in} ${formatResponseTokenCount(totals.input, input.locale)} / ${input.labels.out} ${formatResponseTokenCount(totals.output, input.locale)} / ${input.labels.hit} ${formatResponseTokenCount(totals.hit, input.locale)} / ${input.labels.write} ${formatResponseTokenCount(totals.write, input.locale)})`,
  ]

  if (outputSeconds > 0) {
    line.splice(2, 0, `${input.labels.output} ${formatTps.format(totals.output / outputSeconds)} ${input.labels.tps}`)
  }

  return line.join(" · ")
}
