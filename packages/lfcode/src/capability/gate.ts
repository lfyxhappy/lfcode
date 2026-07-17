import { randomUUID } from "crypto"
import { CapabilityPersistence } from "./persistence"
import {
  evaluateCapabilityPolicy,
  scopedCapabilityGrant,
  type CapabilityDecision,
  type CapabilityOperation,
  type CapabilityRisk,
  type CapabilitySource,
} from "./policy"

export type CapabilityGateInput = {
  auditID?: string
  caller: string
  capability: string
  risk: CapabilityRisk
  source: CapabilitySource
  operation: CapabilityOperation
  previewed: boolean
  reversible: boolean
  grantID?: string
  target?: string
  projectID?: string
  sessionID?: string
  messageID?: string
  reason?: string
  metadata?: Record<string, unknown>
}

export function decideCapabilityOperation(input: CapabilityGateInput): {
  decision: CapabilityDecision
  auditID: string
} {
  const grant = input.grantID
    ? CapabilityPersistence.loadGrant(input.grantID)
    : scopedCapabilityGrant(CapabilityPersistence.listGrants({ capability: input.capability }), input)
  const decision = evaluateCapabilityPolicy({
    risk: input.risk,
    source: input.source,
    operation: input.operation,
    previewed: input.previewed,
    reversible: input.reversible,
    ...(grant ? { grant } : {}),
  })
  const auditID = input.auditID ?? `capability_${randomUUID()}`
  CapabilityPersistence.recordAudit({
    id: auditID,
    caller: input.caller,
    capability: input.capability,
    operation: input.operation,
    decision,
    target: input.target,
    projectID: input.projectID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    reason: input.reason,
    metadata: { ...input.metadata, ...(grant ? { grantID: grant.id } : {}) },
    result: "pending",
  })
  return { decision, auditID }
}

export function completeCapabilityOperation(auditID: string, result: string, rollback?: Record<string, unknown>) {
  return CapabilityPersistence.completeAudit({ id: auditID, result, rollback })
}

export function requireCapabilityDecision(decision: CapabilityDecision) {
  if (decision === "deny") throw new Error("Capability operation was denied by its grant or policy")
  if (decision === "preview") throw new Error("Capability operation requires a preview before it can run")
}

export function capabilitySourceFromPluginTrust(trust: "bundled" | "official" | "dev-local" | "external"): CapabilitySource {
  if (trust === "bundled" || trust === "official") return "official"
  if (trust === "dev-local") return "local"
  return "public"
}
