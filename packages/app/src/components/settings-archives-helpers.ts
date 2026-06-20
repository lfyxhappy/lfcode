import type { GlobalSession } from "@lfcode-ai/sdk/v2/client"

export function archivedSessions(input: GlobalSession[]) {
  return input.filter((session) => !!session.time.archived)
}

export function removeSession(input: GlobalSession[], sessionID: string) {
  return input.filter((session) => session.id !== sessionID)
}

export function sessionProjectLabel(session: GlobalSession) {
  return session.project?.name || session.project?.worktree || session.directory
}
