import { type Part as PartType, type ToolPart } from "@lfcode-ai/sdk/v2"
import { PART_MAPPING } from "./message-part-registry"

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const COMMAND_GROUP_TOOLS = new Set(["bash", "shell", "shell_process"])
const COMMAND_START_TOOLS = new Set(["bash", "shell"])
const HIDDEN_TOOLS = new Set(["todowrite"])

export function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

export function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

export type PartRef = {
  messageID: string
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }
  | {
      key: string
      type: "command"
      refs: PartRef[]
    }
  | {
      key: string
      type: "tool"
      refs: PartRef[]
    }
  | {
      key: string
      type: "tool-error"
      refs: PartRef[]
    }

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a === b) return true
  if (a.key !== b.key) return false
  if (a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return sameRef(a.ref, b.ref)
  }
  if (b.type !== a.type) return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => sameRef(ref, b.refs[i]!))
}

export function sameGroups(a: readonly PartGroup[] | undefined, b: readonly PartGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => sameGroup(item, b[i]!))
}

export function groupParts(parts: { messageID: string; part: PartType }[]) {
  const result: PartGroup[] = []
  let contextStart = -1
  let commandGroup: { index: number; refs: PartRef[] } | undefined
  let toolGroup: { index: number; tool: string; refs: PartRef[] } | undefined
  let errorStart = -1
  let errorSignature: string | undefined

  const flushContext = (end: number) => {
    if (contextStart < 0) return
    const first = parts[contextStart]
    const last = parts[end]
    if (!first || !last) {
      contextStart = -1
      return
    }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: parts.slice(contextStart, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    contextStart = -1
  }

  const flushErrors = (end: number) => {
    if (errorStart < 0) return
    const first = parts[errorStart]
    const last = parts[end]
    if (!first || !last) {
      errorStart = -1
      errorSignature = undefined
      return
    }
    result.push({
      key: `tool-error:${first.part.id}`,
      type: "tool-error",
      refs: parts.slice(errorStart, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    errorStart = -1
    errorSignature = undefined
  }

  const resetCommandGroup = () => {
    commandGroup = undefined
  }

  const resetToolGroup = () => {
    toolGroup = undefined
  }

  const appendCommand = (item: (typeof parts)[number]) => {
    const ref = { messageID: item.messageID, partID: item.part.id }
    if (!commandGroup) {
      result.push({ key: `part:${item.messageID}:${item.part.id}`, type: "part", ref })
      commandGroup = { index: result.length - 1, refs: [ref] }
      return
    }

    const current = result[commandGroup.index]
    if (!current) return
    if (current.type === "part") {
      result[commandGroup.index] = {
        key: `command:${current.ref.partID}`,
        type: "command",
        refs: [...commandGroup.refs, ref],
      }
      commandGroup.refs.push(ref)
      return
    }
    if (current.type === "command") {
      current.refs.push(ref)
      commandGroup.refs.push(ref)
    }
  }

  const appendProcessUpdate = (item: (typeof parts)[number]) => {
    if (!commandGroup) {
      result.push({
        key: `part:${item.messageID}:${item.part.id}`,
        type: "part",
        ref: { messageID: item.messageID, partID: item.part.id },
      })
      return
    }
    const current = result[commandGroup.index]
    commandGroup.refs.push({ messageID: item.messageID, partID: item.part.id })
    if (current?.type === "command") {
      current.refs.push({ messageID: item.messageID, partID: item.part.id })
    }
  }

  const appendTool = (item: { messageID: string; part: ToolPart }) => {
    const ref = { messageID: item.messageID, partID: item.part.id }
    if (!toolGroup || toolGroup.tool !== item.part.tool) {
      result.push({ key: `part:${item.messageID}:${item.part.id}`, type: "part", ref })
      toolGroup = { index: result.length - 1, tool: item.part.tool, refs: [ref] }
      return
    }

    const current = result[toolGroup.index]
    if (!current) return
    if (current.type === "part") {
      result[toolGroup.index] = {
        key: `tool:${toolGroup.tool}:${current.ref.partID}`,
        type: "tool",
        refs: [...toolGroup.refs, ref],
      }
      toolGroup.refs.push(ref)
      return
    }
    if (current.type === "tool") {
      current.refs.push(ref)
      toolGroup.refs.push(ref)
    }
  }

  parts.forEach((item, index) => {
    const signature = toolErrorSignature(item.part)
    if (signature) {
      resetCommandGroup()
      resetToolGroup()
      flushContext(index - 1)
      if (errorStart < 0) {
        errorStart = index
        errorSignature = signature
        return
      }
      if (errorSignature === signature) return
      flushErrors(index - 1)
      errorStart = index
      errorSignature = signature
      return
    }

    flushErrors(index - 1)
    if (item.part.type === "tool" && COMMAND_START_TOOLS.has(item.part.tool)) {
      resetToolGroup()
      flushContext(index - 1)
      appendCommand(item)
      return
    }

    if (item.part.type === "tool" && item.part.tool === "shell_process") {
      resetToolGroup()
      flushContext(index - 1)
      appendProcessUpdate(item)
      return
    }

    if (item.part.type !== "tool") {
      flushContext(index - 1)
      result.push({
        key: `part:${item.messageID}:${item.part.id}`,
        type: "part",
        ref: {
          messageID: item.messageID,
          partID: item.part.id,
        },
      })
      return
    }

    resetCommandGroup()
    if (item.part.tool === "actor") {
      resetToolGroup()
      flushContext(index - 1)
      result.push({
        key: `part:${item.messageID}:${item.part.id}`,
        type: "part",
        ref: { messageID: item.messageID, partID: item.part.id },
      })
      return
    }

    if (isContextGroupTool(item.part)) {
      resetToolGroup()
      if (contextStart < 0) contextStart = index
      return
    }

    if (!isGroupedTool(item.part)) return
    flushContext(index - 1)
    appendTool({ messageID: item.messageID, part: item.part })
  })

  flushContext(parts.length - 1)
  flushErrors(parts.length - 1)
  return result
}

export function groupAnchorMessageIDs(groups: readonly PartGroup[]) {
  const seen = new Set<string>()
  return groups.map((entry) => {
    const ids = entry.type === "part" ? [entry.ref.messageID] : Array.from(new Set(entry.refs.map((ref) => ref.messageID)))
    return ids.filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  })
}

export function index<T extends { id: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.id, item] as const))
}

export function renderable(part: PartType, showReasoningSummaries = true) {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return !!PART_MAPPING[part.type]
}

export function toolDefaultOpen(tool: string, shell = false, edit = false) {
  if (COMMAND_GROUP_TOOLS.has(tool)) return shell
  if (tool === "edit" || tool === "write" || tool === "apply_patch") return edit
}

export function partDefaultOpen(part: PartType, shell = false, edit = false) {
  if (part.type !== "tool") return
  return toolDefaultOpen(part.tool, shell, edit)
}

export function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

export function isCommandGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && COMMAND_GROUP_TOOLS.has(part.tool)
}

export function isGroupedTool(part: PartType): part is ToolPart {
  return part.type === "tool" && !COMMAND_GROUP_TOOLS.has(part.tool) && !CONTEXT_GROUP_TOOLS.has(part.tool)
}

function toolErrorSignature(part: PartType) {
  if (part.type !== "tool" || part.state.status !== "error") return
  return `${part.tool}\0${part.state.error.replace(/^Error:\s*/, "").replace(/\s+/g, " ").trim()}`
}
