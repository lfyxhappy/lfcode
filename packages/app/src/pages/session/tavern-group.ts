import type { TavernGroup, TavernSessionBinding } from "./tavern-conversation"

export function updateTavernGroup(input: { group: TavernGroup; name: string; memberIDs: string[]; memberWeights: Record<string, number> }) {
  const name = input.name.trim()
  const memberIDs = [...new Set(input.memberIDs)]
  if (!name || memberIDs.length === 0) throw new Error("请填写群组名称并至少选择一名角色")
  return {
    id: input.group.id,
    name,
    memberIDs,
    memberWeights: Object.fromEntries(memberIDs.map((id) => [id, normalizeWeight(input.memberWeights[id])])),
    ...(input.group.avatar ? { avatar: input.group.avatar } : {}),
  }
}

export function rebindTavernGroupSpeakers(input: { sessions: Record<string, TavernSessionBinding>; group: TavernGroup }) {
  return Object.fromEntries(
    Object.entries(input.sessions).map(([sessionID, binding]) => {
      if (binding.groupID !== input.group.id || !binding.speakerID || input.group.memberIDs.includes(binding.speakerID)) return [sessionID, binding]
      return [sessionID, { ...binding, speakerID: input.group.memberIDs[0] }]
    }),
  )
}

function normalizeWeight(value: number | undefined) {
  return Math.max(0, Math.min(100, typeof value === "number" && Number.isFinite(value) ? value : 1))
}
