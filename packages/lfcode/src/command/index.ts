import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { EffectBridge } from "@/effect"
import type { InstanceContext } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { Config } from "../config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: BusEvent.define(
    "command.executed",
    z.object({
      name: z.string(),
      sessionID: SessionID.zod,
      arguments: z.string(),
      messageID: MessageID.zod,
    }),
  ),
}

export const Info = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    source: z.enum(["command", "mcp", "skill"]).optional(),
    // workaround for zod not supporting async functions natively so we use getters
    // https://zod.dev/v4/changelog?id=zfunction
    template: z.promise(z.string()).or(z.string()),
    subtask: z.boolean().optional(),
    hints: z.array(z.string()),
  })
  .meta({
    ref: "Command",
  })

// for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

/**
 * Public command discovery is metadata-only. Command templates may include
 * arbitrary local instructions, and must never be serialized by `/command`.
 */
export const PublicInfo = Info.omit({ template: true })
export type PublicInfo = z.infer<typeof PublicInfo>

export function publicInfo(info: Info): PublicInfo {
  return {
    name: info.name,
    ...(info.description ? { description: info.description } : {}),
    ...(info.agent ? { agent: info.agent } : {}),
    ...(info.model ? { model: info.model } : {}),
    ...(info.source ? { source: info.source } : {}),
    ...(info.subtask !== undefined ? { subtask: info.subtask } : {}),
    hints: info.hints,
  }
}

/**
 * `/command` is global and has no session or temporary permission scope.
 * Skill slash commands must therefore stay out of this response: advertising
 * them here could disclose a Skill that the next session-local load denies.
 */
export function publicList(commands: Info[]) {
  return commands.filter((command) => command.source !== "skill").map(publicInfo)
}

/**
 * Session command lookup has no permission-aware command catalog. Never use
 * the global slash-Skill list as an "unknown command" hint: doing so would
 * disclose Skill names that may be denied by the current session rules.
 * Explicit Skill discovery remains available through the permission-filtered
 * `skill` tool and the request-local Skill catalog.
 */
export function unknownCommandHints(commands: Info[]) {
  return commands.filter((command) => command.source !== "skill").map((command) => command.name)
}

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
  DREAM: "dream",
  DISTILL: "distill",
  GOAL: "goal",
  DEEP_RESEARCH: "deep-research",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Command") {}

function skillCommand(item: Skill.Info): Info {
  return {
    name: item.name,
    description: item.description,
    ...(item.name === Default.DEEP_RESEARCH ? { agent: "deep-research-coordinator", subtask: true } : {}),
    source: "skill",
    // This value is deliberately resolved from the current Skill state rather
    // than retained in Command state. A create/update/delete followed by
    // Skill.refresh() must take effect for the next slash command immediately.
    get template() {
      return item.content
    },
    hints: [],
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }
      commands[Default.DREAM] = {
        name: Default.DREAM,
        description: "manually consolidate project memory through typed records and compatible projections",
        agent: "dream",
        source: "command",
        subtask: false,
        get template() {
          return [
            "Run one manual dream memory consolidation pass for the current project.",
            "",
            "User focus or constraints:",
            "$ARGUMENTS",
            "",
            "Use raw lfcode trajectory as the source of truth. Memory Markdown is only a compatibility projection of typed records.",
            "Use the terminal tool for read-only SQLite and filesystem inspection. On Windows, use pwsh syntax. Do not modify the database.",
            "Do not edit memory files directly. Consolidate only durable, verified information with memory(operation=write_project_record), using a complete MEMORY or MEMORY-<topic> body.",
          ].join("\n")
        },
        hints: ["$ARGUMENTS"],
      }
      commands[Default.DISTILL] = {
        name: Default.DISTILL,
        description: "find repeated workflows in recent work and add reviewable packaging candidates",
        agent: "distill",
        source: "command",
        subtask: false,
        get template() {
          return [
            "Run one manual distill pass for the current project.",
            "",
            "User focus or constraints:",
            "$ARGUMENTS",
            "",
            "Look back over recent work and identify repeated manual workflows worth packaging.",
            "Use the raw lfcode trajectory database as the source of truth and memory files to spot cross-session patterns.",
            "Inventory existing skills, agents, and commands first so you reuse or extend instead of duplicating.",
            "Use the terminal tool for read-only SQLite and filesystem inspection. On Windows, use pwsh syntax. Do not modify the database.",
            "Do not create, edit, or delete assets. Produce a compact, reviewable JSON candidate shortlist only.",
          ].join("\n")
        },
        hints: ["$ARGUMENTS"],
      }
      commands[Default.GOAL] = {
        name: Default.GOAL,
        description: "set a stop-condition goal; runs until a judge says it's met. /goal clear to abort",
        source: "command",
        subtask: false,
        get template() {
          return "$ARGUMENTS"
        },
        hints: ["$ARGUMENTS"],
      }
      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const command = s.commands[name]
      if (command) return command
      const item = yield* skill.get(name)
      return item ? skillCommand(item) : undefined
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      const configured = Object.values(s.commands)
      const names = new Set(configured.map((command) => command.name))
      const skills = (yield* skill.all()).filter((item) => !names.has(item.name)).map(skillCommand)
      return [...configured, ...skills]
    })

    return Service.of({ get, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Command from "."
