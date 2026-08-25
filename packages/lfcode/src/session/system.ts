import { Context, Effect, Layer } from "effect"

import { Instance } from "../project/instance"

import PROMPT_DEFAULT from "./prompt/default.txt"
import type { Provider } from "@/provider"
import type { Agent } from "@/agent/agent"
import { inferModelCapabilities } from "@lfcode-ai/shared/model-capabilities"
import { Permission } from "@/permission"
import { managedPythonPackageSummary } from "@/python/managed-packages"

export function editingStrategy(patchEditing: boolean) {
  return [
    patchEditing
      ? "Use the single edit tool: operation=replace for one exact current text block, operation=patch for multiple hunks/files, and operation=write only for an intentional whole-file replacement or new file."
      : "Use the single edit tool: operation=replace for one exact current text block, operation=patch for multiple hunks/files, and operation=write only for an intentional whole-file replacement or new file.",
    "Before changing an existing file, read its current content. After any edit failure, do not reuse guessed or stale context: perform a fresh read, then make one corrected edit.",
    "For a long single line, call read with offset, limit=1, startChar, and endChar to obtain exact current content before edit operation=replace.",
    "Never bypass a failed structured edit by using shell or Python to write the same file.",
  ].join("\n")
}

export function provider(model: Provider.Model) {
  const patchEditing =
    model.capabilities.patch_editing ??
    inferModelCapabilities({
      modelID: String(model.api.id),
    }).patch_editing
  return [PROMPT_DEFAULT, editingStrategy(patchEditing)]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => string[]
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() =>
    Service.of({
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
            `- Start from the user's current request and the context already available. Do not use task, actor, or memory as a startup or resume ritual.`,
            `- Choose the smallest, most specific tool action that can change the next decision. Let each subsequent action be informed by real tool results, not a fixed checklist.`,
            `- Verify changes in proportion to their risk; inspection, editing, and verification are not mandatory phases for every request.`,
            `- Saved memory is available only when the user explicitly asks to search, recall, or inspect it. The sole exception is a valid <context_review> hand-off for a related follow-up: then you must use the memory tool to search only its listed query before relying on Memory. Do not use Memory as an implicit planning or recovery step.`,
            `- For web research, use native_web_search first when it is available. If it fails or has no verifiable URL citations, use websearch to follow the configured direct or browser discovery route. Use Exa or Parallel only when the user explicitly selects a configured compatibility provider.`,
            `- For structured code questions (architecture, symbols, call chains, impact, refactoring, or debugging), use codegraph_explore first when it is available; use Read/Grep for exact text, logs, configuration, documentation, and unindexed files.`,
            `- When you choose the Python tool, note that Lfcode's managed Python environment already preinstalls these common packages: ${managedPythonPackageSummary()}. Prefer using them directly before installing duplicates.`,
          ].join("\n"),
        ]
      },

      skills: (agent) =>
        Permission.disabled(["skill"], agent.permission).has("skill")
          ? Effect.succeed(undefined)
          : Effect.succeed(
              [
                "The request context includes an <available_skills> catalog with every currently usable Skill name and standard description. Skill bodies are not active until you load them.",
                "Before any substantive answer or non-Skill tool action, compare the current request and relevant conversation context against that catalog. When a specialized workflow would materially help, you MUST call skill with the exact name and load all relevant Skills before proceeding. Do not skip a relevant Skill merely because you could attempt the task without it.",
                "Treat explicit /skill-name requests as mandatory. For normal requests, evaluate semantic, multilingual, synonym, and context-dependent matches rather than requiring an exact keyword. Use skill with `可用技能` only when the catalog is unavailable.",
                "Never use search_tool to find Skills: it searches extension tools only, not installed Skill instruction bundles.",
              ].join("\n"),
            ),
    })
  ),
)

export const defaultLayer = layer

export * as SystemPrompt from "./system"
