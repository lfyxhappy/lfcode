export type CapabilityRisk = "read" | "modify" | "install" | "credential" | "destructive" | "release"
export type CapabilitySource = "core" | "official" | "local" | "public" | "plugin" | "mcp" | "runtime"
export type CapabilityOperation =
  | "read"
  | "execute"
  | "stop"
  | "install"
  | "update"
  | "enable"
  | "disable"
  | "delete"
  | "export"
  | "publish"
export type CapabilityDecision = "allow" | "preview" | "confirm" | "deny"
export type CapabilityScope = "global" | `project:${string}` | `session:${string}`

export type CapabilityGrant = {
  id: string
  capability: string
  scope: string
  source: CapabilitySource
  expiresAt?: number
  remainingBudget?: number
  revoked?: boolean
}

export type CapabilityPolicyInput = {
  risk: CapabilityRisk
  source: CapabilitySource
  operation: CapabilityOperation
  previewed: boolean
  reversible: boolean
  grant?: CapabilityGrant
  now?: number
}

export function evaluateCapabilityPolicy(input: CapabilityPolicyInput): CapabilityDecision {
  if (!grantAllows(input.grant, input.now ?? Date.now())) return "deny"
  if (["credential", "destructive", "release"].includes(input.risk)) return "confirm"
  if (["delete", "export", "publish"].includes(input.operation)) return "confirm"
  if (["install", "update"].includes(input.operation) && trusted(input.source) && input.previewed && input.reversible) {
    return "allow"
  }
  if (input.risk === "read") return "allow"
  if (!input.previewed) return "preview"
  return "confirm"
}

export function grantAllows(grant: CapabilityGrant | undefined, now: number) {
  if (!grant) return true
  if (grant.revoked) return false
  if (grant.expiresAt !== undefined && grant.expiresAt <= now) return false
  if (grant.remainingBudget !== undefined && grant.remainingBudget <= 0) return false
  return true
}

export function scopedCapabilityGrant(
  grants: CapabilityGrant[],
  input: { projectID?: string; sessionID?: string },
): CapabilityGrant | undefined {
  const scopes: CapabilityScope[] = [
    ...(input.sessionID ? ([`session:${input.sessionID}`] as const) : []),
    ...(input.projectID ? ([`project:${input.projectID}`] as const) : []),
    "global",
  ]
  return scopes.map((scope) => grants.find((grant) => grant.scope === scope)).find(Boolean)
}

function trusted(source: CapabilitySource) {
  return source === "core" || source === "official"
}
