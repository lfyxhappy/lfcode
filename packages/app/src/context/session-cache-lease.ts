type Lease = {
  sessionID: string
  owner: string
}

const leases = new Map<string, Set<string>>()

export function acquireSessionCacheLease(input: Lease) {
  const current = leases.get(input.sessionID) ?? new Set<string>()
  current.add(input.owner)
  leases.set(input.sessionID, current)
  return () => releaseSessionCacheLease(input)
}

export function releaseSessionCacheLease(input: Lease) {
  const current = leases.get(input.sessionID)
  if (!current) return
  current.delete(input.owner)
  if (current.size === 0) leases.delete(input.sessionID)
}

export function hasSessionCacheLease(sessionID: string) {
  return (leases.get(sessionID)?.size ?? 0) > 0
}

export function filterUnleasedSessionCaches(sessionIDs: Iterable<string>) {
  return Array.from(sessionIDs).filter((sessionID) => !hasSessionCacheLease(sessionID))
}
