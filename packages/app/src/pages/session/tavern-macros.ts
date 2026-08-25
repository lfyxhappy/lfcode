export type TavernMacroContext = {
  characterName?: string
  userName?: string
  variables?: Record<string, string>
  now?: Date
}

export type TavernSlashResult =
  | { handled: false }
  | { handled: true; variables: Record<string, string>; notice?: string; openVariables?: boolean }
  | { handled: true; error: string }

export function normalizeTavernVariables(input: Record<string, string> | undefined) {
  return Object.fromEntries(
    Object.entries(input ?? {}).flatMap(([key, value]) => {
      const name = normalizeTavernVariableName(key)
      if (!name || typeof value !== "string") return []
      return [[name, value.slice(0, 4_000)]]
    }),
  )
}

export function normalizeTavernVariableName(value: string) {
  const name = value.trim()
  if (!name || name.length > 64 || /[\s:{}]/.test(name)) return undefined
  return name
}

export function expandTavernMacros(text: string, input: TavernMacroContext = {}) {
  const variables = normalizeTavernVariables(input.variables)
  const now = input.now ?? new Date()
  return text.replace(/{{\s*([^{}]+?)\s*}}/g, (token, expression: string) => {
    const [command, ...arguments_] = expression.split("::").map((item) => item.trim())
    if (command.toLocaleLowerCase() === "char" && arguments_.length === 0) return input.characterName ?? "角色"
    if (command.toLocaleLowerCase() === "user" && arguments_.length === 0) return input.userName ?? "玩家"
    if (command.toLocaleLowerCase() === "date" && arguments_.length === 0) return formatDate(now)
    if (command.toLocaleLowerCase() === "time" && arguments_.length === 0) return formatTime(now)
    if (command.toLocaleLowerCase() === "datetime" && arguments_.length === 0) return `${formatDate(now)} ${formatTime(now)}`
    if (command.toLocaleLowerCase() === "getvar" && arguments_.length === 1) {
      const name = normalizeTavernVariableName(arguments_[0])
      return name ? variables[name] ?? "" : token
    }
    return token
  })
}

export function applyTavernInputMacros(text: string, input: TavernMacroContext = {}) {
  const variables = normalizeTavernVariables(input.variables)
  const now = input.now ?? new Date()
  return {
    variables,
    text: text.replace(/{{\s*([^{}]+?)\s*}}/g, (token, expression: string) => {
      const [command, ...arguments_] = expression.split("::").map((item) => item.trim())
      if (command.toLocaleLowerCase() === "setvar" && arguments_.length >= 2) {
        const name = normalizeTavernVariableName(arguments_[0])
        if (!name) return token
        variables[name] = arguments_.slice(1).join("::").slice(0, 4_000)
        return ""
      }
      return expandTavernMacros(token, { ...input, variables, now })
    }),
  }
}

export function runTavernSlash(text: string, variables: Record<string, string> | undefined): TavernSlashResult {
  const match = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return { handled: false }
  const command = match[1].toLocaleLowerCase()
  const argument = match[2]?.trim() ?? ""
  const next = normalizeTavernVariables(variables)
  if (command === "vars") return { handled: true, variables: next, openVariables: true }
  if (command === "set") {
    const [rawName, ...value] = argument.split(/\s+/)
    const name = rawName ? normalizeTavernVariableName(rawName) : undefined
    if (!name || value.length === 0) return { handled: true, error: "用法：/set 变量名 值" }
    next[name] = value.join(" ").slice(0, 4_000)
    return { handled: true, variables: next, notice: `已设置变量 ${name}` }
  }
  if (command === "unset") {
    const name = normalizeTavernVariableName(argument)
    if (!name) return { handled: true, error: "用法：/unset 变量名" }
    delete next[name]
    return { handled: true, variables: next, notice: `已移除变量 ${name}` }
  }
  return { handled: false }
}

function formatDate(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map((item, index) => index === 0 ? String(item) : String(item).padStart(2, "0")).join("-")
}

function formatTime(value: Date) {
  return [value.getHours(), value.getMinutes()].map((item) => String(item).padStart(2, "0")).join(":")
}
