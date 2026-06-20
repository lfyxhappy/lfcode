export type SubagentField = "general" | "explore" | "title" | "summary" | "compaction"

export const SUBAGENT_FIELDS: SubagentField[] = ["general", "explore", "title", "summary", "compaction"]

export function subagentModelValue(
  config: {
    agent?: Partial<Record<SubagentField, { model?: string | null } | undefined>>
  },
  field: SubagentField,
) {
  return config.agent?.[field]?.model ?? ""
}

export function subagentModelPatch(field: SubagentField, model: string) {
  return {
    agent: {
      [field]: {
        model: model || null,
      },
    },
  }
}
