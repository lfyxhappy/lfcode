export type TavernHistory = {
  id: string
  name: string
  path: string
  source?: string
  characterID?: string
  sessionID?: string
}

export type TavernHistoryCharacter = {
  id: string
  name?: string
  worldbookIDs: string[]
}

export function filterTavernHistory(input: {
  chats: TavernHistory[]
  characters: TavernHistoryCharacter[]
  sessions: Record<string, TavernHistoryBinding>
  query?: string
  characterID?: string
}) {
  const query = input.query?.trim().toLocaleLowerCase() ?? ""
  return input.chats.filter((history) => {
    const characterID = history.characterID ?? (history.sessionID ? input.sessions[history.sessionID]?.characterID : undefined)
    if (input.characterID === "unbound" && characterID) return false
    if (input.characterID && input.characterID !== "unbound" && characterID !== input.characterID) return false
    if (!query) return true
    const character = input.characters.find((item) => item.id === characterID)
    return [history.name, history.path, character?.name].some((value) => value?.toLocaleLowerCase().includes(query))
  })
}

export type TavernHistoryBinding = {
  characterID?: string
  worldbookIDs: string[]
  greetingIndex?: number
}

export type TavernImportedHistoryMessage = {
  role: "user" | "assistant"
  text: string
  swipes?: string[]
  swipeID?: number
}

export function parseSillyTavernHistory(source: string) {
  const messages = source
    .split(/\r?\n/)
    .flatMap((line): TavernImportedHistoryMessage[] => {
      const parsed = parseRecord(line)
      if (!parsed || parsed.is_system === true) return []
      const swipes = strings(parsed.swipes)
      const rawIndex = typeof parsed.swipe_id === "number" && Number.isInteger(parsed.swipe_id) ? parsed.swipe_id : 0
      const swipeID = swipes.length ? Math.min(Math.max(rawIndex, 0), swipes.length - 1) : undefined
      const text = swipes[swipeID ?? 0] ?? string(parsed.mes)
      if (!text) return []
      return [{
        role: parsed.is_user === true ? "user" : "assistant",
        text: text.slice(0, 100_000),
        ...(swipes.length > 1 && parsed.is_user !== true ? { swipes, swipeID } : {}),
      }]
    })
    .slice(0, 10_000)
  if (!messages.length) throw new Error("未找到可导入的 SillyTavern 消息")
  return messages
}

export function serializeSillyTavernHistory(messages: unknown[]) {
  const lines = messages.flatMap((item) => {
    const message = record(item)
    const info = record(message?.info)
    const role = info?.role === "user" || info?.role === "assistant" ? info.role : undefined
    if (!role) return []
    const parts = Array.isArray(message?.parts) ? message.parts : []
    const text = parts
      .flatMap((part) => {
        const value = record(part)
        return value?.type === "text" && value.synthetic !== true ? [string(value.text)] : []
      })
      .filter((value): value is string => !!value)
      .join("\n\n")
    if (!text) return []
    const textPart = parts.map(record).find((part) => part?.type === "text" && part.synthetic !== true)
    const tavern = record(record(textPart?.metadata)?.tavern)
    const swipes = role === "assistant" ? strings(tavern?.swipes) : []
    const swipeID = typeof tavern?.swipeID === "number" && Number.isInteger(tavern.swipeID) ? Math.min(Math.max(tavern.swipeID, 0), Math.max(0, swipes.length - 1)) : 0
    return [JSON.stringify({ is_user: role === "user", mes: text, ...(swipes.length > 1 ? { swipes, swipe_id: swipeID } : {}) })]
  })
  if (!lines.length) throw new Error("当前会话没有可导出的酒馆文本")
  return `${JSON.stringify({ chat_metadata: { version: 1 } })}\n${lines.join("\n")}\n`
}

export function setTavernHistoryCharacter(input: {
  chats: TavernHistory[]
  characters: TavernHistoryCharacter[]
  sessions: Record<string, TavernHistoryBinding>
  historyID: string
  characterID?: string
}) {
  const history = input.chats.find((item) => item.id === input.historyID)
  if (!history?.sessionID) return

  const character = input.characterID ? input.characters.find((item) => item.id === input.characterID) : undefined
  if (input.characterID && !character) return

  const chats = input.chats.map((item) => {
    if (item.id !== history.id) return item
    if (character) return { ...item, characterID: character.id }
    const next = { ...item }
    delete next.characterID
    return next
  })

  if (character) {
    return {
      chats,
      sessions: {
        ...input.sessions,
        [history.sessionID]: {
          ...input.sessions[history.sessionID],
          characterID: character.id,
          worldbookIDs: [...character.worldbookIDs],
        },
      },
    }
  }

  const sessions = { ...input.sessions }
  delete sessions[history.sessionID]
  return { chats, sessions }
}

function parseRecord(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.slice(0, 100_000))
    : []
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
