import { Cause, Effect, Exit } from "effect"
import { ensureManagedPythonCommand } from "@/python/environment"
import { setRuntimeActivationTarget } from "./config"
import { getRuntimeManageState } from "./detect"
import { installManagedCppCompiler, repairManagedCppCompiler } from "./cpp"
import { installManagedJavaArtifact, repairManagedJavaArtifact } from "./java"
import { recordRuntimeOperationLog, runtimeOperationTitle } from "./log"
import { installManagedOfficeCli, repairManagedOfficeCli, updateManagedOfficeCli } from "./officecli"
import { installManagedVoiceArtifact, repairManagedVoiceArtifact } from "./voice"
import { type RuntimeManageItemID, type RuntimeOperationAction } from "./types"

export const installRuntime = Effect.fn("RuntimeRegistry.installRuntime")(function* (
  id: RuntimeManageItemID,
) {
  return yield* runRuntimeMutation("install", id, installRuntimeEffect(id))
})

export const repairRuntime = Effect.fn("RuntimeRegistry.repairRuntime")(function* (
  id: RuntimeManageItemID,
) {
  return yield* runRuntimeMutation("repair", id, repairRuntimeEffect(id))
})

export const updateRuntime = Effect.fn("RuntimeRegistry.updateRuntime")(function* (
  id: RuntimeManageItemID,
) {
  return yield* runRuntimeMutation("update", id, updateRuntimeEffect(id))
})

export const activateRuntime = Effect.fn("RuntimeRegistry.activateRuntime")(function* (
  id: RuntimeManageItemID,
  target: string,
) {
  return yield* runRuntimeMutation("activate", id, activateRuntimeEffect(id, target))
})

export const installRuntimeSupportsManaged = new Set<RuntimeManageItemID>([
  "python-managed",
  "voice-recorder",
  "ffmpeg",
  "cpp-compiler",
  "java-runtime",
  "java-sdk",
  "officecli",
])

export const repairRuntimeSupportsManaged = new Set<RuntimeManageItemID>([
  "python-managed",
  "voice-recorder",
  "ffmpeg",
  "cpp-compiler",
  "java-runtime",
  "java-sdk",
  "officecli",
])

const runRuntimeMutation = Effect.fn("RuntimeRegistry.runRuntimeMutation")(function* (
  action: RuntimeOperationAction,
  id: RuntimeManageItemID,
  execute: Effect.Effect<{ message: string; sourceLabel?: string }, unknown>,
) {
  const exit = yield* Effect.exit(execute)
  if (Exit.isSuccess(exit)) {
    yield* Effect.promise(() =>
      recordRuntimeOperationLog({
        id,
        action,
        status: "success",
        title: runtimeOperationTitle(id, action),
        message: exit.value.message,
        sourceLabel: exit.value.sourceLabel,
      }),
    )
    return {
      message: exit.value.message,
      state: yield* Effect.promise(() => getRuntimeManageState()),
    }
  }
  yield* Effect.promise(() =>
    recordRuntimeOperationLog({
      id,
      action,
      status: "failed",
      title: runtimeOperationTitle(id, action),
      message: Cause.pretty(exit.cause),
    }),
  )
  return yield* Effect.failCause(exit.cause)
})

const installRuntimeEffect = Effect.fn("RuntimeRegistry.installRuntimeEffect")(function* (id: RuntimeManageItemID) {
  if (id === "python-managed") {
    yield* ensureManagedPythonCommand()
    return {
      message: "Python 受管环境已初始化。",
    }
  }

  if (id === "java-runtime") {
    const result = yield* Effect.promise(() => installManagedJavaArtifact("java-runtime"))
    return {
      message: `Java 运行时已安装${result.sourceLabel ? `，来源：${result.sourceLabel}` : ""}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "java-sdk") {
    const result = yield* Effect.promise(() => installManagedJavaArtifact("java-sdk"))
    return {
      message: `Java SDK 已安装${result.sourceLabel ? `，来源：${result.sourceLabel}` : ""}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "voice-recorder") {
    const result = yield* Effect.promise(() => installManagedVoiceArtifact("voice-recorder"))
    return {
      message: `录音器已安装${result.sourceLabel ? `，来源：${result.sourceLabel}` : ""}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "ffmpeg") {
    const result = yield* Effect.promise(() => installManagedVoiceArtifact("ffmpeg"))
    return {
      message: `FFmpeg 已安装${result.sourceLabel ? `，来源：${result.sourceLabel}` : ""}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "cpp-compiler") {
    const result = yield* Effect.promise(() => installManagedCppCompiler())
    return {
      message: `C++ 编译器已安装${result.sourceLabel ? `，来源：${result.sourceLabel}` : ""}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "officecli") {
    const result = yield* Effect.promise(() => installManagedOfficeCli())
    return {
      message: result.reused ? `OfficeCLI ${result.version} 已可用。` : `OfficeCLI ${result.version} 已安装。`,
      sourceLabel: result.sourceLabel,
    }
  }

  throw new Error(`Runtime ${id} does not support managed install yet.`)
})

const repairRuntimeEffect = Effect.fn("RuntimeRegistry.repairRuntimeEffect")(function* (id: RuntimeManageItemID) {
  if (id === "python-managed") {
    yield* ensureManagedPythonCommand()
    return {
      message: "Python 受管环境已检查并修复。",
    }
  }

  if (id === "java-runtime") {
    const result = yield* Effect.promise(() => repairManagedJavaArtifact("java-runtime"))
    return {
      message: result.reused ? "Java 运行时环境已刷新并校验。" : `Java 运行时已修复并重装，来源：${result.sourceLabel ?? "受管源"}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "java-sdk") {
    const result = yield* Effect.promise(() => repairManagedJavaArtifact("java-sdk"))
    return {
      message: result.reused ? "Java SDK 环境已刷新并校验。" : `Java SDK 已修复并重装，来源：${result.sourceLabel ?? "受管源"}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "voice-recorder") {
    const result = yield* Effect.promise(() => repairManagedVoiceArtifact("voice-recorder"))
    return {
      message: result.reused ? "录音器环境已刷新并校验。" : `录音器已修复并重装，来源：${result.sourceLabel ?? "受管源"}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "ffmpeg") {
    const result = yield* Effect.promise(() => repairManagedVoiceArtifact("ffmpeg"))
    return {
      message: result.reused ? "FFmpeg 环境已刷新并校验。" : `FFmpeg 已修复并重装，来源：${result.sourceLabel ?? "受管源"}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "cpp-compiler") {
    const result = yield* Effect.promise(() => repairManagedCppCompiler())
    return {
      message: result.reused ? "C++ 编译器环境已刷新并校验。" : `C++ 编译器已修复并重装，来源：${result.sourceLabel ?? "受管源"}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  if (id === "officecli") {
    const result = yield* Effect.promise(() => repairManagedOfficeCli())
    return {
      message: result.reused ? "OfficeCLI 已检查并继续使用当前版本。" : `OfficeCLI 已修复，当前版本：${result.version}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  throw new Error(`Runtime ${id} does not support repair yet.`)
})

const updateRuntimeEffect = Effect.fn("RuntimeRegistry.updateRuntimeEffect")(function* (id: RuntimeManageItemID) {
  if (id === "officecli") {
    const result = yield* Effect.promise(() => updateManagedOfficeCli())
    return {
      message: result.reused ? `OfficeCLI 已是最新受管版本（${result.version}）。` : `OfficeCLI 已更新到 ${result.version}。`,
      sourceLabel: result.sourceLabel,
    }
  }

  throw new Error(`Runtime ${id} does not support managed updates yet.`)
})

const activateRuntimeEffect = Effect.fn("RuntimeRegistry.activateRuntimeEffect")(function* (
  id: RuntimeManageItemID,
  target: string,
) {
  const state = yield* Effect.promise(() => getRuntimeManageState())
  const item = state.items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Runtime ${id} does not exist.`)
  if (!item.actions.activate) throw new Error(`Runtime ${id} does not support activation switching yet.`)
  const matched = item.targets.find((candidate) => candidate.id === target)
  if (!matched) throw new Error(`Runtime ${id} does not have activation target ${target}.`)
  yield* Effect.promise(() => setRuntimeActivationTarget(id, target))
  return {
    message: `已切换到${matched.label}。`,
    sourceLabel: matched.label,
  }
})
