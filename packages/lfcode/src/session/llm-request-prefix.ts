import { Effect } from "effect"
import { tool, jsonSchema, type Tool as AITool } from "ai"
import z from "zod"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"
import { ModelID } from "../provider/schema"
import type { Agent } from "../agent/agent"
import type { Provider } from "../provider"
import { LLM } from "./llm"
import { Skill } from "../skill"
import { ToolRegistry } from "../tool"
import { transformedToolSchema } from "../tool/registry"

/**
 * Build the LLM request prefix (system + tools + inheritedMessages) from the
 * given msgs array. Given identical inputs this returns deep-equal output
 * (modulo plugin trigger determinism, which is the only external non-determinism
 * source).
 *
 * Used by:
 *   - parent runLoop, to construct its own request
 *   - tryStartCheckpointWriter, to capture a frozen ForkContext at spawn time
 *
 * Both call sites must use this same function — the byte-equal invariant
 * across parent and fork is a structural consequence, not a separate assertion.
 *
 * Slicing (e.g. for fork capture at a watermark) is a caller concern; callers
 * pass the already-sliced msgs. ForkContext.watermarkMsgID is a boundary marker
 * on the fork context, not a parameter here.
 */
export const buildLLMRequestPrefix = Effect.fn("Session.buildLLMRequestPrefix")(function* (input: {
  sessionID: SessionID
  agent: Agent.Info
  model: Provider.Model
  msgs: MessageV2.WithParts[]
  /**
   * Caller-built system parts to splice into the system array (after agent.prompt
   * and before memory instructions). Currently env, skills, instructions in that
   * order. Caller is responsible for the ordering and content.
   */
  additions: string[]
}) {
  const llm = yield* LLM.Service
  const skill = yield* Skill.Service
  const toolRegistry = yield* ToolRegistry.Service

  // Always use full msgs — slicing is a fork-capture concern that lives at the
  // caller (ForkContext.watermarkMsgID is a boundary marker, not a slice arg).
  // See spec changelog at docs/superpowers/specs/2026-05-26-fork-agent-prefix-cache-design.md
  // Find the last user message; required for system "user.system" pass-through
  const lastUserMsg = input.msgs.findLast((m) => m.info.role === "user")
  if (!lastUserMsg)
    return yield* Effect.die(new Error("buildLLMRequestPrefix: no user message in msgs"))
  const lastUser = lastUserMsg.info as MessageV2.User

  const activeSkillSystem = buildActiveSkillSystem({
    skills: yield* skill.available(input.agent),
    msgs: input.msgs,
    lastUser,
  })

  const [{ inheritedMessages, system }, toolDefs] = yield* Effect.all(
    [
      Effect.all({
        inheritedMessages: MessageV2.toModelMessagesEffect(input.msgs, input.model),
        system: llm.buildSystemArray({
          agent: input.agent,
          model: input.model,
          system: activeSkillSystem ? [...input.additions, activeSkillSystem] : input.additions,
          user: lastUser,
          sessionID: input.sessionID as string,
          agentID: lastUser.agentID,
        }),
      }),
      toolRegistry.tools({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
      }),
    ],
    { concurrency: "unbounded" },
  )

  const tools: Record<string, AITool> = {}
  for (const item of toolDefs) {
    const schema = transformedToolSchema(input.model, item.parameters)
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
    })
  }

  return { system, tools, inheritedMessages }
})

const skillContentRegex = /<skill_content\s+name="([^"]+)">/gi

function buildActiveSkillSystem(input: {
  skills: Skill.Info[]
  msgs: MessageV2.WithParts[]
  lastUser: MessageV2.User
}) {
  const lastUserMsg = input.msgs.findLast((msg) => msg.info.id === input.lastUser.id)
  const lastUserText = collectUserText(lastUserMsg)
  const turnMessages = sliceCurrentTurn(input.msgs, input.lastUser.id)
  const loadedNames = new Set(turnMessages.flatMap(extractLoadedSkillNames))
  const active = input.skills
    .map((skill) => {
      const matched = Skill.matchesTriggerText(skill, lastUserText)
      const loaded = loadedNames.has(skill.name)
      if (!matched && !loaded) return
      return {
        skill,
        activation: [matched ? "matched user trigger terms" : undefined, loaded ? "explicitly loaded" : undefined]
          .filter(Boolean)
          .join(", "),
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)

  if (active.length === 0) return

  return [
    "<active_skills>",
    "The following skills are ACTIVE for the current turn.",
    "Treat every active skill as executable instructions, not optional reference material.",
    "You MUST follow each active skill unless a concrete tool, runtime, filesystem, or permission constraint blocks a step.",
    "Do not replace an active skill's procedure with your own preferred workflow just because it seems better.",
    "If you must deviate, state the blocking fact first and then continue with the closest compliant fallback.",
    "",
    ...active.flatMap((item) => [
      `<active_skill name="${item.skill.name}" activation="${item.activation || "active"}">`,
      item.skill.content.trim(),
      "</active_skill>",
      "",
    ]),
    "</active_skills>",
  ].join("\n")
}

function sliceCurrentTurn(msgs: MessageV2.WithParts[], lastUserID: string) {
  const index = msgs.findLastIndex((msg) => msg.info.id === lastUserID)
  return index >= 0 ? msgs.slice(index) : msgs
}

function collectUserText(msg: MessageV2.WithParts | undefined) {
  if (!msg) return ""
  return msg.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .filter((text) => !text.includes("<skill_content"))
    .join("\n")
}

function extractLoadedSkillNames(msg: MessageV2.WithParts) {
  return msg.parts.flatMap((part) => {
    if (part.type === "text") return extractSkillNamesFromText(part.text)
    if (part.type === "tool" && part.state.status === "completed") return extractSkillNamesFromText(part.state.output)
    return []
  })
}

function extractSkillNamesFromText(text: string) {
  return Array.from(text.matchAll(skillContentRegex), (match) => match[1]).filter(
    (name): name is string => !!name,
  )
}
