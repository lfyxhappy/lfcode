import path from "path"
import { pathToFileURL } from "url"
import { Buffer } from "buffer"
import z from "zod"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import { Permission } from "../permission"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

const Parameters = z.object({
  name: z
    .string()
    .describe("Exact skill name to load, keywords to search installed skills, or `可用技能` to list them. Never use search_tool for Skills."),
})

type SkillMetadata =
  | {
      query: string
      count: number
      mode: "list"
    }
  | {
      query: string
      matches: string[]
      mode: "search"
    }
  | {
      name: string
      dir: string
    }

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service

    const definition: Tool.DefWithoutID<typeof Parameters, SkillMetadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // The request runner supplies the exact merged ruleset used by
          // ctx.ask(). Do not list/search a Skill which an exact load would be
          // denied by session or temporary permission overrides.
          const effectivePermission = ctx.extra?.skillPermission
          const available = yield* skill.available(
            undefined,
            Array.isArray(effectivePermission) ? (effectivePermission as Permission.Ruleset) : undefined,
          )
          if (shouldListAvailableSkills(params.name)) {
            return {
              title: "Available skills",
              output: Skill.fmt(available, { verbose: false, max: 60, descriptionLimit: 180 }),
              metadata: {
                query: params.name,
                count: available.length,
                mode: "list" as const,
              },
            }
          }

          const name = params.name.trim()
          const info = available.find((item) => item.name === name)
          if (!info) {
            const matches = findMatches(available, name)
            if (matches.length === 0) {
              throw new Error(`Skill "${name}" not found. Try a broader keyword search.`)
            }
            return {
              title: `Skill search: ${name}`,
              output: [
                `<skill_search_results>`,
                `  <query>${Skill.escapeXmlText(name)}</query>`,
                ...matches.flatMap((item) => [
                  "  <skill>",
                  `    <name>${Skill.escapeXmlText(item.name)}</name>`,
                  `    <description>${Skill.escapeXmlText(item.description)}</description>`,
                  "  </skill>",
                ]),
                "  <next_step>Call the skill tool again with one exact name above to load its full instructions.</next_step>",
                "</skill_search_results>",
              ].join("\n"),
              metadata: {
                query: name,
                matches: matches.map((item) => item.name),
                mode: "search" as const,
              },
            }
          }

          const bodyBytes = Buffer.byteLength(info.content, "utf8")
          if (bodyBytes > Skill.MAX_BODY_BYTES) {
            throw new Error(
              `Skill \"${info.name}\" is ${bodyBytes} bytes, above the ${Skill.MAX_BODY_BYTES}-byte load limit. ` +
                "Keep the core workflow in SKILL.md and move detailed material into references that the Skill can load on demand.",
            )
          }

          yield* ctx.ask({
            permission: "skill",
            patterns: [name],
            always: [name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const limit = 10
          const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
            Stream.filter((file) => !file.includes("SKILL.md")),
            Stream.map((file) => path.resolve(dir, file)),
            Stream.take(limit),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk].map((file) => `<file>${Skill.escapeXmlText(file)}</file>`).join("\n")),
          )

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${Skill.escapeXmlAttribute(info.name)}">`,
              `<skill_name>${Skill.escapeXmlText(info.name)}</skill_name>`,
              "",
              info.content.trim(),
              "",
              `<base_directory>${Skill.escapeXmlText(base)}</base_directory>`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
    return definition
  }),
)

function findMatches(list: Skill.Info[], query: string) {
  const trimmed = query.trim()
  if (!trimmed) return []
  const normalized = normalize(trimmed)
  const tokens = normalized.split(" ").filter(Boolean)

  return list
    .map((item) => ({
      item,
      score: score(item, normalized, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 8)
    .map((entry) => entry.item)
}

function score(item: Skill.Info, normalized: string, tokens: string[]) {
  const haystack = normalize(`${item.name} ${item.description}`)
  const name = normalize(item.name)
  if (name === normalized) return 1000

  const tokenScore = tokens.reduce((sum, token) => {
    if (name.startsWith(token)) return sum + 40
    if (name.includes(token)) return sum + 24
    if (haystack.includes(token)) return sum + 12
    return sum
  }, 0)

  if (name.startsWith(normalized)) return 800 + tokenScore
  if (name.includes(normalized)) return 600 + tokenScore
  if (haystack.includes(normalized)) return 400 + tokenScore
  return tokenScore
}

function normalize(input: string) {
  return input.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
}

function shouldListAvailableSkills(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return true

  const normalized = normalize(trimmed)
  if (normalized === "skill" || normalized === "skills") return true
  if (normalized.includes("available skill")) return true
  if (normalized.includes("skill list")) return true
  if (normalized.includes("list skill")) return true
  if (trimmed.includes("可用") && (trimmed.includes("技能") || trimmed.includes("skill"))) return true
  if (trimmed.includes("哪些") && (trimmed.includes("技能") || trimmed.includes("skill"))) return true
  if (trimmed.includes("列表") && (trimmed.includes("技能") || trimmed.includes("skill"))) return true
  if (trimmed.includes("全部") && (trimmed.includes("技能") || trimmed.includes("skill"))) return true
  return false
}
