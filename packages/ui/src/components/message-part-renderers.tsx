import type { AssistantMessage, ReasoningPart, TextPart, ToolPart } from "@lfcode-ai/sdk/v2"
import { createMemo, createSignal, For, Show, Match, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { TextShimmer } from "./text-shimmer"
import { ToolErrorCard } from "./tool-error-card"
import { GenericTool } from "./basic-tool"
import { Markdown } from "./markdown"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { registerPartComponent, ToolRegistry } from "./message-part-registry"
import { splitRenderableCodeBlocks } from "./message-code-blocks"
import { MessageDivider, PacedMarkdown } from "./message-part"
import { useData } from "../context"
import { useI18n } from "../context/i18n"

export function registerMessagePartRenderers() {
  registerPartComponent("tool", function ToolPartDisplay(props) {
    const data = useData()
    const i18n = useI18n()
    const part = () => props.part as ToolPart
    if (part().tool === "todowrite") return null

    const hideQuestion = createMemo(
      () => part().tool === "question" && (part().state.status === "pending" || part().state.status === "running"),
    )

    const emptyInput: Record<string, any> = {}
    const emptyMetadata: Record<string, any> = {}

    const input = () => part().state?.input ?? emptyInput
    // @ts-expect-error
    const partMetadata = () => part().state?.metadata ?? emptyMetadata

    const render = createMemo(() => ToolRegistry.render(part().tool) ?? GenericTool)

    return (
      <Show when={!hideQuestion()}>
        <div data-component="tool-part-wrapper">
          <Switch>
            <Match when={part().state.status === "error" && (part().state as any).error}>
              {(error) => {
                const cleaned = error().replace("Error: ", "")
                if (part().tool === "question" && cleaned.includes("dismissed this question")) {
                  return (
                    <div style="width: 100%; display: flex; justify-content: flex-end;">
                      <span class="text-13-regular text-text-weak cursor-default">
                        {i18n.t("ui.messagePart.questions.dismissed")}
                      </span>
                    </div>
                  )
                }
                return <ToolErrorCard tool={part().tool} error={error()} defaultOpen={props.defaultOpen} />
              }}
            </Match>
            <Match when={true}>
              <Dynamic
                component={render()}
                input={input()}
                tool={part().tool}
                metadata={partMetadata()}
                // @ts-expect-error
                output={part().state.output}
                status={part().state.status}
                hideDetails={props.hideDetails}
                defaultOpen={props.defaultOpen}
              />
            </Match>
          </Switch>
        </div>
      </Show>
    )
  })

  registerPartComponent("compaction", function CompactionPartDisplay() {
    const i18n = useI18n()
    return <MessageDivider label={i18n.t("ui.messagePart.compaction")} />
  })

  registerPartComponent("text", function TextPartDisplay(props) {
    const data = useData()
    const i18n = useI18n()
    const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))
    const part = () => props.part as TextPart
    const interrupted = createMemo(
      () =>
        props.message.role === "assistant" && (props.message as AssistantMessage).error?.name === "MessageAbortedError",
    )

    const model = createMemo(() => {
      if (props.message.role !== "assistant") return ""
      const message = props.message as AssistantMessage
      const match = data.store.provider?.all?.find((p) => p.id === message.providerID)
      return match?.models?.[message.modelID]?.name ?? message.modelID
    })

    const duration = createMemo(() => {
      if (props.message.role !== "assistant") return ""
      const message = props.message as AssistantMessage
      const completed = message.time.completed
      const ms =
        typeof props.turnDurationMs === "number"
          ? props.turnDurationMs
          : typeof completed === "number"
            ? completed - message.time.created
            : -1
      if (!(ms >= 0)) return ""
      const total = Math.round(ms / 1000)
      if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt().format(total) })
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return i18n.t("ui.message.duration.minutesSeconds", {
        minutes: numfmt().format(minutes),
        seconds: numfmt().format(seconds),
      })
    })

    const meta = createMemo(() => {
      if (props.message.role !== "assistant") return ""
      const agent = (props.message as AssistantMessage).agent
      const items = [
        agent ? agent[0]?.toUpperCase() + agent.slice(1) : "",
        model(),
        duration(),
        interrupted() ? i18n.t("ui.message.interrupted") : "",
      ]
      return items.filter((x) => !!x).join(" \u00B7 ")
    })

    const streaming = createMemo(
      () => props.message.role === "assistant" && typeof (props.message as AssistantMessage).time.completed !== "number",
    )
    const text = () => (part().text ?? "").trim()
    const isLastTextPart = createMemo(() => {
      const last = (data.store.part?.[props.message.id] ?? [])
        .filter((item): item is TextPart => item?.type === "text" && !!item.text?.trim())
        .at(-1)
      return last?.id === part().id
    })
    const showCopy = createMemo(() => {
      if (props.message.role !== "assistant") return isLastTextPart()
      if (props.showAssistantCopyPartID === null) return false
      if (typeof props.showAssistantCopyPartID === "string") return props.showAssistantCopyPartID === part().id
      return isLastTextPart()
    })
    const [copied, setCopied] = createSignal(false)
    const segments = createMemo(() => splitRenderableCodeBlocks(text()))
    const hasCustomCodeBlocks = createMemo(
      () => !!props.renderCodeBlock && segments().some((segment) => segment.type === "code"),
    )
    const responseMetrics = createMemo(() => {
      if (props.message.role !== "assistant") return ""
      if (streaming()) return ""
      if (interrupted()) return ""
      return isLastTextPart() ? props.responseMetricsLine ?? "" : ""
    })

    const handleCopy = async () => {
      const content = text()
      if (!content) return
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    const htmlComponentModel = () => {
      if (props.message.role === "assistant") {
        const message = props.message as AssistantMessage
        return {
          providerID: message.providerID,
          modelID: message.modelID,
          variant: undefined,
        }
      }
      return props.message.model
    }

    const htmlComponentContext = () => ({
      sessionID: props.message.sessionID,
      messageID: props.message.id,
      partID: part().id,
      role: props.message.role,
      agent: props.message.agent,
      modelProviderID: htmlComponentModel()?.providerID,
      modelID: htmlComponentModel()?.modelID,
      variant: htmlComponentModel()?.variant,
    })

    return (
      <Show when={text()}>
        <div data-component="text-part">
          <div data-slot="text-part-body">
            <Show
              when={streaming()}
              fallback={
                <Show
                  when={hasCustomCodeBlocks()}
                  fallback={
                    <Markdown
                      text={text()}
                      cacheKey={part().id}
                      streaming={false}
                      htmlComponents={{
                        context: htmlComponentContext(),
                        onEvent: props.onHtmlComponentEvent,
                      }}
                    />
                  }
                >
                  <div data-component="text-part-custom-code-blocks">
                    <Show when={props.renderCodeBlock}>
                      <For each={segments()}>
                        {(segment, index) => (
                          <Show
                            when={segment.type === "code"}
                            fallback={
                              <Show when={segment.type === "markdown" && segment.text}>
                                <Markdown
                                  text={segment.type === "markdown" ? segment.text : ""}
                                  cacheKey={`${part().id}:${index()}`}
                                  streaming={false}
                                  htmlComponents={{
                                    context: htmlComponentContext(),
                                    onEvent: props.onHtmlComponentEvent,
                                  }}
                                />
                              </Show>
                            }
                          >
                            {(() => {
                              if (segment.type !== "code") return null
                              return (
                                props.renderCodeBlock?.({
                                  language: segment.language,
                                  code: segment.code,
                                  raw: segment.raw,
                                  blockIndex: segment.blockIndex,
                                  message: {
                                    id: props.message.id,
                                    sessionID: props.message.sessionID,
                                    role: props.message.role,
                                  },
                                  partID: part().id,
                                }) ?? (
                                  <Markdown
                                    text={segment.raw}
                                    cacheKey={`${part().id}:${index()}:raw`}
                                    streaming={false}
                                    htmlComponents={{
                                      context: htmlComponentContext(),
                                      onEvent: props.onHtmlComponentEvent,
                                    }}
                                  />
                                )
                              )
                            })()}
                          </Show>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              }
            >
              <PacedMarkdown
                text={text()}
                cacheKey={part().id}
                streaming={streaming()}
                context={htmlComponentContext()}
                onHtmlComponentEvent={props.onHtmlComponentEvent}
              />
            </Show>
          </div>
          <Show when={showCopy()}>
            <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted() ? "" : undefined}>
              <Tooltip
                value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
                placement="top"
                gutter={4}
              >
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="normal"
                  variant="ghost"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleCopy}
                  aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
                />
              </Tooltip>
              <Show when={meta()}>
                <span data-slot="text-part-meta" class="text-12-regular text-text-weak cursor-default">
                  {meta()}
                </span>
              </Show>
            </div>
            <Show when={responseMetrics()}>
              <div data-slot="text-part-response-metrics" class="text-12-regular text-text-weak cursor-default">
                {responseMetrics()}
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    )
  })

  registerPartComponent("reasoning", function ReasoningPartDisplay(props) {
    const part = () => props.part as ReasoningPart
    const streaming = createMemo(
      () => props.message.role === "assistant" && typeof (props.message as AssistantMessage).time.completed !== "number",
    )
    const text = () => part().text.trim()
    const htmlComponentModel = () => {
      if (props.message.role === "assistant") {
        const message = props.message as AssistantMessage
        return {
          providerID: message.providerID,
          modelID: message.modelID,
          variant: undefined,
        }
      }
      return props.message.model
    }
    const htmlComponentContext = () => ({
      sessionID: props.message.sessionID,
      messageID: props.message.id,
      partID: part().id,
      role: props.message.role,
      agent: props.message.agent,
      modelProviderID: htmlComponentModel()?.providerID,
      modelID: htmlComponentModel()?.modelID,
      variant: htmlComponentModel()?.variant,
    })

    return (
      <Show when={text()}>
        <div data-component="reasoning-part">
          <Show
            when={streaming()}
            fallback={
              <Markdown
                text={text()}
                cacheKey={part().id}
                streaming={false}
                htmlComponents={{
                  context: htmlComponentContext(),
                  onEvent: props.onHtmlComponentEvent,
                }}
              />
            }
          >
            <PacedMarkdown
              text={text()}
              cacheKey={part().id}
              streaming={streaming()}
              context={htmlComponentContext()}
              onHtmlComponentEvent={props.onHtmlComponentEvent}
            />
          </Show>
        </div>
      </Show>
    )
  })
}
