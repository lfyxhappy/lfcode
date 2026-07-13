import { createHash } from "node:crypto"
import path from "path"

type Recovery = {
  failures: number
  version?: string
}

const recovery = new Map<string, Recovery>()

function normalize(filepath: string) {
  const resolved = path.resolve(filepath)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function key(sessionID: string, messageID: string, filepath: string) {
  return `${sessionID}\0${messageID}\0${normalize(filepath)}`
}

function version(content: Uint8Array) {
  return createHash("sha256").update(content).digest("hex")
}

export function recordRead(sessionID: string, messageID: string, filepath: string, content: Uint8Array) {
  const entry = recovery.get(key(sessionID, messageID, filepath))
  if (!entry) return
  entry.version = version(content)
}

export function needsRead(sessionID: string, messageID: string, filepath: string) {
  return recovery.has(key(sessionID, messageID, filepath))
}

export function requireFreshRead(sessionID: string, messageID: string, filepath: string, content: Uint8Array) {
  const entry = recovery.get(key(sessionID, messageID, filepath))
  if (!entry) return
  if (entry.failures >= 2) {
    return "This target has already failed patch-context verification twice in the current editing turn. Stop this edit chain and report the mismatch instead of retrying again."
  }
  if (!entry.version) {
    return "Patch recovery requires a fresh structured read of this target before another edit. Read the file now; do not reuse remembered context."
  }
  if (entry.version !== version(content)) {
    entry.version = undefined
    return "The file changed after the required recovery read. Read the current file again before editing; the previous context is stale."
  }
}

export function markContextFailure(sessionID: string, messageID: string, filepath: string) {
  const identity = key(sessionID, messageID, filepath)
  const entry = recovery.get(identity) ?? { failures: 0 }
  entry.failures += 1
  entry.version = undefined
  recovery.set(identity, entry)
  return entry.failures >= 2
    ? "This is the second context mismatch for this target in the current editing turn. The edit chain is now fused; do not retry this target again in this turn."
    : "The target is now protected by patch recovery. A fresh structured read is required before the next edit."
}

export function clear(sessionID: string, messageID: string, filepath: string) {
  recovery.delete(key(sessionID, messageID, filepath))
}

export function blockedShellWrite(sessionID: string, messageID: string, cwd: string, command: string) {
  if (!/(?:>|set-content|add-content|out-file|writealltext|write_text|write_bytes|\.write\(|open\([^)]*,\s*["'](?:w|a))/i.test(command))
    return
  const normalizedCommand = command.replaceAll("/", "\\").toLowerCase()
  for (const [identity, entry] of recovery) {
    const [entrySessionID, entryMessageID, filepath] = identity.split("\0")
    if (entrySessionID !== sessionID || entryMessageID !== messageID || !entry) continue
    const relative = path.relative(cwd, filepath).replaceAll("/", "\\").toLowerCase()
    const basename = path.basename(filepath).toLowerCase()
    if (!normalizedCommand.includes(basename) && !normalizedCommand.includes(relative)) continue
    return "A structured patch failed for this target in the current editing turn. Shell or Python writes are blocked until it is re-read and repaired through a structured editing tool."
  }
}
