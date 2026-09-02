import type { SessionGoal } from "@/context/global-sync/types"
import { formatTokenCount } from "@lfcode-ai/shared/token-format"

export function formatGoalElapsed(ms?: number) {
  if (!ms || ms <= 0) return "0m"
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(1, minutes)}m`
}

export function goalElapsedMs(goal?: SessionGoal["state"], now = Date.now()) {
  const elapsed = goal?.stats?.elapsed ?? 0
  const activeSince = goal?.stats?.activeSince
  if (goal?.status !== "active" || !activeSince) return elapsed
  return elapsed + Math.max(0, now - activeSince)
}

export function formatGoalTokens(goal?: SessionGoal["state"]) {
  const stats = goal?.stats?.tokens
  if (!stats) return "0"
  return formatTokenCount((stats.input ?? 0) + (stats.output ?? 0) + (stats.reasoning ?? 0))
}

export function goalStatusText(status?: SessionGoal["state"] extends { status?: infer T } ? T : string) {
  if (status === "paused") return "已暂停"
  if (status === "blocked") return "已阻塞"
  if (status === "complete") return "已完成"
  if (status === "cleared") return "已清除"
  if (status === "active") return "进行中"
  return "未设置"
}
