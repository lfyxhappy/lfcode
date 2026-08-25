import type { Component, JSX } from "solid-js"
import type { Message, Part as PartType } from "@lfcode-ai/sdk/v2"
import type { HtmlComponentEventDetail } from "./markdown"
import type { RenderCodeBlockInput } from "./message-code-blocks"

export interface MessagePartProps {
  part: PartType
  message: Message
  hideDetails?: boolean
  defaultOpen?: boolean
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  responseMetricsLine?: string
  onHtmlComponentEvent?: (detail: HtmlComponentEventDetail) => void
  renderCodeBlock?: (input: RenderCodeBlockInput) => JSX.Element | undefined
}

export type PartComponent = Component<MessagePartProps>

export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export interface ToolProps {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  output?: string
  attachments?: Array<{ mime: string; url: string; filename?: string }>
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  locked?: boolean
}

export type ToolComponent = Component<ToolProps>

const state: Record<
  string,
  {
    name: string
    render?: ToolComponent
  }
> = {}

export function registerTool(input: { name: string; render?: ToolComponent }) {
  state[input.name] = input
  return input
}

export function getTool(name: string) {
  return state[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}
