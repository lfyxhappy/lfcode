import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Effect, Layer } from "effect"
import { dispatchHooks } from "./runtime"
import { HookEvents } from "./events"

type LifecycleEvent = {
  event: Parameters<typeof dispatchHooks>[0]["event"]
  sessionID?: string
  projectID?: string
  cwd?: string
  tool?: string
  payload?: Record<string, unknown>
}

function lifecycleEvent(type: string, properties: Record<string, unknown>): LifecycleEvent | undefined {
  if (type === "task.created") return { event: "TaskCreated", sessionID: stringValue(properties.sessionID), payload: { task: properties.task } }
  if (type === "task.updated") {
    const kind = stringValue(properties.kind)
    if (kind !== "done" && kind !== "abandoned") return undefined
    return { event: "TaskCompleted", sessionID: stringValue(properties.sessionID), payload: { task: properties.task, kind } }
  }
  if (type === "actor.registered" && properties.visible !== false) {
    return { event: "SubagentStart", sessionID: stringValue(properties.sessionID), payload: properties }
  }
  if (type === "actor.status" && properties.visible !== false && stringValue(properties.status) === "idle") {
    return { event: "SubagentStop", sessionID: stringValue(properties.sessionID), payload: properties }
  }
  if (type === "inbox.arrived") return { event: "Notification", sessionID: stringValue(properties.receiverSessionID), payload: properties }
  if (type === "question.replied" || type === "question.rejected") {
    return { event: "ElicitationResult", sessionID: stringValue(properties.sessionID), payload: properties }
  }
  if (type === "permission.replied" && stringValue(properties.reply) === "reject") {
    return { event: "PermissionDenied", sessionID: stringValue(properties.sessionID), payload: properties }
  }
  if (type === "command.executed") return { event: "UserPromptExpansion", sessionID: stringValue(properties.sessionID), payload: properties }
  if (type === "session.compacted") return { event: "PostCompact", sessionID: stringValue(properties.sessionID), payload: properties }
  if (type === "file.edited") return { event: "FileChanged", payload: properties, tool: stringValue(properties.file) }
  if (type === "file.watcher.updated") return { event: "FileChanged", payload: properties, tool: stringValue(properties.file) }
  if (type === "worktree.ready") return { event: "WorktreeCreate", payload: properties, tool: stringValue(properties.name) }
  if (type === "worktree.failed") return { event: "WorktreeCreate", payload: properties }
  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export const layer: Layer.Layer<never, never, Bus.Service> = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const fileTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const dispatch = (next: LifecycleEvent) => {
      const projectID = (() => {
        try {
          return String(Instance.project.id)
        } catch {
          return next.projectID
        }
      })()
      void dispatchHooks({ ...next, projectID, cwd: next.cwd ?? safeWorktree() }).catch(() => undefined)
    }
    const unsubscribe = yield* bus.subscribeAllCallback((message) => {
      if (message.type === HookEvents.RunCompleted.type) return
      const next = lifecycleEvent(message.type, message.properties as Record<string, unknown>)
      if (!next) return
      if (next.event !== "FileChanged" || !next.tool) return dispatch(next)
      const previous = fileTimers.get(next.tool)
      if (previous) clearTimeout(previous)
      fileTimers.set(next.tool, setTimeout(() => {
        fileTimers.delete(next.tool!)
        dispatch(next)
      }, 250))
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      unsubscribe()
      for (const timer of fileTimers.values()) clearTimeout(timer)
    }))
  }),
)

function safeWorktree() {
  try {
    return Instance.worktree
  } catch {
    return undefined
  }
}

export const defaultLayer = layer

export * as HookBridge from "./bridge"
