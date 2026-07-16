import { Context, Effect, Layer } from "effect"

import { Instance } from "../project/instance"

import PROMPT_DEFAULT from "./prompt/default.txt"
import type { Provider } from "@/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { managedPythonPackageSummary } from "@/python/managed-packages"
import { Skill } from "@/skill"

export function provider(_model: Provider.Model) {
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => string[]
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment(model) {
        const project = Instance.project
        return [
          [
            `You are Lfcode, an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.`,
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${Instance.directory}`,
            `  Workspace root folder: ${Instance.worktree}`,
            `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          `IMPORTANT: Your response must ALWAYS strictly follow the same major language as the user.`,
          [
            `Default working style:`,
            `- For non-trivial work, prefer grounding decisions in the current codebase, config, logs, runtime state, and tool results.`,
            `- Avoid speculative claims when evidence is easy to gather.`,
            `- A good default loop is inspect -> confirm target -> edit -> verify, but use judgment based on the task.`,
            `- Use memory when cross-session context is actually useful, not as a mandatory checklist.`,
            `- When you choose the Python tool, note that Lfcode's managed Python environment already preinstalls these common packages: ${managedPythonPackageSummary()}. Prefer using them directly before installing duplicates.`,
          ].join("\n"),
        ]
      },

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return
        const list = yield* skill.available(agent)

        return [
          "Skills are optional instruction bundles for specialized tasks.",
          "The current installed skills are already listed in <available_skills>; if the user asks what skills are available, answer from that list directly.",
          "Use the skill tool to search by keywords first, then load the exact skill name you need.",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
