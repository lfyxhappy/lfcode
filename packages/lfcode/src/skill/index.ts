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
import { extractComposeBundle } from "./compose/extract"
import { extractLfcodeBundle } from "./lfcode/extract"
import { globalSkillRoot, migrateExternalGlobalSkills } from "./global-directory"

const log = Log.create({ service: "skill" })
const SKILL_PATTERN = "**/SKILL.md"

export const Info = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
  triggers: z.array(z.string()).optional(),
  hidden: z.boolean().optional(),
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
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly refresh: () => Effect.Effect<void>
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

  const parsed = Info.pick({
    name: true,
    description: true,
    triggers: true,
    hidden: true,
  })
    .extend({
      triggers: z.array(z.string()).or(z.string().transform((value) => [value])).optional(),
    })
    .safeParse(md.data)
  if (!parsed.success) return

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
    triggers: normalizeTriggers(
      parsed.data.triggers?.length
        ? parsed.data.triggers
        : inferTriggersFromDescription(parsed.data.description),
    ),
    hidden: parsed.data.hidden,
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
        symlink: true,
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

  for (const match of matches) {
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

  // Extract compose skills to disk first (user skills with same name override).
  if (!Flag.LFCODE_DISABLE_COMPOSE_SKILLS) {
    const composeSkillRoot = yield* extractComposeBundle(fsys).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (composeSkillRoot && (yield* fsys.isDir(composeSkillRoot))) {
      yield* scan(state, composeSkillRoot, SKILL_PATTERN, { scope: "compose" })
    }
  }

  yield* Effect.tryPromise({
    try: migrateExternalGlobalSkills,
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      log.warn("failed to migrate external global skills", { error })
      return Effect.void
    }),
  )

  if (yield* fsys.isDir(globalSkillRoot())) {
    yield* scan(state, globalSkillRoot(), SKILL_PATTERN, { scope: "global" })
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, bus), {
    concurrency: "unbounded",
    discard: true,
  })

  log.info("init", { count: Object.keys(state.skills).length })
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
        const s: State = { skills: {}, dirs: new Set() }
        yield* loadSkills(s, yield* InstanceState.get(discovered), bus)
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
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      let list: Info[] = Object.values(s.skills)
        .filter((sk) => !sk.hidden)

      list = list.toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    const refresh = Effect.fn("Skill.refresh")(function* () {
      yield* InstanceState.invalidate(discovered)
      yield* InstanceState.invalidate(state)
    })

    return Service.of({ get, all, dirs, available, refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
)

function normalizeTriggers(input: string[]) {
  return input
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
}

function inferTriggersFromDescription(description: string) {
  return Array.from(description.matchAll(/当用户(?:提到|要求|说|输入)?(.+?)时使用/gi))
    .flatMap((match) => match[1]?.split(/[、，,；;]+/g) ?? [])
    .map((item) =>
      item
        .replace(/^[:：\s]+/, "")
        .replace(/[。！!？?]+$/g, "")
        .trim(),
    )
    .filter((item) => item.length >= 2)
}

function normalizeTriggerText(input: string) {
  return input
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isWordLikeTrigger(input: string) {
  return /^[a-z0-9][a-z0-9 _-]*$/i.test(input)
}

export function triggerTerms(skill: Pick<Info, "name" | "description" | "triggers">) {
  const triggers = skill.triggers?.length ? skill.triggers : inferTriggersFromDescription(skill.description)
  return normalizeTriggers(triggers)
}

export function matchesTriggerText(skill: Pick<Info, "name" | "description" | "triggers">, text: string) {
  const normalizedText = normalizeTriggerText(text)
  if (!normalizedText) return false

  return triggerTerms(skill).some((trigger) => {
    const normalizedTrigger = normalizeTriggerText(trigger)
    if (!normalizedTrigger) return false
    if (!isWordLikeTrigger(normalizedTrigger)) return normalizedText.includes(normalizedTrigger)
    const escaped = normalizedTrigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalizedText)
  })
}

export function fmt(list: Info[], opts: { verbose: boolean }) {
  if (list.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...list
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...list
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

export * as Skill from "."

