export function createPromptGoalCommandRequest(input: {
  sessionID?: string
  arguments: string
  agent?: {
    name: string
  }
  model?: {
    id: string
    provider?: {
      id: string
    }
  }
  variant?: string
}) {
  if (!input.sessionID || !input.agent || !input.model?.provider?.id) return
  return {
    sessionID: input.sessionID,
    command: "goal" as const,
    arguments: input.arguments,
    agent: input.agent.name,
    model: `${input.model.provider.id}/${input.model.id}`,
    variant: input.variant,
  }
}
