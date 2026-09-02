import { Layer, ManagedRuntime } from "effect"
import { attach } from "./run-service"
import * as Observability from "./observability"

import { AppFileSystem } from "@/filesystem"
import { Bus } from "@/bus"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Storage } from "@/storage"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider"
import { ProviderAuth } from "@/provider"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Todo } from "@/session/todo"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { Goal } from "@/session/goal"
import { SessionProcessor } from "@/session/processor"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrune } from "@/session/prune"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { SessionCheckpoint } from "@/session/checkpoint"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import * as McpCatalog from "@/mcp/catalog"
import { Command } from "@/command"
import { Truncate } from "@/tool"
import { ToolRegistry } from "@/tool"
import { Format } from "@/format"
import { Project } from "@/project"
import { Vcs } from "@/project"
import { Worktree } from "@/worktree"
import { Pty } from "@/pty"
import { ClaudeCode } from "@/claude-code"
import { Installation } from "@/installation"
import { ShareNext } from "@/share"
import { SessionShare } from "@/share"
import { Npm } from "@/npm"
import { ActorRegistry } from "@/actor/registry"
import { ActorWaiter } from "@/actor/waiter"
import { ActorDispatch } from "@/actor/dispatch"
import { Actor } from "@/actor/spawn"
import { TaskRegistry } from "@/task/registry"
import { History } from "@/history"
import { Memory } from "@/memory"
import { ContextReview } from "@/context-review"
import { Activity } from "@/activity"
import * as BashInteractive from "@/tool/bash-interactive"
import { defaultLayer as ShellBackgroundRuntimeLayer } from "@/background-job/runtime"
import { memoMap } from "./memo-map"

// Wrapped in Layer.suspend so the cross-module `.defaultLayer` reads defer to
// first use instead of running at module load — same TDZ fix as Actor.defaultLayer.
export const AppLayer = Layer.suspend(() =>
  Layer.mergeAll(
    Layer.mergeAll(
      Npm.defaultLayer,
      AppFileSystem.defaultLayer,
      Bus.defaultLayer,
      Auth.defaultLayer,
      Account.defaultLayer,
      Config.defaultLayer,
      Git.defaultLayer,
      Ripgrep.defaultLayer,
      File.defaultLayer,
      FileWatcher.defaultLayer,
      Storage.defaultLayer,
      Plugin.defaultLayer,
      Provider.defaultLayer,
      ProviderAuth.defaultLayer,
      Agent.defaultLayer,
      Skill.defaultLayer,
      Discovery.defaultLayer,
      Question.defaultLayer,
      Permission.defaultLayer,
      Todo.defaultLayer,
    ),
    Layer.mergeAll(
      Session.defaultLayer,
      Activity.defaultLayer,
      SessionStatus.defaultLayer,
      SessionRunState.defaultLayer,
      Goal.defaultLayer,
      SessionProcessor.defaultLayer,
      SessionCompaction.defaultLayer,
      SessionPrune.defaultLayer,
      SessionRevert.defaultLayer,
      SessionSummary.defaultLayer,
      SessionPrompt.defaultLayer,
      SessionCheckpoint.defaultLayer,
      Instruction.defaultLayer,
      LLM.defaultLayer,
      LSP.defaultLayer,
      MCP.defaultLayer,
      McpAuth.defaultLayer,
      McpCatalog.defaultLayer,
      Command.defaultLayer,
    ),
    Layer.mergeAll(
      Truncate.defaultLayer,
      ToolRegistry.defaultLayer,
      Format.defaultLayer,
      Project.defaultLayer,
      Vcs.defaultLayer,
      Worktree.defaultLayer,
      Pty.defaultLayer,
      ClaudeCode.layer.pipe(Layer.provide(Pty.defaultLayer)),
      Installation.defaultLayer,
      ShareNext.defaultLayer,
      SessionShare.defaultLayer,
      ActorRegistry.defaultLayer,
      ActorWaiter.defaultLayer,
      ActorDispatch.defaultLayer,
      Actor.defaultLayer,
      TaskRegistry.defaultLayer,
      Memory.defaultLayer,
      ContextReview.layer,
      History.defaultLayer,
      ShellBackgroundRuntimeLayer,
    ),
  ).pipe(Layer.provideMerge(Observability.layer), Layer.provideMerge(BashInteractive.defaultLayer)),
)

const rt = ManagedRuntime.make(AppLayer, { memoMap })
type Runtime = Pick<typeof rt, "runSync" | "runPromise" | "runPromiseExit" | "runFork" | "runCallback" | "dispose">
const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never

export const AppRuntime: Runtime = {
  runSync(effect) {
    return rt.runSync(wrap(effect))
  },
  runPromise(effect, options) {
    return rt.runPromise(wrap(effect), options)
  },
  runPromiseExit(effect, options) {
    return rt.runPromiseExit(wrap(effect), options)
  },
  runFork(effect) {
    return rt.runFork(wrap(effect))
  },
  runCallback(effect) {
    return rt.runCallback(wrap(effect))
  },
  dispose: () => rt.dispose(),
}

