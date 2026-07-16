import type { CommandOption } from "@/context/command"

export const PROMPT_SHELL_MODE_KEYBIND = "mod+shift+x"
export const PROMPT_NORMAL_MODE_KEYBIND = "mod+shift+e"

export function buildPromptInputCommandOptions(input: {
  normalMode: boolean
  t: (key: string) => string
  onAttach: VoidFunction
  onShellMode: VoidFunction
  onNormalMode: VoidFunction
}) {
  return [
    {
      id: "file.attach",
      title: input.t("prompt.action.attachFile"),
      category: input.t("command.category.file"),
      keybind: "mod+u",
      disabled: !input.normalMode,
      onSelect: input.onAttach,
    },
    {
      id: "prompt.mode.shell",
      title: input.t("command.prompt.mode.shell"),
      category: input.t("command.category.session"),
      keybind: PROMPT_SHELL_MODE_KEYBIND,
      disabled: !input.normalMode,
      onSelect: input.onShellMode,
    },
    {
      id: "prompt.mode.normal",
      title: input.t("command.prompt.mode.normal"),
      category: input.t("command.category.session"),
      keybind: PROMPT_NORMAL_MODE_KEYBIND,
      disabled: input.normalMode,
      onSelect: input.onNormalMode,
    },
  ] satisfies CommandOption[]
}
