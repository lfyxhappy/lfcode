import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect, Layer, Context } from "effect"
import { NamedError } from "@lfcode-ai/shared/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { Flag } from "@/flag/flag"
import { Permission } from "@/permission"
import { AppFileSystem } from "@/filesystem"
import { ConfigMarkdown } from "../config"
import { Glob } from "@lfcode-ai/shared/util/glob"
import { Log } from "../util"
import { extractLfcodeBundle } from "./lfcode/extract"
import { globalSkillRoot } from "./global-directory"
import type { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "skill" })
const SKILL_PATTERN = "**/SKILL.md"
/**
 * The catalog never embeds Skill bodies, but an explicit tool load still has
 * to fit safely within a single model turn. Larger bodies must be split into
 * a concise SKILL.md plus on-demand references instead of being truncated.
 */
export const MAX_BODY_BYTES = 256 * 1024

export const Name = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
export const Description = z.string().trim().min(1).max(1024)
export const Frontmatter = z.object({
  name: Name,
  description: Description,
}).strict()

export const Info = Frontmatter.extend({
  location: z.string(),
  content: z.string(),
})
export type Info = z.infer<typeof Info>

export const InvalidError = NamedError.create(
  "SkillInvalidError",
  z.object({
    path: z.string(),
    message: z.string().optional(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
  }),
)

export const NameMismatchError = NamedError.create(
  "SkillNameMismatchError",
  z.object({
    path: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
)

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
  pluginSkills: Map<string, Info[]>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  /**
   * `permission` is the already-merged effective ruleset when the caller has
   * session or temporary overrides. Passing it is deliberately preferred over
   * checking `agent.permission` alone: catalog discovery must not advertise a
   * Skill that the subsequent tool call is guaranteed to reject.
   */
  readonly available: (agent?: Agent.Info, permission?: Permission.Ruleset) => Effect.Effect<Info[]>
  readonly refresh: () => Effect.Effect<void>
  readonly registerPluginSkills: (input: { pluginID: string; skills: Info[] }) => Effect.Effect<void>
  readonly unregisterPluginSkills: (pluginID: string) => Effect.Effect<void>
  readonly clearPluginSkills: () => Effect.Effect<void>
}

const add = Effect.fnUntraced(function* (state: State, match: string, bus: Bus.Interface) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  const parsed = Frontmatter.safeParse(md.data)
  if (!parsed.success) {
    log.warn("invalid skill frontmatter", { skill: match, issues: parsed.error.issues })
    return
  }

  if (state.skills[parsed.data.name]) {
    log.warn("duplicate skill name", {
      name: parsed.data.name,
      existing: state.skills[parsed.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  state.skills[parsed.data.name] = {
    name: parsed.data.name,
    description: parsed.data.description,
    location: match,
    content: md.content,
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        // Managed skills must be real files beneath the managed root. Following a
        // link here can silently re-import an entire external skill catalog.
        symlink: false,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches.toSorted()) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (fsys: AppFileSystem.Interface, _directory: string, _worktree: string) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  if (!Flag.LFCODE_DISABLE_LFCODE_SKILLS) {
    const lfcodeSkillRoot = yield* extractLfcodeBundle(fsys).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (lfcodeSkillRoot && (yield* fsys.isDir(lfcodeSkillRoot))) {
      yield* scan(state, lfcodeSkillRoot, SKILL_PATTERN, { scope: "lfcode" })
    }
  }

  if (yield* fsys.isDir(globalSkillRoot())) {
    yield* scan(state, globalSkillRoot(), SKILL_PATTERN, { scope: "global" })
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  // Discovery order encodes precedence: managed Skills intentionally override bundled Skills.
  for (const match of discovered.matches) yield* add(state, match, bus)

  log.info("init", { count: Object.keys(state.skills).length })
})

const rebuildSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  state.skills = {}
  state.dirs = new Set()
  yield* loadSkills(state, discovered, bus)

  for (const [pluginID, skills] of state.pluginSkills) {
    for (const item of skills) {
      const existing = state.skills[item.name]
      if (existing) {
        log.warn("plugin skill name is already claimed", {
          pluginID,
          name: item.name,
          existing: existing.location,
          skipped: item.location,
        })
        continue
      }
      state.dirs.add(path.dirname(item.location))
      state.skills[item.name] = item
    }
  }
})

export class Service extends Context.Service<Service, Interface>()("@lfcode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const fsys = yield* AppFileSystem.Service
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(fsys, ctx.directory, ctx.worktree)
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* (ctx) {
        const s: State = { skills: {}, dirs: new Set(), pluginSkills: new Map() }
        yield* rebuildSkills(s, yield* InstanceState.get(discovered), bus)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return Array.from((yield* InstanceState.get(state)).dirs)
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info, permission?: Permission.Ruleset) {
      const s = yield* InstanceState.get(state)
      let list: Info[] = Object.values(s.skills)

      list = list.toSorted((a, b) => a.name.localeCompare(b.name))
      const ruleset = permission ?? agent?.permission
      if (!ruleset) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, ruleset).action !== "deny")
    })

    const refresh = Effect.fn("Skill.refresh")(function* () {
      yield* InstanceState.invalidate(discovered)
      const s = yield* InstanceState.get(state)
      yield* rebuildSkills(s, yield* InstanceState.get(discovered), bus)
    })

    const registerPluginSkills = Effect.fn("Skill.registerPluginSkills")(function* (input: { pluginID: string; skills: Info[] }) {
      const s = yield* InstanceState.get(state)
      s.pluginSkills.set(input.pluginID, [...input.skills])
      yield* rebuildSkills(s, yield* InstanceState.get(discovered), bus)
    })

    const unregisterPluginSkills = Effect.fn("Skill.unregisterPluginSkills")(function* (pluginID: string) {
      const s = yield* InstanceState.get(state)
      if (!s.pluginSkills.delete(pluginID)) return
      yield* rebuildSkills(s, yield* InstanceState.get(discovered), bus)
    })

    const clearPluginSkills = Effect.fn("Skill.clearPluginSkills")(function* () {
      const s = yield* InstanceState.get(state)
      if (s.pluginSkills.size === 0) return
      s.pluginSkills.clear()
      yield* rebuildSkills(s, yield* InstanceState.get(discovered), bus)
    })

    return Service.of({ get, all, dirs, available, refresh, registerPluginSkills, unregisterPluginSkills, clearPluginSkills })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
)

function normalizeTriggerText(input: string) {
  return input
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function rankForText(list: Info[], text: string, limit = Number.POSITIVE_INFINITY) {
  const normalizedText = normalizeTriggerText(text)
  if (!normalizedText) return [] as Array<{ skill: Info; score: number }>

  return list
    .map((skill) => {
      const name = normalizeTriggerText(skill.name)
      const matchedTrigger = activationPhrases(skill.description).find((phrase) => normalizedText.includes(phrase))
      const score = (name && normalizedText.includes(name) ? 320 : 0) + (matchedTrigger ? 180 + matchedTrigger.length : 0)
      return { skill, score }
    })
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
}

/**
 * Skill activation is durable conversation state: a successful exact `skill`
 * call writes its `<skill_content>` payload into the tool result. Extension
 * tools can use this to appear only after their operational instructions have
 * been supplied to the model, without adding a separate per-session cache.
 */
export function activeNames(messages: MessageV2.WithParts[]) {
  const names = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== "skill" || part.state.status !== "completed") continue
      const output = part.state.output
      if (typeof output !== "string") continue
      for (const match of output.matchAll(/<skill_content\s+name=(?:"([^"]+)"|'([^']+)')>/g)) {
        const name = match[1] ?? match[2]
        if (name) names.add(name)
      }
    }
  }
  return [...names].sort()
}

function activationPhrases(description: string) {
  return [
    ...Array.from(description.matchAll(/(?:用户提到|用户说|用户请求|用户要求)\s*(.+?)\s*时(?:使用|启用)/gu)).flatMap((match) =>
      match[1]?.split(/[、,，/]|或|以及|及|和/g) ?? [],
    ),
    ...Array.from(description.matchAll(/(?:use when|trigger for)\s+(?:(?:the\s+)?user\s+)?(?:asks?|requests?|needs?|wants?|mentions?)?\s*(?:to\s+|for\s+)?(.+?)(?=[.;]|$)/giu)).flatMap(
      (match) => match[1]?.split(/[,/]|\bor\b|\band\b/giu) ?? [],
    ),
    ...Array.from(description.matchAll(/use for\s+(.+?)(?=[.;]|$)/giu)).flatMap((match) => match[1]?.split(/[,/]|\bor\b|\band\b/giu) ?? []),
  ]
    .map(normalizeTriggerText)
    .filter((phrase) => isSpecificActivationPhrase(phrase))
}

function isSpecificActivationPhrase(phrase: string) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(phrase)) return Array.from(phrase).length >= 2
  return phrase
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !new Set(["a", "an", "the", "for", "to", "user", "task", "tasks"]).has(word)).length >= 2
}

export function fmt(list: Info[], opts: { verbose: boolean; max?: number; descriptionLimit?: number }) {
  if (list.length === 0) return "No skills are currently available."
  const sorted = list.toSorted((a, b) => a.name.localeCompare(b.name))
  const items = opts.max === undefined ? sorted : sorted.slice(0, opts.max)
  const remaining = sorted.length - items.length
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...items.flatMap((skill) => [
          "  <skill>",
          `    <name>${escapeXmlText(skill.name)}</name>`,
          `    <description>${escapeXmlText(formatDescription(skill.description, opts.descriptionLimit))}</description>`,
          `    <location>${escapeXmlText(pathToFileURL(skill.location).href)}</location>`,
          "  </skill>",
        ]),
      ...(remaining > 0 ? [`  <truncated>${remaining} more Skills are available; search with the skill tool by keyword.</truncated>`] : []),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "<available_skills>",
    ...items.flatMap((skill) => [
      "  <skill>",
      `    <name>${escapeXmlText(skill.name)}</name>`,
      `    <description>${escapeXmlText(formatDescription(skill.description, opts.descriptionLimit))}</description>`,
      "  </skill>",
    ]),
    ...(remaining > 0
      ? [`  <truncated>${remaining} more Skills are available; search with the skill tool by keyword.</truncated>`]
      : []),
    "</available_skills>",
  ].join("\n")
}

function formatDescription(value: string, limit?: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (limit === undefined || normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/** Wrap untrusted metadata in an XML text node without allowing it to create markup. */
export function escapeXmlText(value: string) {
  return value.replace(/[&<>]/g, (char) => {
    if (char === "&") return "&amp;"
    if (char === "<") return "&lt;"
    return "&gt;"
  })
}

/** XML attribute values need the text escaping above plus quote escaping. */
export function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/["']/g, (char) => (char === '"' ? "&quot;" : "&apos;"))
}

export * as Skill from "."

