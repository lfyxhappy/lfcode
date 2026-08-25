export type SessionActorView = {
  actorID: string
  mode: string
  visible?: boolean
}

export function visibleSubagents<T extends SessionActorView>(actors: T[]) {
  return actors.filter((actor) => actor.mode === "subagent" && actor.visible !== false)
}

export function isNavigableSubagent(actors: SessionActorView[], actorID: string) {
  return visibleSubagents(actors).some((actor) => actor.actorID === actorID)
}
