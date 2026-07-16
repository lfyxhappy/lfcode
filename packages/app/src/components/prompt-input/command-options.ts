import type { AgentOption, SlashCommand } from "./slash-popover"

export function promptAgentOptions(
  agents: ReadonlyArray<{
    hidden?: boolean
    mode?: string
    name: string
  }>,
): AgentOption[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map((agent): AgentOption => ({ name: agent.name, display: agent.name }))
}

export function promptAgentNames(
  agents: ReadonlyArray<{
    name: string
  }>,
) {
  return agents.map((agent) => agent.name)
}

export function promptSlashCommands(
  builtin: ReadonlyArray<{
    id: string
    title: string
    description?: string
    keybind?: string
    disabled?: boolean
    slash?: string
  }>,
  custom: ReadonlyArray<{
    name: string
    description?: string
    source?: "command" | "mcp" | "skill"
  }>,
): SlashCommand[] {
  const builtinCommands = builtin
    .filter((option) => !option.disabled && !option.id.startsWith("suggested.") && option.slash)
    .map(
      (option) =>
        ({
          id: option.id,
          trigger: option.slash!,
          title: option.title,
          description: option.description,
          keybind: option.keybind,
          type: "builtin",
        }) satisfies SlashCommand,
    )

  const customCommands = custom.map(
    (command) =>
      ({
        id: `custom.${command.name}`,
        trigger: command.name,
        title: command.name,
        description: command.description,
        type: "custom",
        source: command.source,
      }) satisfies SlashCommand,
  )

  return [...customCommands, ...builtinCommands]
}
