import { existsSync, readFileSync } from "fs"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util"
import { type RuntimeManageItemID } from "./types"

type RuntimeActivationConfig = {
  active_targets?: Partial<Record<RuntimeManageItemID, string>>
}

let cachedConfig: RuntimeActivationConfig | undefined

export function runtimeActivationConfigPath() {
  return path.join(Global.Path.config, "runtime.json")
}

export function getRuntimeActivationTarget(id: RuntimeManageItemID) {
  return loadRuntimeActivationConfig().active_targets?.[id]
}

export async function setRuntimeActivationTarget(id: RuntimeManageItemID, target: string | undefined) {
  const current = loadRuntimeActivationConfig()
  const nextTargets = {
    ...(current.active_targets ?? {}),
  }
  if (target) nextTargets[id] = target
  else delete nextTargets[id]
  const next: RuntimeActivationConfig = Object.keys(nextTargets).length ? { active_targets: nextTargets } : {}
  cachedConfig = next
  await Filesystem.writeJson(runtimeActivationConfigPath(), next)
}

function loadRuntimeActivationConfig() {
  if (cachedConfig) return cachedConfig
  const file = runtimeActivationConfigPath()
  if (!existsSync(file)) {
    cachedConfig = {}
    return cachedConfig
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RuntimeActivationConfig
    cachedConfig = sanitizeRuntimeActivationConfig(parsed)
    return cachedConfig
  } catch {
    cachedConfig = {}
    return cachedConfig
  }
}

function sanitizeRuntimeActivationConfig(value: RuntimeActivationConfig) {
  if (!value?.active_targets || typeof value.active_targets !== "object") return {}
  const active_targets = Object.fromEntries(
    Object.entries(value.active_targets).filter((entry): entry is [RuntimeManageItemID, string] => typeof entry[1] === "string"),
  )
  return Object.keys(active_targets).length ? { active_targets } : {}
}
