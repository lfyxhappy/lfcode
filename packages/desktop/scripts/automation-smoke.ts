#!/usr/bin/env bun

import { createAutomationClient } from "./automation-client"

const sessionID = process.env.LFCODE_AUTOMATION_SESSION_ID || ""
const directory = process.env.LFCODE_AUTOMATION_DIRECTORY || ""
const windowID = Number(process.env.LFCODE_AUTOMATION_WINDOW_ID || "0") || undefined
const sideChatSeed = process.env.LFCODE_AUTOMATION_SIDECHAT_TEXT || "请简单确认你已收到这条侧边对话测试消息。"
const sideChatPrompt = process.env.LFCODE_AUTOMATION_SIDECHAT_PROMPT || "请回复：sidechat smoke ok"

const client = await createAutomationClient()

const health = await client.get<{
  status: string
}>("/health")
console.log("[smoke] health", health.status)

const metadata = await client.getMetadata()
if (!Number.isSafeInteger(metadata.protocolVersion) || metadata.protocolVersion < 2 || !metadata.instanceID) {
  throw new Error("automation metadata did not report a supported protocol instance")
}
console.log("[smoke] metadata", {
  protocolVersion: metadata.protocolVersion,
  instanceID: metadata.instanceID,
  capability: metadata.capability,
  features: metadata.features,
})

const baselineEvents = requireEventCursor(
  await client.get<AutomationEventCursor>("/diagnostics/events/next?waitMs=0"),
)

const windows = await client.get<Array<{ id: number; title: string; focused: boolean }>>("/windows")
console.log("[smoke] windows", windows.map((item) => ({ id: item.id, title: item.title, focused: item.focused })))

const events = requireEventCursor(
  await client.get<AutomationEventCursor>(`/diagnostics/events/next?after=${baselineEvents.nextCursor}&waitMs=0`),
)
if (events.nextCursor < baselineEvents.nextCursor || events.events.length === 0) {
  throw new Error("automation event cursor did not return the incremental windows request")
}
console.log("[smoke] event cursor", {
  received: events.events.length,
  nextCursor: events.nextCursor,
  resetRequired: events.resetRequired,
})

if (!sessionID || !directory) {
  console.log("[smoke] skip session flow because LFCODE_AUTOMATION_DIRECTORY / LFCODE_AUTOMATION_SESSION_ID is missing")
  process.exit(0)
}

await client.post("/session/open", {
  windowID,
  directory,
  sessionID,
})
await client.post("/wait", {
  windowID,
  timeoutMs: 15_000,
  intervalMs: 150,
  match: {
    sessionID,
  },
})
console.log("[smoke] session opened", sessionID)

const created = await client.post<{
  sideSessionID?: string
  state: {
    sideChat: { activeSessionID?: string; items: Array<{ sessionID: string }> }
  }
}>("/sidechat/create", {
  windowID,
  text: sideChatSeed,
})
if (!created.sideSessionID) {
  throw new Error("sidechat.create did not return sideSessionID")
}
console.log("[smoke] sidechat created", created.sideSessionID)

await client.post("/wait", {
  windowID,
  timeoutMs: 10_000,
  intervalMs: 120,
  match: {
    sideChatCount: created.state.sideChat.items.length,
    activeTab: `side-chat://${created.sideSessionID}`,
  },
})

await client.post("/composer/set-text", {
  windowID,
  target: "active-side",
  text: sideChatPrompt,
})
console.log("[smoke] sidechat prompt set")

await client.post("/composer/submit", {
  windowID,
  target: "active-side",
})
console.log("[smoke] sidechat prompt submitted")

const uiState = await client.get<unknown>(`/diagnostics/ui-state${windowID ? `?windowID=${windowID}` : ""}`)
console.log("[smoke] ui-state captured")
console.log(JSON.stringify(uiState, null, 2))

type AutomationEventCursor = {
  events: unknown[]
  nextCursor: number
  oldestID: number
  latestID: number
  resetRequired: boolean
}

function requireEventCursor(value: AutomationEventCursor) {
  if (
    !Array.isArray(value.events) ||
    !Number.isSafeInteger(value.nextCursor) ||
    !Number.isSafeInteger(value.oldestID) ||
    !Number.isSafeInteger(value.latestID) ||
    typeof value.resetRequired !== "boolean"
  ) {
    throw new Error("automation event cursor response is invalid")
  }
  return value
}
