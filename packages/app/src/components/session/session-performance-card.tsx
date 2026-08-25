import type { Message, Part } from "@lfcode-ai/sdk/v2/client"
import { Icon } from "@lfcode-ai/ui/icon"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  estimateTextTokens,
  formatTokenCount,
  getSessionPerformanceMetrics,
  TPS_SAMPLE_RETENTION_MS,
  type TokenSample,
} from "./session-performance-metrics"

export function SessionPerformanceCard(props: {
  sessionID: string
  messages: Accessor<Message[]>
  parts: Accessor<Record<string, Part[]>>
}) {
  const sdk = useSDK()
  const language = useLanguage()
  const [usageTotalTokens, setUsageTotalTokens] = createSignal<number | undefined>()
  const [usageState, setUsageState] = createSignal<"loading" | "ready" | "error">("loading")
  const [now, setNow] = createSignal(Date.now())
  const [tokenSamplesByMessageID, setTokenSamplesByMessageID] = createSignal<Record<string, TokenSample[]>>({})
  let usageRequestID = 0

  const estimatedOutputTokensByMessageID = createMemo(() => {
    const output: Record<string, number> = {}
    for (const parts of Object.values(props.parts())) {
      for (const part of parts) {
        if (part.type !== "text" && part.type !== "reasoning") continue
        output[part.messageID] = (output[part.messageID] ?? 0) + estimateTextTokens(part.text)
      }
    }
    return output
  })

  const metrics = createMemo(() =>
    getSessionPerformanceMetrics({
      messages: props.messages(),
      tokenSamplesByMessageID: tokenSamplesByMessageID(),
      estimatedOutputTokensByMessageID: estimatedOutputTokensByMessageID(),
      now: now(),
      usageTotalTokens: usageTotalTokens(),
      usageReady: usageState() === "ready",
    }),
  )
  const formatTps = createMemo(() => new Intl.NumberFormat(language.intl(), { maximumFractionDigits: 1 }))
  const conversationDisplay = createMemo(() => {
    const value = metrics().conversationTokens
    if (value === null) return usageState() === "loading" ? "…" : "—"
    return formatTokenCount(value)
  })
  createEffect(() => {
    const sessionID = props.sessionID
    const controller = new AbortController()
    setUsageTotalTokens(undefined)
    setUsageState("loading")

    const refreshUsage = () => {
      const requestID = ++usageRequestID
      void sdk.client.usage
        .get({ range: "all", session: sessionID, limit: 1 }, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted || requestID !== usageRequestID) return
          const totalTokens = response.data?.summary.totalTokens
          if (typeof totalTokens !== "number") throw new Error("Usage response did not include summary.totalTokens")
          setUsageTotalTokens(totalTokens)
          setUsageState("ready")
        })
        .catch(() => {
          if (controller.signal.aborted || requestID !== usageRequestID) return
          setUsageState("error")
        })
    }

    refreshUsage()

    const timer = window.setInterval(() => {
      if (metrics().streaming) refreshUsage()
    }, 1000)

    onCleanup(() => {
      controller.abort()
      usageRequestID++
      window.clearInterval(timer)
    })
  })

  createEffect(() => {
    if (metrics().streaming) return
    if (metrics().currentTokens === 0) return
    const sessionID = props.sessionID
    const controller = new AbortController()
    const requestID = ++usageRequestID
    void sdk.client.usage
      .get({ range: "all", session: sessionID, limit: 1 }, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted || requestID !== usageRequestID) return
        const totalTokens = response.data?.summary.totalTokens
        if (typeof totalTokens !== "number") throw new Error("Usage response did not include summary.totalTokens")
        setUsageTotalTokens(totalTokens)
        setUsageState("ready")
      })
      .catch(() => {
        if (controller.signal.aborted || requestID !== usageRequestID) return
        setUsageState("error")
      })

    onCleanup(() => controller.abort())
  })

  createEffect(() => {
    if (!metrics().streaming) return
    setNow(Date.now())
    const timer = window.setInterval(() => {
      const timestamp = Date.now()
      setNow(timestamp)
      const message = props.messages().find((item) => item.id === currentMessageID(props.messages()))
      if (message?.role !== "assistant") return
      const realTokens = message.responseMetrics
        ? message.responseMetrics.tokens.output + message.responseMetrics.tokens.reasoning
        : 0
      const estimated = realTokens <= 0
      const estimatedTokens = estimatedOutputTokensByMessageID()[message.id] ?? 0
      const generatedTokens = estimated ? estimatedTokens : Math.max(realTokens, estimatedTokens)
      if (typeof generatedTokens !== "number" || !Number.isFinite(generatedTokens)) return
      setTokenSamplesByMessageID((previous) => {
        const samples = previous[message.id] ?? []
        const last = samples.at(-1)
        if (last && last.tokens === generatedTokens && last.estimated === estimated) return previous
        const base = last && last.estimated !== estimated ? [] : samples
        const next = [...base, { at: timestamp, tokens: generatedTokens, estimated }].filter(
          (sample) => timestamp - sample.at <= TPS_SAMPLE_RETENTION_MS,
        )
        return { ...previous, [message.id]: next }
      })
    }, 500)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <section
      data-component="session-performance-card"
      data-usage-state={usageState()}
      aria-label={language.t("session.performance.title")}
      class="shrink-0 overflow-hidden rounded-[24px] bg-surface-raised-base p-3 shadow-sm"
    >
      <header class="flex items-center gap-2 px-1 text-13-regular text-text-weak">
        <Icon name="chart-line" size="small" class="text-icon-weak-base" />
        <span>{language.t("session.performance.title")}</span>
        <Show when={metrics().streaming}>
          <span class="ml-auto flex size-2" aria-label={language.t("session.performance.streaming")}>
            <span class="size-2 animate-pulse rounded-full bg-icon-interactive-base" />
          </span>
        </Show>
      </header>
      <div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 px-1">
        <Metric label={language.t("session.performance.tps")} value={metrics().tps === null ? "—" : formatTps().format(metrics().tps!)} />
        <Metric label={language.t("session.performance.request")} value={formatTokenCount(metrics().currentTokens)} />
        <Metric
          label={language.t("session.performance.conversation")}
          value={conversationDisplay()}
          wide
        />
      </div>
    </section>
  )
}

function currentMessageID(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") return messages[index].id
  }
  return undefined
}

function Metric(props: { label: string; value: string; wide?: boolean }) {
  return (
    <div class={props.wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <div class="truncate text-11-regular text-text-weak">{props.label}</div>
      <div class="mt-0.5 truncate text-16-medium text-text-base" title={props.value}>
        {props.value}
      </div>
    </div>
  )
}
