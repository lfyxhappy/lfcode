import { basename } from "node:path"
import { readLanInlineImage } from "./lan-inline-image"

type LanToolStatus = "pending" | "running" | "completed" | "error"

type LanMessagePart =
  | { id: string; type: "text" | "reasoning"; text: string }
  | { id: string; type: "tool-summary"; label: string; status: LanToolStatus }
  | { id: string; type: "attachment"; name: string; mime: string; preview?: true }
  | { id: string; type: "divider"; kind: "compaction" | "step" }

type LanMessage = {
  info: {
    id?: string
    sessionID?: string
    parentID?: string
    role: "user" | "assistant" | "message"
    time?: { created?: number; completed?: number }
    agent?: string
    model?: string
  }
  parts: LanMessagePart[]
}

const statuses = new Set<LanToolStatus>(["pending", "running", "completed", "error"])
const imageMimes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])
const namedToolLabels: Record<string, string> = {
  read: "读取内容",
  list: "列出内容",
  glob: "匹配文件",
  grep: "搜索文本",
  webfetch: "访问网页",
  websearch: "网页搜索",
  codesearch: "代码搜索",
  task: "子任务",
  edit: "编辑内容",
  write: "写入内容",
  apply_patch: "应用补丁",
  skill: "使用技能",
  question: "等待回答",
  bash: "执行工具",
}

export function projectLanMessages(value: unknown, redactText: (value: string) => string): LanMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((message) => {
    if (!record(message)) return []
    return [{
      info: projectLanMessageInfo(message.info, redactText),
      parts: Array.isArray(message.parts)
        ? message.parts.flatMap((part, index) => projectLanMessagePart(part, index, redactText))
        : [],
    }]
  })
}

function projectLanMessageInfo(value: unknown, redactText: (value: string) => string): LanMessage["info"] {
  if (!record(value)) return { role: "message" }
  const time = record(value.time) ? value.time : undefined
  const created = typeof time?.created === "number" ? time.created : undefined
  const completed = typeof time?.completed === "number" ? time.completed : undefined
  const role = value.role === "user" || value.role === "assistant" ? value.role : "message"
  const agent = role === "assistant" ? safeLabel(value.agent, redactText) : undefined
  const model = role === "assistant" ? safeLabel(value.modelID, redactText) : undefined
  return {
    ...(safeID(value.id) ? { id: value.id } : {}),
    ...(safeID(value.sessionID) ? { sessionID: value.sessionID } : {}),
    ...(safeID(value.parentID) ? { parentID: value.parentID } : {}),
    role,
    ...(created !== undefined || completed !== undefined
      ? { time: { ...(created !== undefined ? { created } : {}), ...(completed !== undefined ? { completed } : {}) } }
      : {}),
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
  }
}

function projectLanMessagePart(value: unknown, index: number, redactText: (value: string) => string): LanMessagePart[] {
  if (!record(value) || typeof value.type !== "string") return []
  const id = safeID(value.id) ? value.id : `part-${index}`
  if (value.type === "text" || value.type === "reasoning") {
    if (typeof value.text !== "string") return []
    return [{ id, type: value.type, text: redactText(value.text) }]
  }
  if (value.type === "tool") {
    const state = record(value.state) ? value.state : undefined
    const status = typeof state?.status === "string" && statuses.has(state.status as LanToolStatus) ? state.status as LanToolStatus : undefined
    if (!status) return []
    return [{ id, type: "tool-summary", label: namedToolLabels[typeof value.tool === "string" ? value.tool : ""] ?? "工具调用", status }]
  }
  if (value.type === "file") {
    const filename = typeof value.filename === "string" ? basename(value.filename).trim().slice(0, 200) : ""
    if (!filename) return []
    const preview = readLanInlineImage(value.url)
    return [{ id, type: "attachment", name: filename, mime: safeMime(preview?.mime ?? value.mime), ...(preview ? { preview: true } : {}) }]
  }
  if (value.type === "compaction") return [{ id, type: "divider", kind: "compaction" }]
  if (value.type === "step-finish") return [{ id, type: "divider", kind: "step" }]
  return []
}

function safeMime(value: unknown) {
  if (typeof value !== "string") return "application/octet-stream"
  if (imageMimes.has(value) || value === "application/pdf" || value === "text/plain") return value
  return "application/octet-stream"
}

function safeID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
}

function safeLabel(value: unknown, redactText: (value: string) => string) {
  if (typeof value !== "string") return
  const label = redactText(value).trim().slice(0, 200)
  return label || undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
