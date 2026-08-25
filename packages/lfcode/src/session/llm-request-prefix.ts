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
import type { Permission } from "../permission"

/**
 * Reserve a small, model-relative share of context for untrusted Skill
 * metadata. A character budget is not safe here: a CJK description can be
 * close to one token per character while English is commonly closer to four.
 * Unknown models use the deliberately conservative default.
 */
export const SKILL_CATALOG_DEFAULT_TOKENS = 3_000
export const SKILL_CATALOG_MIN_TOKENS = 768
export const SKILL_CATALOG_MAX_TOKENS = 8_192
export const SKILL_CATALOG_CONTEXT_SHARE = 0.04
export const SKILL_CATALOG_MAX_DESCRIPTION_TOKENS = 96
/** @deprecated Token budgets are authoritative; retained for external callers. */
export const SKILL_CATALOG_MAX_CHARS = 32_000

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
  /** Effective session + agent + temporary permission rules for this request. */
  permission?: Permission.Ruleset
  /** Actor that owns this request when inherited messages belong to another actor. */
  actorID?: string
  includeSkills?: boolean
  includeTools?: boolean
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

  const skillDiscoverySystem = input.includeSkills === false
    ? undefined
    : buildSkillCatalogSystem(yield* skill.available(input.agent, input.permission), input.model)

  const { inheritedMessages, system } = yield* Effect.all({
    inheritedMessages: MessageV2.toModelMessagesEffect(input.msgs, input.model),
    system: llm.buildSystemArray({
      agent: input.agent,
      model: input.model,
      system: skillDiscoverySystem ? [...input.additions, skillDiscoverySystem] : input.additions,
      user: lastUser,
      sessionID: input.sessionID as string,
      agentID: input.actorID ?? lastUser.agentID,
    }),
  })
  const toolDefs = input.includeTools === false
    ? []
    : yield* toolRegistry.tools({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
        activeSkills: Skill.activeNames(input.msgs),
      })

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

export function skillCatalogTokenBudget(model?: Pick<Provider.Model, "limit">) {
  const context = [model?.limit.input, model?.limit.context]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0]
  if (!context) return SKILL_CATALOG_DEFAULT_TOKENS
  return Math.max(
    SKILL_CATALOG_MIN_TOKENS,
    Math.min(SKILL_CATALOG_MAX_TOKENS, Math.floor(context * SKILL_CATALOG_CONTEXT_SHARE)),
  )
}

/**
 * Return a bounded XML fragment for the reviewer. It has the same budget and
 * discovery behaviour as the main catalog, so hidden omissions are not caused
 * by a separate fixed entry limit.
 */
export function buildSkillCatalogEntries(skills: Skill.Info[], model?: Pick<Provider.Model, "limit">) {
  return buildSkillCatalog(skills, Math.max(0, skillCatalogTokenBudget(model) - 256))
}

export function buildSkillCatalogSystem(skills: Skill.Info[], model?: Pick<Provider.Model, "limit">) {
  if (skills.length === 0) return
  const header = [
    "<available_skills>",
    "This is the currently visible catalog of available Skill metadata. Skill bodies, references, scripts, and assets are not preloaded. Read catalog_diagnostics before relying on exhaustive discovery: it states whether every available Skill name fits this request.",
    "Before any substantive answer or non-Skill tool action, compare the current request with every relevant entry. When a specialized workflow would materially help, you MUST call the skill tool with that exact name and load every relevant Skill before proceeding. Do not skip a relevant Skill merely because you could attempt the task without it.",
    "A user-explicit /skill-name request has highest priority. Use the skill tool for normal semantic, multilingual, synonym, and context-dependent matches as well.",
  ]
  const footer = "</available_skills>"
  const fixedTokens = estimateCatalogTokens([...header, footer].join("\n"))
  const catalog = buildSkillCatalog(skills, Math.max(0, skillCatalogTokenBudget(model) - fixedTokens))
  return [...header, catalog, footer].join("\n")
}

function buildSkillCatalog(skills: Skill.Info[], budgetTokens: number) {
  const sorted = skills.toSorted((a, b) => a.name.localeCompare(b.name))
  const candidates = sorted.map((skill) => {
    const description = compactDescription(skill.description, SKILL_CATALOG_MAX_DESCRIPTION_TOKENS)
    return {
      name: skill.name,
      shortened: description !== normalizeDescription(skill.description),
      entry: [
        "  <skill>",
        `    <name>${escapeXmlText(skill.name)}</name>`,
        `    <description>${escapeXmlText(description)}</description>`,
        "  </skill>",
      ].join("\n"),
    }
  })
  const allEntries = candidates.map((candidate) => candidate.entry).join("\n")
  if (estimateCatalogTokens(allEntries) <= budgetTokens) return allEntries

  // When descriptions do not fit, names take priority over details. The old
  // fixed 35% reserve could omit names even when the full compact index fit in
  // the actual budget. If the complete index itself cannot fit, omit details
  // and say so explicitly rather than pretending discovery is exhaustive.
  const diagnosticsReserve = 128
  const completeNameIndex = skillNameIndex(candidates.map((candidate) => candidate.name))
  const completeNameIndexFits = estimateCatalogTokens(completeNameIndex) <= Math.max(0, budgetTokens - diagnosticsReserve)
  const { names: indexedNames, value: nameIndex } = completeNameIndexFits
    ? { names: candidates.map((candidate) => candidate.name), value: completeNameIndex }
    : boundedSkillNameIndex(candidates.map((candidate) => candidate.name), Math.max(0, budgetTokens - diagnosticsReserve))
  const detailBudget = completeNameIndexFits
    ? Math.max(0, budgetTokens - estimateCatalogTokens(nameIndex) - diagnosticsReserve)
    : 0
  const entries: string[] = []
  for (const candidate of candidates) {
    const next = entries.concat(candidate.entry).join("\n")
    if (estimateCatalogTokens(next) > detailBudget) break
    entries.push(candidate.entry)
  }
  const shortenedDescriptions = candidates.slice(0, entries.length).filter((candidate) => candidate.shortened).length
  const omittedNames = sorted.length - indexedNames.length
  const diagnostics = `<catalog_diagnostics discovery="${omittedNames === 0 ? "complete" : "partial"}" detailed="${entries.length}" total="${sorted.length}" names_listed="${indexedNames.length}" names_omitted="${omittedNames}" description_shortened="${shortenedDescriptions}">${
    omittedNames === 0
      ? "Every available Skill name is listed. Descriptions are token-bounded; use the skill tool to search and load by exact name or topic."
      : "Only a bounded subset of Skill names fits this request. Do not treat this catalog as exhaustive; use the skill tool to search by topic before deciding that no relevant Skill exists."
  }</catalog_diagnostics>`
  return [...entries, nameIndex, diagnostics].filter((value): value is string => Boolean(value)).join("\n")
}

function skillNameIndex(names: string[]) {
  return `<skill_name_index>${names.map(escapeXmlText).join(", ")}</skill_name_index>`
}

function boundedSkillNameIndex(names: string[], budgetTokens: number) {
  const indexed: string[] = []
  for (const name of names) {
    const next = skillNameIndex(indexed.concat(name))
    if (estimateCatalogTokens(next) > budgetTokens) break
    indexed.push(name)
  }
  return { names: indexed, value: indexed.length > 0 ? skillNameIndex(indexed) : "" }
}

function compactDescription(value: string, limitTokens: number) {
  const normalized = normalizeDescription(value)
  if (estimateCatalogTokens(normalized) <= limitTokens) return normalized
  const output: string[] = []
  for (const char of normalized) {
    const next = output.concat(char).join("")
    if (estimateCatalogTokens(`${next}…`) > limitTokens) break
    output.push(char)
  }
  return `${output.join("").trimEnd()}…`
}

function normalizeDescription(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Deliberately over-estimate CJK and non-ASCII text. The common four-byte-ish
 * English heuristic materially undercounts Chinese skill descriptions.
 */
export function estimateCatalogTokens(value: string) {
  let ascii = 0
  let nonAscii = 0
  for (const char of value) {
    if (char.charCodeAt(0) <= 0x7f) ascii++
    else nonAscii++
  }
  return nonAscii + Math.ceil(ascii / 3)
}

function escapeXmlText(value: string) {
  return value.replace(/[&<>]/g, (char) => {
    if (char === "&") return "&amp;"
    if (char === "<") return "&lt;"
    return "&gt;"
  })
}
