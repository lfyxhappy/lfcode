import { existsSync, statSync } from "fs"
import path from "path"
import { Global } from "@/global"
import type { Vcs } from "@/project"
import { compactFileDiffsForSummary } from "./file-diff"
import type { SessionID } from "./schema"

export const MAX_SESSION_DIFF_EVENT_FILES = 5000
export const MAX_SESSION_DIFF_EVENT_BYTES = 4 * 1024 * 1024
export const MAX_SESSION_DIFF_STORAGE_BYTES = 8 * 1024 * 1024

export function compactDiffsForStorage(diffs: Vcs.FileDiff[]) {
  if (estimateDiffBytes(diffs) <= MAX_SESSION_DIFF_STORAGE_BYTES) return diffs
  return compactFileDiffsForSummary(diffs)
}

export function shouldPublishDiffEvent(diffs: Vcs.FileDiff[]) {
  return diffs.length <= MAX_SESSION_DIFF_EVENT_FILES && estimateDiffBytes(diffs) <= MAX_SESSION_DIFF_EVENT_BYTES
}

export function estimateDiffBytes(diffs: Vcs.FileDiff[]) {
  return diffs.reduce(
    (sum, diff) =>
      sum +
      (diff.file?.length ?? 0) * 2 +
      (diff.patch?.length ?? 0) * 2 +
      String(diff.additions).length * 2 +
      String(diff.deletions).length * 2 +
      (diff.status?.length ?? 0) * 2,
    2,
  )
}

export function storedDiffPath(sessionID: SessionID) {
  return path.join(Global.Path.data, "storage", "session_diff", `${sessionID}.json`)
}

export function storedDiffSize(sessionID: SessionID) {
  const target = storedDiffPath(sessionID)
  if (!existsSync(target)) return 0
  try {
    return statSync(target).size
  } catch {
    return 0
  }
}

export function isStoredDiffTooLarge(sessionID: SessionID) {
  return storedDiffSize(sessionID) > MAX_SESSION_DIFF_STORAGE_BYTES
}
