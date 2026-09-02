import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  lazy,
  onMount,
  Show,
  Switch,
  Index,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import stripAnsi from "strip-ansi"
import { Dynamic } from "solid-js/web"
import {
  AgentPart,
  AssistantMessage,
  FilePart,
  Message as MessageType,
  Part as PartType,
  ReasoningPart,
  TextPart,
  ToolPart,
  UserMessage,
  Todo,
  QuestionAnswer,
  QuestionInfo,
} from "@lfcode-ai/sdk/v2"
import { useData } from "../context"
import { useFileComponent } from "../context/file"
import { useDialog } from "../context/dialog"
import { type UiI18n, useI18n } from "../context/i18n"
import { BasicTool, GenericTool } from "./basic-tool"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { Collapsible } from "./collapsible"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { ToolErrorCard } from "./tool-error-card"
import { Checkbox } from "./checkbox"
import { DiffChanges } from "./diff-changes"
import { Markdown, type HtmlComponentEventDetail } from "./markdown"
import { ImagePreview } from "./image-preview"
import { ThumbnailImage } from "./image-thumbnail"
import { getDirectory as _getDirectory, getFilename } from "@lfcode-ai/shared/util/path"
import { checksum } from "@lfcode-ai/shared/util/encode"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { Spinner } from "./spinner"
import { TextShimmer } from "./text-shimmer"
import { AnimatedCountList } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"
import { patchFiles } from "./apply-patch-file"
import { normalize } from "./session-diff"
import { animate } from "motion"
import { attached, inline, kind } from "./message-file"
import { resolveInlineImageUrl } from "./inline-image-cache"
import { PART_MAPPING, ToolRegistry, type MessagePartProps, type ToolProps } from "./message-part-registry"
import { registerMessagePartRenderers } from "./message-part-renderers"
import { createPacedTextValue } from "./message-part-paced"
import type { RenderCodeBlockInput } from "./message-code-blocks"
import { buildHighlightSegments } from "./message-part-highlight"
import {
  groupAnchorMessageIDs,
  groupParts,
  index,
  isCommandGroupTool,
  isContextGroupTool,
  isGroupedTool,
  list,
  partDefaultOpen,
  renderable,
  same,
  sameGroups,
  type PartGroup,
} from "./message-part-grouping"
import {
  readDiagnosticsByFile,
  readDiffChanges,
  readFileDiff,
  readString,
  readStringField,
  type ToolDiagnostic,
} from "./message-part-tool-data"
import { canUseCodeDiffView } from "./code-diff-shared"
import { SUBAGENT_VIEW_REQUEST_EVENT } from "./message-part-events"
export { SUBAGENT_VIEW_REQUEST_EVENT } from "./message-part-events"
export { PART_MAPPING } from "./message-part-registry"
export type { MessagePartProps, ToolProps } from "./message-part-registry"

const CodeDiffView = lazy(() => import("./code-diff-view").then((mod) => ({ default: mod.CodeDiffView })))
type FailedToolPart = ToolPart & { state: Extract<ToolPart["state"], { status: "error" }> }

function ShellSubmessage(props: { text: string; animate?: boolean }) {
  let widthRef: HTMLSpanElement | undefined
  let valueRef: HTMLSpanElement | undefined

  onMount(() => {
    if (!props.animate) return
    requestAnimationFrame(() => {
      if (widthRef) {
        animate(widthRef, { width: "auto" }, { type: "spring", visualDuration: 0.25, bounce: 0 })
      }
      if (valueRef) {
        animate(valueRef, { opacity: 1, filter: "blur(0px)" }, { duration: 0.32, ease: [0.16, 1, 0.3, 1] })
      }
    })
  })

  return (
    <span data-component="shell-submessage">
      <span ref={widthRef} data-slot="shell-submessage-width" style={{ width: props.animate ? "0px" : undefined }}>
        <span data-slot="basic-tool-tool-subtitle">
          <span
            ref={valueRef}
            data-slot="shell-submessage-value"
            style={props.animate ? { opacity: 0, filter: "blur(2px)" } : undefined}
          >
            {props.text}
          </span>
        </span>
      </span>
    </span>
  )
}

function getDiagnostics(
  diagnosticsByFile: Record<string, ToolDiagnostic[]> | undefined,
  filePath: string | undefined,
): ToolDiagnostic[] {
  if (!diagnosticsByFile || !filePath) return []
  const diagnostics = diagnosticsByFile[filePath] ?? []
  return diagnostics.filter((d) => d.severity === 1).slice(0, 3)
}

function DiagnosticsDisplay(props: { diagnostics: ToolDiagnostic[] }): JSX.Element {
  const i18n = useI18n()
  return (
    <Show when={props.diagnostics.length > 0}>
      <div data-component="diagnostics">
        <For each={props.diagnostics}>
          {(diagnostic) => (
            <div data-slot="diagnostic">
              <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
              <span data-slot="diagnostic-location">
                [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
              </span>
              <span data-slot="diagnostic-message">{diagnostic.message}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

export interface MessageProps {
  message: MessageType
  parts: PartType[]
  actions?: UserActions
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
  onHtmlComponentEvent?: (detail: HtmlComponentEventDetail) => void
  renderCodeBlock?: (input: RenderCodeBlockInput) => JSX.Element | undefined
}

export type SessionAction = (input: { sessionID: string; messageID: string }) => Promise<void> | void

export type UserActions = {
  fork?: SessionAction
  revert?: SessionAction
}

export function PacedMarkdown(props: {
  text: string
  cacheKey: string
  streaming: boolean
  context: { sessionID?: string; messageID?: string; partID?: string; role?: string }
  onHtmlComponentEvent?: (detail: HtmlComponentEventDetail) => void
}) {
  const value = createPacedTextValue(
    () => props.text,
    () => props.streaming,
  )
  return (
    <Show when={value()}>
      <Markdown
        text={value()}
        cacheKey={props.cacheKey}
        streaming={props.streaming}
        htmlComponents={{
          context: props.context,
          onEvent: props.onHtmlComponentEvent,
        }}
      />
    </Show>
  )
}

function relativizeProjectPath(path: string, directory?: string) {
  if (!path) return ""
  if (!directory) return path
  if (directory === "/") return path
  if (directory === "\\") return path
  if (path === directory) return ""

  const separator = directory.includes("\\") ? "\\" : "/"
  const prefix = directory.endsWith(separator) ? directory : directory + separator
  if (!path.startsWith(prefix)) return path
  return path.slice(directory.length)
}

function getDirectory(path: string | undefined) {
  const data = useData()
  return relativizeProjectPath(_getDirectory(path), data.directory)
}

import type { IconProps } from "./icon"

export type ToolInfo = {
  icon: IconProps["name"]
  title: string
  subtitle?: string
}

function agentTitle(i18n: UiI18n, type?: string) {
  if (!type) return i18n.t("ui.tool.agent.default")
  return i18n.t("ui.tool.agent", { type })
}

const agentPalette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

function tone(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return agentPalette[hash % agentPalette.length]
}

export function getToolInfo(tool: string, input: any = {}): ToolInfo {
  const i18n = useI18n()
  switch (tool) {
    case "read":
      return {
        icon: "glasses",
        title: i18n.t("ui.tool.read"),
        subtitle: input.filePath ? getFilename(input.filePath) : undefined,
      }
    case "list":
      return {
        icon: "bullet-list",
        title: i18n.t("ui.tool.list"),
        subtitle: input.path ? getFilename(input.path) : undefined,
      }
    case "glob":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.glob"),
        subtitle: input.pattern,
      }
    case "grep":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.grep"),
        subtitle: input.pattern,
      }
    case "webfetch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.webfetch"),
        subtitle: input.url,
      }
    case "websearch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.websearch"),
        subtitle: input.query,
      }
    case "native_web_search": {
      const action = input.action
      const query =
        action && typeof action === "object" && !Array.isArray(action)
          ? (action as Record<string, unknown>).query
          : undefined
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.websearch"),
        subtitle: typeof query === "string" ? query : undefined,
      }
    }
    case "codesearch":
      return {
        icon: "code",
        title: i18n.t("ui.tool.codesearch"),
        subtitle: input.query,
      }
    case "task": {
      const op = (input.operation as Record<string, any>) ?? input
      const type =
        typeof op?.subagent_type === "string" && op.subagent_type
          ? op.subagent_type[0]!.toUpperCase() + op.subagent_type.slice(1)
          : undefined
      return {
        icon: "task",
        title: agentTitle(i18n, type),
        subtitle: op?.description,
      }
    }
    case "bash":
      return {
        icon: "console",
        title: i18n.t("ui.tool.shell"),
        subtitle: input.description,
      }
    case "background_job":
    case "shell_process":
      return {
        icon: "console",
        title: "Shell process",
        subtitle: typeof input.job_id === "string" ? input.job_id : input.operation,
      }
    case "edit":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.edit"),
        subtitle: input.filePath ? getFilename(input.filePath) : undefined,
      }
    case "write":
    case "apply_patch":
    case "replace_range":
    case "symbol_edit":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.edit"),
        subtitle: input.filePath ? getFilename(input.filePath) : undefined,
      }
    case "todowrite":
      return {
        icon: "checklist",
        title: i18n.t("ui.tool.todos"),
      }
    case "question":
      return {
        icon: "bubble-5",
        title: i18n.t("ui.tool.questions"),
      }
    case "skill":
      return {
        icon: "brain",
        title: input.name || i18n.t("ui.tool.skill"),
      }
    default:
      return {
        icon: "mcp",
        title: tool,
      }
  }
}

function urls(text: string | undefined) {
  if (!text) return []
  const seen = new Set<string>()
  return [...text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)]
    .map((item) => item[0].replace(/[),.;:!?]+$/g, ""))
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
}

export function AssistantParts(props: {
  messages: AssistantMessage[] | (() => AssistantMessage[])
  anchor?: (messageID: string) => string
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  responseMetricsLine?: string
  working?: boolean
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  onHtmlComponentEvent?: (detail: HtmlComponentEventDetail) => void
  renderCodeBlock?: (input: RenderCodeBlockInput) => JSX.Element | undefined
}) {
  const data = useData()
  const emptyParts: PartType[] = []
  const emptyTools: ToolPart[] = []
  const emptyErrors: FailedToolPart[] = []
  const messages = createMemo(() => (typeof props.messages === "function" ? props.messages() : props.messages))
  const msgs = createMemo(() => index(messages()))
  const part = createMemo(
    () =>
      new Map(
        messages().map((message) => [message.id, index(list(data.store.part?.[message.id], emptyParts))] as const),
      ),
  )
  const flatParts = createMemo(() =>
    messages().flatMap((message) =>
      list(data.store.part?.[message.id], emptyParts).map((part) => ({
        messageID: message.id,
        part,
      })),
    ),
  )
  const responseMetricsPartID = createMemo(() =>
    flatParts()
      .findLast((item) => item.part.type === "text" && !!item.part.text?.trim())?.part.id,
  )

  const grouped = createMemo(
    () =>
      groupParts(
        flatParts().filter((item) => renderable(item.part, props.showReasoningSummaries ?? true)),
      ),
    [] as PartGroup[],
    { equals: sameGroups },
  )

  const last = createMemo(() => grouped().at(-1)?.key)
  const groupAnchors = createMemo(() => (props.anchor ? groupAnchorMessageIDs(grouped()) : []))

  return (
    <Index each={grouped()}>
      {(entryAccessor, index) => {
        const entryType = createMemo(() => entryAccessor().type)
        const anchors = createMemo(() => groupAnchors()[index] ?? [])

        return (
          <>
            <For each={anchors()}>
              {(messageID) => (
                <div
                  id={props.anchor?.(messageID)}
                  data-message-id={messageID}
                  data-message-role="assistant"
                  aria-hidden="true"
                  class="h-0 overflow-hidden pointer-events-none"
                />
              )}
            </For>
            <Switch>
              <Match when={entryType() === "context"}>
                {(() => {
                  const parts = createMemo(
                    () => {
                      const entry = entryAccessor()
                      if (entry.type !== "context") return emptyTools
                      return entry.refs
                        .map((ref) => part().get(ref.messageID)?.get(ref.partID))
                        .filter((part): part is ToolPart => !!part && isContextGroupTool(part))
                    },
                    emptyTools,
                    { equals: same },
                  )
                  const busy = createMemo(() => props.working && last() === entryAccessor().key)

                  return (
                    <Show when={parts().length > 0}>
                      <ContextToolGroup parts={parts()} busy={busy()} />
                    </Show>
                  )
                })()}
              </Match>
              <Match when={entryType() === "command"}>
                {(() => {
                  const commands = createMemo(
                    () => {
                      const entry = entryAccessor()
                      if (entry.type !== "command") return [] as { message: AssistantMessage; part: ToolPart }[]
                      return entry.refs
                        .map((ref) => {
                          const message = msgs().get(ref.messageID)
                          const commandPart = part().get(ref.messageID)?.get(ref.partID)
                          if (
                            !message ||
                            message.role !== "assistant" ||
                            !commandPart ||
                            !isCommandGroupTool(commandPart)
                          )
                            return
                          return { message, part: commandPart }
                        })
                        .filter((item): item is { message: AssistantMessage; part: ToolPart } => !!item)
                    },
                    [],
                    { equals: same },
                  )
                  return <CommandToolGroup parts={commands()} />
                })()}
              </Match>
              <Match when={entryType() === "tool"}>
                {(() => {
                  const tools = createMemo(
                    () => {
                      const entry = entryAccessor()
                      if (entry.type !== "tool") return [] as { message: AssistantMessage; part: ToolPart }[]
                      return entry.refs
                        .map((ref) => {
                          const message = msgs().get(ref.messageID)
                          const toolPart = part().get(ref.messageID)?.get(ref.partID)
                          if (!message || message.role !== "assistant" || !toolPart || !isGroupedTool(toolPart)) return
                          return { message, part: toolPart }
                        })
                        .filter((item): item is { message: AssistantMessage; part: ToolPart } => !!item)
                    },
                    [],
                    { equals: same },
                  )
                  return <GroupedToolList parts={tools()} />
                })()}
              </Match>
              <Match when={entryType() === "tool-error"}>
                {(() => {
                  const errors = createMemo(
                    () => {
                      const entry = entryAccessor()
                      if (entry.type !== "tool-error") return emptyErrors
                      return entry.refs
                        .map((ref) => part().get(ref.messageID)?.get(ref.partID))
                        .filter(
                          (part): part is FailedToolPart =>
                            !!part && part.type === "tool" && part.state.status === "error",
                        )
                    },
                    emptyErrors,
                    { equals: same },
                  )
                  const lastError = createMemo(() => errors().at(-1))

                  return (
                    <Show when={lastError()}>
                      {(item) => (
                        <div data-component="tool-part-wrapper">
                          <ToolErrorCard
                            tool={item().tool}
                            error={item().state.error}
                            occurrences={errors().length}
                            defaultOpen={partDefaultOpen(item(), props.shellToolDefaultOpen, props.editToolDefaultOpen)}
                          />
                        </div>
                      )}
                    </Show>
                  )
                })()}
              </Match>
              <Match when={entryType() === "part"}>
                {(() => {
                  const viewportAnchor = createMemo(() => {
                    const entry = entryAccessor()
                    if (entry.type !== "part") return
                    return `${entry.ref.messageID}:${entry.ref.partID}`
                  })
                  const message = createMemo(() => {
                    const entry = entryAccessor()
                    if (entry.type !== "part") return
                    return msgs().get(entry.ref.messageID)
                  })
                  const item = createMemo(() => {
                    const entry = entryAccessor()
                    if (entry.type !== "part") return
                    return part().get(entry.ref.messageID)?.get(entry.ref.partID)
                  })

                  return (
                    <Show when={message()}>
                      <Show when={item()}>
                        <div data-viewport-anchor={viewportAnchor()}>
                          <Part
                            part={item()!}
                            message={message()!}
                            showAssistantCopyPartID={props.showAssistantCopyPartID}
                            turnDurationMs={props.turnDurationMs}
                            responseMetricsLine={
                              item()!.id === responseMetricsPartID() ? props.responseMetricsLine : undefined
                            }
                            defaultOpen={partDefaultOpen(
                              item()!,
                              props.shellToolDefaultOpen,
                              props.editToolDefaultOpen,
                            )}
                            onHtmlComponentEvent={props.onHtmlComponentEvent}
                            renderCodeBlock={props.renderCodeBlock}
                          />
                        </div>
                      </Show>
                    </Show>
                  )
                })()}
              </Match>
            </Switch>
          </>
        )
      }}
    </Index>
  )
}

function contextToolDetail(part: ToolPart): string | undefined {
  const info = getToolInfo(part.tool, part.state.input ?? {})
  if (info.subtitle) return info.subtitle
  if (part.state.status === "error") return part.state.error
  if ((part.state.status === "running" || part.state.status === "completed") && part.state.title)
    return part.state.title
  const description = part.state.input?.description
  if (typeof description === "string") return description
  return undefined
}

function contextToolTrigger(part: ToolPart, i18n: ReturnType<typeof useI18n>) {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const path = typeof input.path === "string" ? input.path : "/"
  const filePath = typeof input.filePath === "string" ? input.filePath : undefined
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const offset = typeof input.offset === "number" ? input.offset : undefined
  const limit = typeof input.limit === "number" ? input.limit : undefined

  switch (part.tool) {
    case "read": {
      const args: string[] = []
      if (offset !== undefined) args.push("offset=" + offset)
      if (limit !== undefined) args.push("limit=" + limit)
      return {
        title: i18n.t("ui.tool.read"),
        subtitle: filePath ? getFilename(filePath) : "",
        args,
      }
    }
    case "list":
      return {
        title: i18n.t("ui.tool.list"),
        subtitle: getDirectory(path),
      }
    case "glob":
      return {
        title: i18n.t("ui.tool.glob"),
        subtitle: getDirectory(path),
        args: pattern ? ["pattern=" + pattern] : [],
      }
    case "grep": {
      const args: string[] = []
      if (pattern) args.push("pattern=" + pattern)
      if (include) args.push("include=" + include)
      return {
        title: i18n.t("ui.tool.grep"),
        subtitle: getDirectory(path),
        args,
      }
    }
    default: {
      const info = getToolInfo(part.tool, input)
      return {
        title: info.title,
        subtitle: info.subtitle || contextToolDetail(part),
        args: [],
      }
    }
  }
}

function contextToolSummary(parts: ToolPart[]) {
  const read = parts.filter((part) => part.tool === "read").length
  const search = parts.filter((part) => part.tool === "glob" || part.tool === "grep").length
  const list = parts.filter((part) => part.tool === "list").length
  return { read, search, list }
}

type ActorConversationCardData = {
  actorID?: string
  title: string
  status: "running" | "completed" | "failed" | "cancelled" | "message"
  summary?: string
  detail?: string
}

type ActorActivityCardData = {
  actorID?: string
  sessionID?: string
  action: "spawn" | "send" | "status" | "wait" | "cancel" | "result" | "message"
  agent?: string
  title: string
  status: string
  summary?: string
  detail?: string
}

function actorConversationCard(text: string): ActorConversationCardData | undefined {
  if (text.includes("<actor-notification>")) {
    const body = text.replace(/^\s*<actor-notification>\s*/, "").replace(/\s*<\/actor-notification>\s*$/, "")
    const header = body.match(/Background actor "([^"]+)" \(actor_id: ([^)]+)\) (completed|failed|was cancelled)\./)
    if (!header) return undefined
    const status = header[3] === "completed" ? "completed" : header[3] === "failed" ? "failed" : "cancelled"
    const summary = body.match(/(?:^|\n)Summary:\s*([\s\S]*?)(?=\n(?:Result|Error):|$)/)?.[1]?.trim()
    const detail = body.match(/(?:^|\n)(?:Result|Error):\s*([\s\S]*)$/)?.[1]?.trim()
    return {
      actorID: header[2].trim(),
      title: header[1].trim(),
      status,
      ...(summary ? { summary } : {}),
      ...(detail ? { detail } : {}),
    }
  }

  const inbox = text.match(/^\s*<inbox\s+from="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/inbox>\s*$/)
  if (!inbox || inbox[1] === "system") return undefined
  const sender = inbox[1]
  const actorID = sender.slice(sender.lastIndexOf(":") + 1).trim()
  if (!actorID || actorID === "?") return undefined
  return {
    actorID,
    title: "Message from subagent",
    status: "message",
    detail: inbox[2].trim() || "(empty message)",
  }
}

function actorStatusLabel(status: string) {
  if (status === "completed" || status === "idle") return "已完成"
  if (status === "failed" || status === "error") return "失败"
  if (status === "cancelled") return "已取消"
  if (status === "pending") return "等待中"
  if (status === "running") return "进行中"
  return "新消息"
}

function actorActionLabel(card: ActorActivityCardData) {
  if (card.actorID === "main") return "主智能体状态"
  if (card.action === "spawn") return "已派发子智能体"
  if (card.action === "send") return "已追问子智能体"
  if (card.action === "status") return "子智能体状态"
  if (card.action === "wait") return "等待子智能体"
  if (card.action === "cancel") return "已取消子智能体"
  if (card.action === "result") return "子智能体返回结果"
  return "子智能体消息"
}

function firstActorCardLine(value: string | undefined) {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function ActorActivityCard(props: { card: ActorActivityCardData }) {
  const summary = createMemo(() => props.card.summary?.trim())
  const detail = createMemo(() => props.card.detail?.trim())
  const preview = createMemo(
    () =>
      firstActorCardLine(summary()) ??
      firstActorCardLine(props.card.action === "spawn" || props.card.action === "send" ? props.card.title : detail()) ??
      firstActorCardLine(props.card.title) ??
      "子智能体活动",
  )
  const clickable = createMemo(() => props.card.actorID !== "main" && !!props.card.actorID && !!props.card.sessionID)
  const icon = () => {
    if (props.card.status === "completed") return "circle-check" as const
    if (props.card.status === "failed" || props.card.status === "cancelled" || props.card.status === "error")
      return "circle-x" as const
    return "brain" as const
  }
  const openActor = () => {
    if (!props.card.actorID || !props.card.sessionID || typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent(SUBAGENT_VIEW_REQUEST_EVENT, {
        detail: { actorID: props.card.actorID, sessionID: props.card.sessionID },
      }),
    )
  }
  return (
    <div
      data-component="subagent-activity-card"
      data-action={props.card.action}
      data-status={props.card.status}
      data-clickable={clickable() ? "true" : undefined}
    >
      <Show
        when={clickable()}
        fallback={
          <div data-slot="subagent-activity-card-open">
            <ActorActivityCardPreview card={props.card} icon={icon()} preview={preview()} />
          </div>
        }
      >
        <button
          type="button"
          data-slot="subagent-activity-card-open"
          onClick={openActor}
          aria-label={`打开子智能体：${props.card.title}`}
        >
          <ActorActivityCardPreview card={props.card} icon={icon()} preview={preview()} />
        </button>
      </Show>
    </div>
  )
}

function ActorActivityCardPreview(props: {
  card: ActorActivityCardData
  icon: "circle-check" | "circle-x" | "brain"
  preview: string
}) {
  return (
    <>
      <div data-slot="subagent-activity-card-header">
        <span data-slot="subagent-activity-card-icon">
          <Icon name={props.icon} size="small" />
        </span>
        <span data-slot="subagent-activity-card-kind">{actorActionLabel(props.card)}</span>
        <span data-slot="subagent-activity-card-status">{actorStatusLabel(props.card.status)}</span>
      </div>
      <div data-slot="subagent-activity-card-summary">{props.preview}</div>
    </>
  )
}

function ExaOutput(props: { output?: string }) {
  const links = createMemo(() => urls(props.output))

  return (
    <Show when={links().length > 0}>
      <div data-component="exa-tool-output">
        <div data-slot="exa-tool-links">
          <For each={links()}>
            {(url) => (
              <a
                data-slot="exa-tool-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {url}
              </a>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => (
          <UserMessageDisplay message={userMessage() as UserMessage} parts={props.parts} actions={props.actions} />
        )}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay
            message={assistantMessage() as AssistantMessage}
            parts={props.parts}
            showAssistantCopyPartID={props.showAssistantCopyPartID}
            showReasoningSummaries={props.showReasoningSummaries}
            onHtmlComponentEvent={props.onHtmlComponentEvent}
            renderCodeBlock={props.renderCodeBlock}
          />
        )}
      </Match>
    </Switch>
  )
}

export function AssistantMessageDisplay(props: {
  message: AssistantMessage
  parts: PartType[]
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
  onHtmlComponentEvent?: (detail: HtmlComponentEventDetail) => void
  renderCodeBlock?: (input: RenderCodeBlockInput) => JSX.Element | undefined
}) {
  const emptyTools: ToolPart[] = []
  const part = createMemo(() => index(props.parts))
  const grouped = createMemo(
    () =>
      groupParts(
        props.parts
          .filter((part) => renderable(part, props.showReasoningSummaries ?? true))
          .map((part) => ({
            messageID: props.message.id,
            part,
          })),
      ),
    [] as PartGroup[],
    { equals: sameGroups },
  )

  return (
    <Index each={grouped()}>
      {(entryAccessor) => {
        const entryType = createMemo(() => entryAccessor().type)

        return (
          <Switch>
            <Match when={entryType() === "context"}>
              {(() => {
                const parts = createMemo(
                  () => {
                    const entry = entryAccessor()
                    if (entry.type !== "context") return emptyTools
                    return entry.refs
                      .map((ref) => part().get(ref.partID))
                      .filter((part): part is ToolPart => !!part && isContextGroupTool(part))
                  },
                  emptyTools,
                  { equals: same },
                )

                return (
                  <Show when={parts().length > 0}>
                    <ContextToolGroup parts={parts()} />
                  </Show>
                )
              })()}
            </Match>
            <Match when={entryType() === "command"}>
              {(() => {
                const commands = createMemo(
                  () => {
                    const entry = entryAccessor()
                    if (entry.type !== "command") return [] as { message: AssistantMessage; part: ToolPart }[]
                    return entry.refs
                      .map((ref) => {
                        const commandPart = part().get(ref.partID)
                        if (!commandPart || !isCommandGroupTool(commandPart)) return
                        return { message: props.message, part: commandPart }
                      })
                      .filter((item): item is { message: AssistantMessage; part: ToolPart } => !!item)
                  },
                  [],
                  { equals: same },
                )
                return <CommandToolGroup parts={commands()} />
              })()}
            </Match>
            <Match when={entryType() === "tool"}>
              {(() => {
                const tools = createMemo(
                  () => {
                    const entry = entryAccessor()
                    if (entry.type !== "tool") return [] as { message: AssistantMessage; part: ToolPart }[]
                    return entry.refs
                      .map((ref) => {
                        const toolPart = part().get(ref.partID)
                        if (!toolPart || !isGroupedTool(toolPart)) return
                        return { message: props.message, part: toolPart }
                      })
                      .filter((item): item is { message: AssistantMessage; part: ToolPart } => !!item)
                  },
                  [],
                  { equals: same },
                )
                return <GroupedToolList parts={tools()} />
              })()}
            </Match>
            <Match when={entryType() === "part"}>
              {(() => {
                const item = createMemo(() => {
                  const entry = entryAccessor()
                  if (entry.type !== "part") return
                  return part().get(entry.ref.partID)
                })

                return (
                  <Show when={item()}>
                    <Part
                      part={item()!}
                      message={props.message}
                      showAssistantCopyPartID={props.showAssistantCopyPartID}
                      onHtmlComponentEvent={props.onHtmlComponentEvent}
                      renderCodeBlock={props.renderCodeBlock}
                    />
                  </Show>
                )
              })()}
            </Match>
          </Switch>
        )
      }}
    </Index>
  )
}

function ContextToolGroup(props: { parts: ToolPart[]; busy?: boolean }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const pending = createMemo(
    () =>
      !!props.busy || props.parts.some((part) => part.state.status === "pending" || part.state.status === "running"),
  )
  const summary = createMemo(() => contextToolSummary(props.parts))

  return (
    <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="tool-collapsible">
      <Collapsible.Trigger>
        <div data-component="context-tool-group-trigger">
          <span
            data-slot="context-tool-group-title"
            class="min-w-0 flex items-center gap-2 text-14-medium text-text-strong"
          >
            <span data-slot="context-tool-group-label" class="shrink-0">
              <ToolStatusTitle
                active={pending()}
                activeText={i18n.t("ui.sessionTurn.status.gatheringContext")}
                doneText={i18n.t("ui.sessionTurn.status.gatheredContext")}
                split={false}
              />
            </span>
            <span
              data-slot="context-tool-group-summary"
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text-base"
            >
              <AnimatedCountList
                items={[
                  {
                    key: "read",
                    count: summary().read,
                    one: i18n.t("ui.messagePart.context.read.one"),
                    other: i18n.t("ui.messagePart.context.read.other"),
                  },
                  {
                    key: "search",
                    count: summary().search,
                    one: i18n.t("ui.messagePart.context.search.one"),
                    other: i18n.t("ui.messagePart.context.search.other"),
                  },
                  {
                    key: "list",
                    count: summary().list,
                    one: i18n.t("ui.messagePart.context.list.one"),
                    other: i18n.t("ui.messagePart.context.list.other"),
                  },
                ]}
                fallback=""
              />
            </span>
          </span>
          <Collapsible.Arrow />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div data-component="context-tool-group-list">
          <Index each={props.parts}>
            {(partAccessor) => {
              const trigger = createMemo(() => contextToolTrigger(partAccessor(), i18n))
              const running = createMemo(
                () => partAccessor().state.status === "pending" || partAccessor().state.status === "running",
              )
              return (
                <div data-slot="context-tool-group-item">
                  <div data-component="tool-trigger">
                    <div data-slot="basic-tool-tool-trigger-content">
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title">
                              <TextShimmer text={trigger().title} active={running()} />
                            </span>
                            <Show when={!running() && trigger().subtitle}>
                              <span data-slot="basic-tool-tool-subtitle">{trigger().subtitle}</span>
                            </Show>
                            <Show when={!running() && trigger().args?.length}>
                              <For each={trigger().args}>
                                {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                              </For>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }}
          </Index>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

function CommandToolGroup(props: { parts: { message: AssistantMessage; part: ToolPart }[] }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const commands = createMemo(() => props.parts.filter((item) => item.part.tool !== "shell_process"))
  const pending = createMemo(() =>
    props.parts.some((item) => item.part.state.status === "pending" || item.part.state.status === "running"),
  )

  return (
    <div data-component="command-tool-group">
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="tool-collapsible">
        <Collapsible.Trigger>
          <div data-component="command-tool-group-trigger">
            <span data-slot="command-tool-group-title">
              <TextShimmer text={i18n.t("ui.sessionTurn.status.commandGroup")} active={pending()} />
              <span data-slot="command-tool-group-count">{commands().length}</span>
            </span>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-component="command-tool-group-list">
            <For each={commands()}>
              {(item) => (
                <div data-slot="command-tool-group-item">
                  <Part part={item.part} message={item.message} defaultOpen={false} />
                </div>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

function GroupedToolList(props: { parts: { message: AssistantMessage; part: ToolPart }[] }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const pending = createMemo(() =>
    props.parts.some((item) => item.part.state.status === "pending" || item.part.state.status === "running"),
  )

  return (
    <div data-component="command-tool-group">
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="tool-collapsible">
        <Collapsible.Trigger>
          <div data-component="command-tool-group-trigger">
            <span data-slot="command-tool-group-title">
              <TextShimmer text={i18n.t("ui.sessionTurn.status.toolGroup")} active={pending()} />
              <span data-slot="command-tool-group-count">{props.parts.length}</span>
            </span>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-component="command-tool-group-list">
            <For each={props.parts}>
              {(item) => (
                <div data-slot="command-tool-group-item">
                  <Part part={item.part} message={item.message} defaultOpen={false} />
                </div>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

export function UserMessageDisplay(props: { message: UserMessage; parts: PartType[]; actions?: UserActions }) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()
  const [state, setState] = createStore({
    copied: false,
    busy: false,
  })
  const copied = () => state.copied
  const busy = () => state.busy

  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  const actorCards = createMemo(
    () =>
      props.parts
        ?.filter((part): part is TextPart => part.type === "text" && !!part.synthetic)
        .flatMap((part) => {
          const card = actorConversationCard(part.text)
          return card ? [card] : []
        }) ?? [],
  )

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() => files().filter(attached))

  const inlineFiles = createMemo(() => files().filter(inline))

  const sessionImages = createMemo(() =>
    list(data.store.message?.[props.message.sessionID], [] as MessageType[]).flatMap((message) =>
      list(data.store.part?.[message.id], [] as PartType[])
        .filter((part): part is FilePart => part.type === "file" && attached(part) && kind(part) === "image")
        .map((part) => ({
          id: part.id,
          src: resolveInlineImageUrl(part) ?? part.url,
          alt: part.filename ?? i18n.t("ui.message.attachment.alt"),
        })),
    ),
  )

  const agents = createMemo(() => (props.parts?.filter((p) => p.type === "agent") as AgentPart[]) ?? [])

  const model = createMemo(() => {
    const providerID = props.message.model?.providerID
    const modelID = props.message.model?.modelID
    if (!providerID || !modelID) return ""
    const match = data.store.provider?.all?.find((p) => p.id === providerID)
    return match?.models?.[modelID]?.name ?? modelID
  })
  const timefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }))

  const stamp = createMemo(() => {
    const created = props.message.time?.created
    if (typeof created !== "number") return ""
    return timefmt().format(created)
  })

  const metaHead = createMemo(() => {
    const agent = props.message.agent
    const items = [agent ? agent[0]?.toUpperCase() + agent.slice(1) : "", model()]
    return items.filter((x) => !!x).join("\u00A0\u00B7\u00A0")
  })

  const metaTail = stamp

  const openImagePreview = (file: FilePart, alt?: string) => {
    const images = sessionImages()
    const index = images.findIndex((image) => image.id === file.id)
    const selected = images[index] ?? { src: resolveInlineImageUrl(file) ?? file.url, alt }
    dialog.show(() => <ImagePreview src={selected.src} alt={selected.alt} images={images} initialIndex={index} />)
  }

  const handleCopy = async () => {
    const content = text()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setState("copied", true)
    setTimeout(() => setState("copied", false), 2000)
  }

  const revert = () => {
    const act = props.actions?.revert
    if (!act || busy()) return
    setState("busy", true)
    void Promise.resolve()
      .then(() =>
        act({
          sessionID: props.message.sessionID,
          messageID: props.message.id,
        }),
      )
      .finally(() => setState("busy", false))
  }

  return (
    <div data-component="user-message">
      <For each={actorCards()}>
        {(card) => (
          <ActorActivityCard
            card={{
              ...card,
              sessionID: props.message.sessionID,
              action: card.status === "message" ? "message" : "result",
            }}
          />
        )}
      </For>
      <Show when={attachments().length > 0}>
        <div data-slot="user-message-attachments">
          <For each={attachments()}>
            {(file) => {
              const type = kind(file)
              const name = file.filename ?? i18n.t("ui.message.attachment.alt")

              return (
                <div
                  data-slot="user-message-attachment"
                  data-type={type}
                  data-clickable={type === "image" ? "true" : undefined}
                  title={type === "file" ? name : undefined}
                  onClick={() => {
                    if (type === "image") openImagePreview(file, name)
                  }}
                >
                  <Show
                    when={type === "image"}
                    fallback={
                      <div data-slot="user-message-attachment-file">
                        <FileIcon node={{ path: name, type: "file" }} />
                        <span data-slot="user-message-attachment-name">{name}</span>
                      </div>
                    }
                  >
                    <ThumbnailImage
                      src={file.url}
                      resolveSrc={() => resolveInlineImageUrl(file)}
                      alt={name}
                      cacheKey={file.id}
                      slot="user-message-attachment-image"
                      placeholderClass="user-message-attachment-image-placeholder"
                    />
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      <Show when={text()}>
        <>
          <div data-slot="user-message-body">
            <div data-slot="user-message-text">
              <HighlightedText text={text()} references={inlineFiles()} agents={agents()} />
            </div>
          </div>
          <div data-slot="user-message-copy-wrapper">
            <Show when={metaHead() || metaTail()}>
              <span data-slot="user-message-meta-wrap">
                <Show when={metaHead()}>
                  <span data-slot="user-message-meta" class="text-12-regular text-text-weak cursor-default">
                    {metaHead()}
                  </span>
                </Show>
                <Show when={metaHead() && metaTail()}>
                  <span data-slot="user-message-meta-sep" class="text-12-regular text-text-weak cursor-default">
                    {"\u00A0\u00B7\u00A0"}
                  </span>
                </Show>
                <Show when={metaTail()}>
                  <span data-slot="user-message-meta-tail" class="text-12-regular text-text-weak cursor-default">
                    {metaTail()}
                  </span>
                </Show>
              </span>
            </Show>
            <Show when={props.actions?.revert}>
              <Tooltip value={i18n.t("ui.message.revertMessage")} placement="top" gutter={4}>
                <IconButton
                  icon="reset"
                  size="normal"
                  variant="ghost"
                  disabled={!!busy()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation()
                    revert()
                  }}
                  aria-label={i18n.t("ui.message.revertMessage")}
                />
              </Tooltip>
            </Show>
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              placement="top"
              gutter={4}
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                size="normal"
                variant="ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleCopy()
                }}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              />
            </Tooltip>
          </div>
        </>
      </Show>
    </div>
  )
}

function HighlightedText(props: { text: string; references: FilePart[]; agents: AgentPart[] }) {
  const segments = createMemo(() => buildHighlightSegments(props.text, props.references, props.agents))

  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
}

function WebSearchProvenance(props: { metadata: Record<string, unknown> }) {
  const i18n = useI18n()
  const route = createMemo(() => readStringField(props.metadata, "route"))
  const provider = createMemo(() => readStringField(props.metadata, "provider"))
  const queryOriginal = createMemo(() => readStringField(props.metadata, "queryOriginal"))
  const querySent = createMemo(() => readStringField(props.metadata, "querySent"))
  const queryFidelity = createMemo(() => readStringField(props.metadata, "queryFidelity"))
  const attemptedProviders = createMemo(() => {
    const value = props.metadata.attemptedProviders
    if (!Array.isArray(value)) return [] as string[]
    return value.filter((item): item is string => typeof item === "string")
  })
  const warnings = createMemo(() => {
    const value = props.metadata.warnings
    if (!Array.isArray(value)) return [] as string[]
    return value.filter((item): item is string => typeof item === "string")
  })
  const sources = createMemo(() => {
    const value = props.metadata.sources
    if (!Array.isArray(value))
      return [] as {
        url: string
        sourceTier: string
        title?: string
        domain?: string
        snippet?: string
        publishedAt?: string
      }[]
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      if (typeof record.url !== "string" || typeof record.sourceTier !== "string") return []
      return [
        {
          url: record.url,
          sourceTier: record.sourceTier,
          ...(typeof record.title === "string" ? { title: record.title } : {}),
          ...(typeof record.domain === "string" ? { domain: record.domain } : {}),
          ...(typeof record.snippet === "string" ? { snippet: record.snippet } : {}),
          ...(typeof record.publishedAt === "string" ? { publishedAt: record.publishedAt } : {}),
        },
      ]
    })
  })
  const tierLabel = (tier: string) => {
    if (tier === "primary") return i18n.t("ui.webSearch.primary")
    if (tier === "authoritative-secondary") return i18n.t("ui.webSearch.authoritativeSecondary")
    if (tier === "practitioner") return i18n.t("ui.webSearch.practitioner")
    return i18n.t("ui.webSearch.discoveryOnly")
  }

  return (
    <Show when={provider() || route() || queryOriginal() || warnings().length > 0 || sources().length > 0}>
      <div class="mt-2 flex flex-col gap-1.5 text-12-regular text-text-weak" data-component="web-search-provenance">
        <Show when={queryOriginal()}>
          {(value) => <span>{`${i18n.t("ui.webSearch.queryOriginal")}: ${value()}`}</span>}
        </Show>
        <Show when={querySent() && querySent() !== queryOriginal()}>
          {(value) => <span>{`${i18n.t("ui.webSearch.querySent")}: ${value()}`}</span>}
        </Show>
        <Show when={route() || provider()}>
          <span>
            {`${i18n.t("ui.webSearch.provider")}: ${provider() ?? "-"}${route() ? ` · ${i18n.t("ui.webSearch.route")}: ${route()}` : ""}`}
          </span>
        </Show>
        <Show when={queryFidelity()}>{(value) => <span>{`${i18n.t("ui.webSearch.fidelity")}: ${value()}`}</span>}</Show>
        <Show when={attemptedProviders().length > 1}>
          <span>{`${i18n.t("ui.webSearch.attempts")}: ${attemptedProviders().join(" -> ")}`}</span>
        </Show>
        <For each={sources().slice(0, 8)}>
          {(source) => (
            <div class="flex min-w-0 flex-col gap-0.5">
              <a class="clickable subagent-link truncate" href={source.url} target="_blank" rel="noopener noreferrer">
                {`[${tierLabel(source.sourceTier)}] ${source.title ?? source.url}`}
              </a>
              <Show when={source.snippet || source.publishedAt}>
                <span class="truncate text-11-regular text-text-weak">
                  {[source.domain, source.publishedAt, source.snippet].filter(Boolean).join(" · ")}
                </span>
              </Show>
            </div>
          )}
        </For>
        <For each={warnings()}>
          {(warning) => (
            <span class="text-status-warning">{`${i18n.t("ui.webSearch.fallbackWarning")}: ${warning}`}</span>
          )}
        </For>
      </div>
    </Show>
  )
}

export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type])
  return (
    <Show when={component()}>
      <Dynamic
        component={component()}
        part={props.part}
        message={props.message}
        hideDetails={props.hideDetails}
        defaultOpen={props.defaultOpen}
        showAssistantCopyPartID={props.showAssistantCopyPartID}
        turnDurationMs={props.turnDurationMs}
        responseMetricsLine={props.responseMetricsLine}
        renderCodeBlock={props.renderCodeBlock}
      />
    </Show>
  )
}

function ToolFileAccordion(props: { path: string; actions?: JSX.Element; children: JSX.Element }) {
  const value = createMemo(() => props.path || "tool-file")

  return (
    <Accordion
      multiple
      data-scope="apply-patch"
      style={{ "--sticky-accordion-offset": "calc(32px + var(--tool-content-gap))" }}
      defaultValue={[value()]}
    >
      <Accordion.Item value={value()}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div data-slot="apply-patch-trigger-content">
              <div data-slot="apply-patch-file-info">
                <FileIcon node={{ path: props.path, type: "file" }} />
                <div data-slot="apply-patch-file-name-container">
                  <Show when={props.path.includes("/")}>
                    <span data-slot="apply-patch-directory">{`\u202A${getDirectory(props.path)}\u202C`}</span>
                  </Show>
                  <span data-slot="apply-patch-filename">{getFilename(props.path)}</span>
                </div>
              </div>
              <div data-slot="apply-patch-trigger-actions">
                {props.actions}
                <Icon name="chevron-grabber-vertical" size="small" />
              </div>
            </div>
          </Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content>{props.children}</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  )
}

export function MessageDivider(props: { label: string }) {
  return (
    <div data-component="compaction-part">
      <div data-slot="compaction-part-divider">
        <span data-slot="compaction-part-line" />
        <span data-slot="compaction-part-label" class="text-12-regular text-text-weak">
          {props.label}
        </span>
        <span data-slot="compaction-part-line" />
      </div>
    </div>
  )
}

registerMessagePartRenderers()

function ImageMakerToolCard(props: ToolProps) {
  const dialog = useDialog()
  const pending = () => props.status === "pending" || props.status === "running"
  const operation = createMemo(() => readStringField(props.metadata, "operation") ?? "generate")
  const prompt = createMemo(() => readStringField(props.metadata, "prompt") ?? readStringField(props.input, "prompt") ?? "")
  const provider = createMemo(() => readStringField(props.metadata, "provider") ?? "ImageMaker")
  const model = createMemo(() => readStringField(props.metadata, "model"))
  const image = createMemo(() => props.attachments?.find((item) => item.mime.startsWith("image/")))
  const title = createMemo(() => operation() === "edit" ? "图片编辑" : "图片生成")

  return (
    <BasicTool
      {...props}
      icon="brain"
      trigger={{
        title: pending() ? `${title()}中…` : title(),
        subtitle: prompt(),
        args: [provider(), model()].filter((item): item is string => !!item),
      }}
    >
      <div data-component="imagemaker-tool-card">
        <Show when={image()} fallback={<p data-slot="imagemaker-tool-card-pending">{pending() ? "正在请求图片服务…" : props.output}</p>}>
          {(attachment) => (
            <button
              type="button"
              data-slot="imagemaker-tool-card-image"
              onClick={() => dialog.show(() => <ImagePreview src={attachment().url} alt={prompt() || title()} />)}
            >
              <img src={attachment().url} alt={prompt() || title()} loading="lazy" />
              <span>{operation() === "edit" ? "查看编辑结果" : "查看生成图片"}</span>
            </button>
          )}
        </Show>
        <div data-slot="imagemaker-tool-card-meta">
          <span>{provider()}{model() ? ` · ${model()}` : ""}</span>
          <Show when={operation() === "edit" && readStringField(props.metadata, "sourceGalleryID")}>
            {(id) => <span>源图片 {id()}</span>}
          </Show>
        </div>
      </div>
    </BasicTool>
  )
}

for (const name of ["imagemaker_generate", "imagemaker_edit"]) {
  ToolRegistry.register({ name, render: ImageMakerToolCard })
}

ToolRegistry.register({
  name: "actor",
  render(props) {
    const operation = props.input.operation as Record<string, unknown> | undefined
    const targetActor = readStringField(operation, "to_actor_id") ?? readStringField(operation, "actor_id")
    const actorID =
      readStringField(props.metadata, "actorId") ??
      readStringField(props.metadata, "actor_id") ??
      readStringField(props.metadata, "receiver_actor_id") ??
      targetActor
    const sessionID =
      readStringField(props.metadata, "sessionId") ??
      readStringField(props.metadata, "session_id") ??
      readStringField(props.metadata, "receiver_session_id")
    const description =
      readStringField(operation, "description") ?? readStringField(props.metadata, "title") ?? "子智能体任务"
    const action = readStringField(props.metadata, "action") ?? readStringField(operation, "action")
    const content = readStringField(operation, "content")
    const prompt = readStringField(operation, "prompt")
    const agent = readStringField(operation, "subagent_type")
    const detail =
      props.status === "completed" && action !== "send" && props.output
        ? props.output
        : props.status === "error" && props.output
          ? props.output
          : undefined
    const status = props.status ?? "pending"
    return (
      <ActorActivityCard
        card={{
          actorID,
          sessionID,
          action:
            action === "spawn" || action === "send" || action === "status" || action === "wait" || action === "cancel"
              ? action
              : "spawn",
          ...(agent ? { agent } : {}),
          title: action === "send" && targetActor ? `向 ${targetActor} 追问` : description,
          status,
          ...((content ?? prompt) ? { summary: content ?? prompt } : {}),
          ...(detail ? { detail } : {}),
        }}
      />
    )
  },
})

ToolRegistry.register({
  name: "read",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const args: string[] = []
    if (props.input.offset) args.push("offset=" + props.input.offset)
    if (props.input.limit) args.push("limit=" + props.input.limit)
    const loaded = createMemo(() => {
      if (props.status !== "completed") return []
      const value = props.metadata.loaded
      if (!value || !Array.isArray(value)) return []
      return value.filter((p): p is string => typeof p === "string")
    })
    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          trigger={{
            title: i18n.t("ui.tool.read"),
            subtitle: (() => {
              const filePath = readStringField(props.input, "filePath")
              return filePath ? getFilename(filePath) : ""
            })(),
            args,
          }}
        />
        <For each={loaded()}>
          {(filepath) => (
            <div data-component="tool-loaded-file">
              <Icon name="enter" size="small" />
              <span>
                {i18n.t("ui.tool.loaded")} {relativizeProjectPath(filepath, data.directory)}
              </span>
            </div>
          )}
        </For>
      </>
    )
  },
})

ToolRegistry.register({
  name: "list",
  render(props) {
    const i18n = useI18n()
    const path = createMemo(() => readStringField(props.input, "path") ?? "/")
    return (
      <BasicTool
        {...props}
        icon="bullet-list"
        trigger={{ title: i18n.t("ui.tool.list"), subtitle: getDirectory(path()) }}
      >
        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "glob",
  render(props) {
    const i18n = useI18n()
    const path = createMemo(() => readStringField(props.input, "path") ?? "/")
    const pattern = createMemo(() => readStringField(props.input, "pattern"))
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.glob"),
          subtitle: getDirectory(path()),
          args: pattern() ? ["pattern=" + pattern()] : [],
        }}
      >
        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "grep",
  render(props) {
    const i18n = useI18n()
    const args: string[] = []
    const path = createMemo(() => readStringField(props.input, "path") ?? "/")
    const pattern = createMemo(() => readStringField(props.input, "pattern"))
    const include = createMemo(() => readStringField(props.input, "include"))
    if (pattern()) args.push("pattern=" + pattern())
    if (include()) args.push("include=" + include())
    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: getDirectory(path()),
          args,
        }}
      >
        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const url = createMemo(() => {
      const value = props.input.url
      if (typeof value !== "string") return ""
      return value
    })
    return (
      <BasicTool
        {...props}
        hideDetails
        icon="window-cursor"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending()} />
              </span>
              <Show when={!pending() && url()}>
                <a
                  data-slot="basic-tool-tool-subtitle"
                  class="clickable subagent-link"
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  {url()}
                </a>
              </Show>
            </div>
            <Show when={!pending() && url()}>
              <div data-component="tool-action">
                <Icon name="square-arrow-top-right" size="small" />
              </div>
            </Show>
          </div>
        }
      />
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  render(props) {
    const i18n = useI18n()
    const query = createMemo(() => {
      const value = props.input.query
      if (typeof value !== "string") return ""
      return value
    })

    return (
      <BasicTool
        {...props}
        icon="window-cursor"
        trigger={{
          title: i18n.t("ui.tool.websearch"),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
        <WebSearchProvenance metadata={props.metadata} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "native_web_search",
  render(props) {
    const i18n = useI18n()
    const query = createMemo(() => {
      const action = props.input.action
      if (!action || typeof action !== "object" || Array.isArray(action)) return ""
      const value = (action as Record<string, unknown>).query
      return typeof value === "string" ? value : ""
    })

    return (
      <BasicTool
        {...props}
        icon="window-cursor"
        trigger={{
          title: i18n.t("ui.tool.websearch"),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
        <WebSearchProvenance metadata={props.metadata} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "codesearch",
  render(props) {
    const i18n = useI18n()
    const query = createMemo(() => {
      const value = props.input.query
      if (typeof value !== "string") return ""
      return value
    })

    return (
      <BasicTool
        {...props}
        icon="code"
        trigger={{
          title: i18n.t("ui.tool.codesearch"),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "task",
  render(props) {
    const i18n = useI18n()
    const op = createMemo(() => (props.input.operation as Record<string, any>) ?? props.input)
    const action = createMemo(() => {
      const value = op()?.action
      return typeof value === "string" ? value : ""
    })
    // Subtitle reflects the work-item operation, e.g. `create "Implement auth"`,
    // `start T1`, `done T1`, `list`. Falls back to the tool output for ops we
    // don't special-case. Keyed on the operation/lifecycle, NOT on the tool-call
    // execution status (which would flip to "completed" the instant the call
    // returns, regardless of the task's actual state).
    const subtitle = createMemo(() => {
      const o = op()
      const verb = action()
      if (verb === "create") return o?.summary ? `create "${o.summary}"` : "create"
      if (verb === "list") return o?.status ? `list ${o.status}` : "list"
      if (o?.id && verb) return `${verb} ${o.id}`
      if (verb) return verb
      const out = props.output
      return typeof out === "string" ? out.split("\n")[0] : ""
    })
    return (
      <BasicTool
        {...props}
        icon="task"
        trigger={{
          title: i18n.t("ui.tool.task"),
          subtitle: subtitle(),
        }}
      >
        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "bash",
  render(props) {
    const i18n = useI18n()
    const pending = () => props.status === "pending" || props.status === "running"
    const sawPending = pending()
    const description = createMemo(() => readStringField(props.input, "description"))
    const outputRef = createMemo(() => readStringField(props.metadata, "outputRef"))
    const text = createMemo(() => {
      const cmd = readStringField(props.input, "command") ?? readStringField(props.metadata, "command") ?? ""
      const out = stripAnsi(props.output ?? readStringField(props.metadata, "output") ?? "")
      return `$ ${cmd}${out ? "\n\n" + out : ""}`
    })
    const [copied, setCopied] = createSignal(false)

    const handleCopy = async () => {
      const content = text()
      if (!content) return
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.shell")} active={pending()} />
              </span>
              <Show when={!pending() && description()}>
                <ShellSubmessage text={description()!} animate={sawPending} />
              </Show>
            </div>
          </div>
        }
      >
        <div data-component="bash-output">
          <Show when={outputRef()}>
            {(reference) => (
              <div class="px-3 pt-2 text-11-regular text-text-weak">
                Full output captured as <code class="font-mono text-text-base">{reference()}</code>. Ask the assistant
                to inspect it with a bounded read or search.
              </div>
            )}
          </Show>
          <div data-slot="bash-copy">
            <Tooltip
              value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              placement="top"
              gutter={4}
            >
              <IconButton
                icon={copied() ? "check" : "copy"}
                size="small"
                variant="secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
                aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
              />
            </Tooltip>
          </div>
          <div data-slot="bash-scroll" data-scrollable>
            <pre data-slot="bash-pre">
              <code>{text()}</code>
            </pre>
          </div>
        </div>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "shell",
  render(props) {
    return <Dynamic component={ToolRegistry.render("bash")!} {...props} />
  },
})

ToolRegistry.register({
  name: "edit",
  render(props) {
    if (props.input.operation === "patch") return <Dynamic component={ToolRegistry.render("apply_patch")!} {...props} />
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const filePath = createMemo(() => readStringField(props.input, "filePath") ?? "")
    const fileDiff = createMemo(() => readFileDiff(props.metadata.filediff))
    const diagnostics = createMemo(() => getDiagnostics(readDiagnosticsByFile(props.metadata.diagnostics), filePath()))
    const path = createMemo(() => fileDiff()?.file ?? filePath())
    const filename = () => getFilename(filePath())
    const oldString = createMemo(() => readStringField(props.input, "oldString") ?? "")
    const newString = createMemo(() => readStringField(props.input, "newString") ?? "")
    const content = createMemo(() => readStringField(props.input, "content") ?? "")
    const view = createMemo(() => {
      if (!path()) return
      const source = fileDiff()
      return normalize({
        file: path(),
        patch: readStringField(props.metadata, "diff"),
        before: source?.before ?? oldString(),
        after: source?.after ?? (props.input.operation === "write" ? content() : newString()),
        additions: source?.additions ?? 0,
        deletions: source?.deletions ?? 0,
        status: "modified",
      })
    })
    const [codeDiffUnavailable, setCodeDiffUnavailable] = createSignal(false)
    const useCodeDiff = createMemo(
      () =>
        !codeDiffUnavailable() &&
        canUseCodeDiffView({
          path: path(),
          before: view()?.before ?? oldString(),
          after: view()?.after ?? (props.input.operation === "write" ? content() : newString()),
        }),
    )
    const pending = () => props.status === "pending" || props.status === "running"
    return (
      <div data-component="edit-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && filePath().includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{getDirectory(filePath())}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">
                <Show when={!pending() && fileDiff()}>
                  <DiffChanges changes={fileDiff()!} />
                </Show>
              </div>
            </div>
          }
        >
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              actions={
                <Show when={!pending() && fileDiff()}>
                  <DiffChanges changes={fileDiff()!} />
                </Show>
              }
            >
              <div data-component="edit-content">
                <Show
                  when={useCodeDiff()}
                  fallback={
                    <Dynamic
                      component={fileComponent}
                      mode="diff"
                      before={{
                        name: fileDiff()?.file ?? filePath(),
                        contents: view()?.before ?? oldString(),
                      }}
                      after={{
                        name: fileDiff()?.file ?? filePath(),
                        contents: view()?.after ?? (props.input.operation === "write" ? content() : newString()),
                      }}
                    />
                  }
                >
                  <CodeDiffView
                    path={path()}
                    before={view()?.before ?? oldString()}
                    after={view()?.after ?? (props.input.operation === "write" ? content() : newString())}
                    diffStyle="split"
                    onUnavailable={() => setCodeDiffUnavailable(true)}
                  />
                </Show>
              </div>
            </ToolFileAccordion>
          </Show>
          <DiagnosticsDisplay diagnostics={diagnostics()} />
        </BasicTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const filePath = createMemo(() => readStringField(props.input, "filePath") ?? "")
    const content = createMemo(() => readStringField(props.input, "content") ?? "")
    const diagnostics = createMemo(() => getDiagnostics(readDiagnosticsByFile(props.metadata.diagnostics), filePath()))
    const path = createMemo(() => filePath())
    const filename = () => getFilename(filePath())
    const pending = () => props.status === "pending" || props.status === "running"
    return (
      <div data-component="edit-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer
          trigger={
            <div data-component="edit-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && filePath().includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{getDirectory(filePath())}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">{/* <DiffChanges diff={diff} /> */}</div>
            </div>
          }
        >
          <Show when={content() && path()}>
            <ToolFileAccordion path={path()}>
              <div data-component="write-content">
                <Dynamic
                  component={fileComponent}
                  mode="text"
                  file={{
                    name: filePath(),
                    contents: content(),
                    cacheKey: checksum(content()),
                  }}
                  overflow="scroll"
                />
              </div>
            </ToolFileAccordion>
          </Show>
          <DiagnosticsDisplay diagnostics={diagnostics()} />
        </BasicTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "apply_patch",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const files = createMemo(() => {
      const listed = patchFiles(props.metadata.files)
      if (listed.length > 0) return listed

      const legacy = readFileDiff(props.metadata.filediff)
      const patch = readStringField(props.metadata, "diff")
      if (!legacy?.file || (!patch && legacy.before === undefined && legacy.after === undefined)) return []

      return patchFiles([
        {
          filePath: legacy.file,
          relativePath: legacy.file,
          type: "update",
          patch,
          before: legacy.before,
          after: legacy.after,
          additions: legacy.additions,
          deletions: legacy.deletions,
        },
      ])
    })
    const pending = createMemo(() => props.status === "pending" || props.status === "running")
    const [codeDiffUnavailable, setCodeDiffUnavailable] = createSignal(false)
    const single = createMemo(() => {
      const list = files()
      if (list.length !== 1) return
      return list[0]
    })
    const [expanded, setExpanded] = createSignal<string[]>([])
    let seeded = false

    createEffect(() => {
      const list = files()
      if (list.length === 0) return
      if (seeded) return
      seeded = true
      setExpanded(list.filter((f) => f.type !== "delete").map((f) => f.filePath))
    })

    const subtitle = createMemo(() => {
      const count = files().length
      if (count === 0) return ""
      return `${count} ${i18n.t(count > 1 ? "ui.common.file.other" : "ui.common.file.one")}`
    })

    return (
      <Show
        when={single()}
        fallback={
          <div data-component="edit-tool">
            <BasicTool
              {...props}
              icon="code-lines"
              defer
              hideDetails={props.hideDetails || files().length === 0}
              trigger={{
                title: i18n.t("ui.messagePart.title.edit"),
                subtitle: subtitle(),
              }}
            >
              <Show when={files().length > 0}>
                <Accordion
                  multiple
                  data-scope="apply-patch"
                  style={{ "--sticky-accordion-offset": "calc(32px + var(--tool-content-gap))" }}
                  value={expanded()}
                  onChange={(value) => setExpanded(Array.isArray(value) ? value : value ? [value] : [])}
                >
                  <For each={files()}>
                    {(file) => {
                      const active = createMemo(() => expanded().includes(file.filePath))
                      const [visible, setVisible] = createSignal(false)
                      const [codeDiffUnavailable, setCodeDiffUnavailable] = createSignal(false)

                      createEffect(() => {
                        if (!active()) {
                          setVisible(false)
                          return
                        }

                        requestAnimationFrame(() => {
                          if (!active()) return
                          setVisible(true)
                        })
                      })

                      return (
                        <Accordion.Item value={file.filePath} data-type={file.type}>
                          <StickyAccordionHeader>
                            <Accordion.Trigger>
                              <div data-slot="apply-patch-trigger-content">
                                <div data-slot="apply-patch-file-info">
                                  <FileIcon node={{ path: file.relativePath, type: "file" }} />
                                  <div data-slot="apply-patch-file-name-container">
                                    <Show when={file.relativePath.includes("/")}>
                                      <span data-slot="apply-patch-directory">{`\u202A${getDirectory(file.relativePath)}\u202C`}</span>
                                    </Show>
                                    <span data-slot="apply-patch-filename">{getFilename(file.relativePath)}</span>
                                  </div>
                                </div>
                                <div data-slot="apply-patch-trigger-actions">
                                  <Switch>
                                    <Match when={file.type === "add"}>
                                      <span data-slot="apply-patch-change" data-type="added">
                                        {i18n.t("ui.patch.action.created")}
                                      </span>
                                    </Match>
                                    <Match when={file.type === "delete"}>
                                      <span data-slot="apply-patch-change" data-type="removed">
                                        {i18n.t("ui.patch.action.deleted")}
                                      </span>
                                    </Match>
                                    <Match when={file.type === "move"}>
                                      <span data-slot="apply-patch-change" data-type="modified">
                                        {i18n.t("ui.patch.action.moved")}
                                      </span>
                                    </Match>
                                    <Match when={true}>
                                      <DiffChanges changes={{ additions: file.additions, deletions: file.deletions }} />
                                    </Match>
                                  </Switch>
                                  <Icon name="chevron-grabber-vertical" size="small" />
                                </div>
                              </div>
                            </Accordion.Trigger>
                          </StickyAccordionHeader>
                          <Accordion.Content>
                            <Show when={visible()}>
                              <div data-component="apply-patch-file-diff">
                                <Show
                                  when={
                                    !codeDiffUnavailable() &&
                                    canUseCodeDiffView({
                                    path: file.relativePath,
                                      before: file.view.before,
                                      after: file.view.after,
                                    })
                                  }
                                  fallback={
                                    <Dynamic component={fileComponent} mode="diff" fileDiff={file.view.fileDiff} />
                                  }
                                >
                                  <CodeDiffView
                                    path={file.relativePath}
                                    before={file.view.before}
                                    after={file.view.after}
                                    diffStyle="split"
                                    onUnavailable={() => setCodeDiffUnavailable(true)}
                                  />
                                </Show>
                              </div>
                            </Show>
                          </Accordion.Content>
                        </Accordion.Item>
                      )
                    }}
                  </For>
                </Accordion>
              </Show>
            </BasicTool>
          </div>
        }
      >
        <div data-component="edit-tool">
          <BasicTool
            {...props}
            icon="code-lines"
            defer
            trigger={
              <div data-component="edit-trigger">
                <div data-slot="message-part-title-area">
                  <div data-slot="message-part-title">
                    <span data-slot="message-part-title-text">
                      <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending()} />
                    </span>
                    <Show when={!pending()}>
                      <span data-slot="message-part-title-filename">{getFilename(single()!.relativePath)}</span>
                    </Show>
                  </div>
                  <Show when={!pending() && single()!.relativePath.includes("/")}>
                    <div data-slot="message-part-path">
                      <span data-slot="message-part-directory">{getDirectory(single()!.relativePath)}</span>
                    </div>
                  </Show>
                </div>
                <div data-slot="message-part-actions">
                  <Show when={!pending()}>
                    <DiffChanges changes={{ additions: single()!.additions, deletions: single()!.deletions }} />
                  </Show>
                </div>
              </div>
            }
          >
            <ToolFileAccordion
              path={single()!.relativePath}
              actions={
                <Switch>
                  <Match when={single()!.type === "add"}>
                    <span data-slot="apply-patch-change" data-type="added">
                      {i18n.t("ui.patch.action.created")}
                    </span>
                  </Match>
                  <Match when={single()!.type === "delete"}>
                    <span data-slot="apply-patch-change" data-type="removed">
                      {i18n.t("ui.patch.action.deleted")}
                    </span>
                  </Match>
                  <Match when={single()!.type === "move"}>
                    <span data-slot="apply-patch-change" data-type="modified">
                      {i18n.t("ui.patch.action.moved")}
                    </span>
                  </Match>
                  <Match when={true}>
                    <DiffChanges changes={{ additions: single()!.additions, deletions: single()!.deletions }} />
                  </Match>
                </Switch>
              }
            >
              <div data-component="apply-patch-file-diff">
                <Show
                  when={
                    !codeDiffUnavailable() &&
                    canUseCodeDiffView({
                      path: single()!.relativePath,
                      before: single()!.view.before,
                      after: single()!.view.after,
                    })
                  }
                  fallback={<Dynamic component={fileComponent} mode="diff" fileDiff={single()!.view.fileDiff} />}
                >
                  <CodeDiffView
                    path={single()!.relativePath}
                    before={single()!.view.before}
                    after={single()!.view.after}
                    diffStyle="split"
                    onUnavailable={() => setCodeDiffUnavailable(true)}
                  />
                </Show>
              </div>
            </ToolFileAccordion>
          </BasicTool>
        </div>
      </Show>
    )
  },
})

ToolRegistry.register({
  name: "todowrite",
  render(props) {
    const i18n = useI18n()
    const todos = createMemo(() => {
      const meta = props.metadata?.todos
      if (Array.isArray(meta)) return meta

      const input = props.input.todos
      if (Array.isArray(input)) return input

      return []
    })

    const subtitle = createMemo(() => {
      const list = todos()
      if (list.length === 0) return ""
      return `${list.filter((t: Todo) => t.status === "completed").length}/${list.length}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen
        icon="checklist"
        trigger={{
          title: i18n.t("ui.tool.todos"),
          subtitle: subtitle(),
        }}
      >
        <Show when={todos().length}>
          <div data-component="todos">
            <For each={todos()}>
              {(todo: Todo) => (
                <Checkbox readOnly checked={todo.status === "completed"}>
                  <span
                    data-slot="message-part-todo-content"
                    data-completed={todo.status === "completed" ? "completed" : undefined}
                  >
                    {todo.content}
                  </span>
                </Checkbox>
              )}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()
    const questions = createMemo(() => (props.input.questions ?? []) as QuestionInfo[])
    const answers = createMemo(() => (props.metadata.answers ?? []) as QuestionAnswer[])
    const completed = createMemo(() => answers().length > 0)

    const subtitle = createMemo(() => {
      const count = questions().length
      if (count === 0) return ""
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen={completed()}
        icon="bubble-5"
        trigger={{
          title: i18n.t("ui.tool.questions"),
          subtitle: subtitle(),
        }}
      >
        <Show when={completed()}>
          <div data-component="question-answers">
            <For each={questions()}>
              {(q, i) => {
                const answer = () => answers()[i()] ?? []
                return (
                  <div data-slot="question-answer-item">
                    <div data-slot="question-text">{q.question}</div>
                    <div data-slot="answer-text">{answer().join(", ") || i18n.t("ui.question.answer.none")}</div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "skill",
  render(props) {
    const i18n = useI18n()
    const title = createMemo(() => readStringField(props.input, "name") ?? i18n.t("ui.tool.skill"))
    const running = createMemo(() => props.status === "pending" || props.status === "running")

    const titleContent = () => <TextShimmer text={title()} active={running()} />

    const trigger = () => (
      <div data-slot="basic-tool-tool-info-structured">
        <div data-slot="basic-tool-tool-info-main">
          <span data-slot="basic-tool-tool-title" class="capitalize agent-title">
            {titleContent()}
          </span>
        </div>
      </div>
    )

    return <BasicTool icon="brain" status={props.status} trigger={trigger()} hideDetails />
  },
})
