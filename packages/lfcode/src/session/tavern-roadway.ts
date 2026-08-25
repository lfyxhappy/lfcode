import { generateText, type ModelMessage } from "ai"
import { Effect } from "effect"
import { isUserHiddenSystemActorID } from "@/actor/visibility"
import { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import z from "zod"

export const RoadwayMode = z.enum(["suggest", "impersonate", "summary"])
export type RoadwayMode = z.infer<typeof RoadwayMode>

export const RoadwayExtractionStrategy = z.enum(["bullet", "none"])
export type RoadwayExtractionStrategy = z.infer<typeof RoadwayExtractionStrategy>

export const RoadwayMessageRole = z.enum(["system", "user", "assistant"])
export type RoadwayMessageRole = z.infer<typeof RoadwayMessageRole>

export const RoadwayInput = z.object({
  sessionID: SessionID.zod,
  providerID: ProviderID.zod,
  modelID: ModelID.zod,
  mode: RoadwayMode.default("suggest"),
  prompt: z.string().min(1),
  extractionStrategy: RoadwayExtractionStrategy.default("bullet"),
  maxContextMessages: z.number().int().min(1).max(200).default(40),
  maxOutputTokens: z.number().int().min(16).max(16000).default(500),
  messageRole: RoadwayMessageRole.default("system"),
  selectedOption: z.string().optional(),
})
export type RoadwayInput = z.infer<typeof RoadwayInput>

export const RoadwayResult = z.object({
  text: z.string(),
  options: z.array(z.string()).optional(),
})
export type RoadwayResult = z.infer<typeof RoadwayResult>

/**
 * Side-effect-free Tavern helper generation.
 * Roadway suggestions belong in plugin-private UI state, not the RP transcript.
 */
export function generateRoadway(input: RoadwayInput) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service
    const session = yield* sessions.get(input.sessionID)
    if (!isTavernSession(session)) {
      throw new Error("Roadway is only available for lfcode-tavern/tavern sessions")
    }

    const model = yield* provider.getModel(input.providerID, input.modelID)
    const language = yield* provider.getLanguage(model)
    const history = yield* sessions.messages({ sessionID: input.sessionID, agentID: "*" })
    const transcript = buildTranscript(history, input.maxContextMessages)
    const prompt = renderTemplate(input.prompt, {
      user: "玩家",
      char: "角色",
      roadwaySelected: input.selectedOption ?? "",
    })

    const messages = buildModelMessages({
      transcript,
      prompt,
      messageRole: input.messageRole,
      mode: input.mode,
    })

    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model: language,
          messages,
          maxOutputTokens: input.maxOutputTokens,
          temperature: 0.85,
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })

    const text = result.text.trim()
    if (!text) throw new Error("Roadway 模型没有返回内容")
    if (input.mode === "impersonate" || input.mode === "summary" || input.extractionStrategy === "none") {
      return { text, options: undefined } satisfies RoadwayResult
    }
    const options = extractBulletPoints(text)
    return { text, options: options.length ? options : undefined } satisfies RoadwayResult
  })
}

export function isTavernSession(session: { extension?: { pluginID?: string; type?: string } | null }) {
  return session.extension?.pluginID === "lfcode-tavern" && session.extension.type === "tavern"
}

export function extractBulletPoints(text: string) {
  const matches = text.match(/^(?:\d+\.(?:\s+|(?=\S))|-\s+)(.*)$/gm) || []
  return matches
    .map((line) => line.replace(/^(?:\d+\.(?:\s+|(?=\S))|-\s+)/, "").trim())
    .filter(Boolean)
}

export function buildTranscript(
  history: Array<{ info: { role: string; agentID?: string }; parts: Array<{ type: string; text?: string; synthetic?: boolean }> }>,
  maxContextMessages: number,
) {
  const rows = history.flatMap((message) => {
    if (isUserHiddenSystemActorID(message.info.agentID)) return []
    if (message.info.role !== "user" && message.info.role !== "assistant") return []
    const text = message.parts
      .filter((part) => part.type === "text" && !part.synthetic && typeof part.text === "string" && part.text.trim())
      .map((part) => part.text!.trim())
      .join("\n\n")
      .trim()
    if (!text) return []
    return [{ role: message.info.role as "user" | "assistant", content: text }]
  })
  return rows.slice(Math.max(0, rows.length - maxContextMessages))
}

function buildModelMessages(input: {
  transcript: Array<{ role: "user" | "assistant"; content: string }>
  prompt: string
  messageRole: RoadwayMessageRole
  mode: RoadwayMode
}) {
  const baseSystem = input.mode === "impersonate"
    ? "你是一个酒馆角色扮演辅助工具。只输出玩家口吻的回复文本，不要解释过程，不要扮演对方角色。"
    : input.mode === "summary"
      ? "你是一个酒馆角色扮演剧情记录员。只输出精炼剧情摘要，不要继续角色扮演，不要解释过程。"
      : "你是一个酒馆角色扮演行动建议助手。只根据给定对话上下文输出玩家可执行的行动建议，不要扮演角色继续剧情正文。"

  // Anthropic-compatible providers require every system instruction before the
  // conversation. Appending a system message after roleplay history is rejected.
  const system = input.messageRole === "system" ? [baseSystem, input.prompt].join("\n\n") : baseSystem
  const messages: ModelMessage[] = [{ role: "system", content: system }]
  for (const row of input.transcript) {
    messages.push({ role: row.role, content: row.content })
  }

  if (input.messageRole === "system") return messages
  messages.push({ role: input.messageRole, content: input.prompt })
  return messages
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template
    .replace(/\{\{\s*user\s*\}\}/gi, vars.user)
    .replace(/\{\{\s*char\s*\}\}/gi, vars.char)
    .replace(/\{\{\s*roadwaySelected\s*\}\}/gi, vars.roadwaySelected)
}
