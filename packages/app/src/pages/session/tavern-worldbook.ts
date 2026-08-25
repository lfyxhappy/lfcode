export type TavernWorldbook = {
  id: string
  name: string
  content: string
}

export type TavernTranscriptEntry = {
  role: "user" | "assistant"
  text: string
}

export function updateTavernWorldbook(input: { worldbook: TavernWorldbook & { source?: string }; name: string; content: string }) {
  const name = input.name.trim()
  if (!name) throw new Error("请填写世界书名称")
  const content = input.content.trim()
  if (!content) throw new Error("请填写世界书 JSON")
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error("世界书必须是有效 JSON")
  }
  if (!parsed || typeof parsed !== "object") throw new Error("世界书必须是 JSON 对象或数组")
  return {
    id: input.worldbook.id,
    name,
    content: JSON.stringify(parsed, null, 2),
  }
}

type WorldbookEntry = {
  id: string
  content: string
  keys: string[]
  secondaryKeys: string[]
  constant: boolean
  selective: boolean
  enabled: boolean
  order: number
  position: number
  insertionPosition: number
  scanDepth: number
  probability: number
  recursive: boolean
  recursionSource: boolean
  useRegex: boolean
  exclusionGroup?: string
  depth: number
}

export type TavernWorldbookSections = {
  beforeCharacter: string[]
  afterCharacter: string[]
  beforeExamples: string[]
  afterExamples: string[]
  beforeAuthorNote: string[]
  afterAuthorNote: string[]
  depth: { content: string; depth: number }[]
}

type TavernWorldbookRenderInput = {
  worldbooks: TavernWorldbook[]
  worldbookIDs: string[]
  transcript: TavernTranscriptEntry[]
  maxEntries?: number
  maxCharacters?: number
  maxTokens?: number
  random?: () => number
}

export function renderTavernWorldbooks(input: TavernWorldbookRenderInput) {
  return selectTavernWorldbookEntries(input).map((entry) => entry.content)
}

export function renderTavernWorldbookSections(input: TavernWorldbookRenderInput): TavernWorldbookSections {
  return selectTavernWorldbookEntries(input).reduce<TavernWorldbookSections>((sections, entry) => {
    if (entry.insertionPosition === 0) return { ...sections, beforeCharacter: [...sections.beforeCharacter, entry.content] }
    if (entry.insertionPosition === 2) return { ...sections, beforeExamples: [...sections.beforeExamples, entry.content] }
    if (entry.insertionPosition === 3) return { ...sections, afterExamples: [...sections.afterExamples, entry.content] }
    if (entry.insertionPosition === 4) return { ...sections, beforeAuthorNote: [...sections.beforeAuthorNote, entry.content] }
    if (entry.insertionPosition === 5) return { ...sections, afterAuthorNote: [...sections.afterAuthorNote, entry.content] }
    if (entry.insertionPosition === 6) return { ...sections, depth: [...sections.depth, { content: entry.content, depth: entry.depth }] }
    return { ...sections, afterCharacter: [...sections.afterCharacter, entry.content] }
  }, emptyTavernWorldbookSections())
}

function selectTavernWorldbookEntries(input: TavernWorldbookRenderInput) {
  const selected = input.worldbooks.filter((item) => input.worldbookIDs.includes(item.id))
  const entries = selected
    .flatMap((worldbook) => parseWorldbook(worldbook))
    .filter((entry) => entry.enabled)
  const recursive = collectRecursiveEntries(entries, input.transcript)
  const ordered = excludeConflictingEntries(recursive)
    .filter((entry) => includesByProbability(entry, input.random))
    .sort((a, b) => b.order - a.order || a.position - b.position || a.id.localeCompare(b.id))
    .slice(0, input.maxEntries ?? 32)

  const maxCharacters = Math.min(input.maxCharacters ?? Number.MAX_SAFE_INTEGER, (input.maxTokens ?? 4_000) * 4)
  return ordered.reduce<WorldbookEntry[]>((result, entry) => {
    const currentLength = result.reduce((length, item) => length + item.content.length, 0)
    if (currentLength + entry.content.length > maxCharacters) return result
    result.push(entry)
    return result
  }, [])
}

function emptyTavernWorldbookSections(): TavernWorldbookSections {
  return {
    beforeCharacter: [],
    afterCharacter: [],
    beforeExamples: [],
    afterExamples: [],
    beforeAuthorNote: [],
    afterAuthorNote: [],
    depth: [],
  }
}

function parseWorldbook(worldbook: TavernWorldbook): WorldbookEntry[] {
  const source = parseObject(worldbook.content)
  const entries = entriesFrom(source)
  if (!entries.length) return worldbook.content.trim() ? [plainTextEntry(worldbook.content)] : []
  return entries.flatMap((entry, index) => normalizeEntry(entry, index))
}

function entriesFrom(source: Record<string, unknown> | undefined) {
  const data = record(source?.data)
  const entries = source?.entries ?? data?.entries
  if (Array.isArray(entries)) return entries.filter(record)
  const registry = record(entries)
  if (!registry) return []
  return Object.values(registry).flatMap((value) => {
    const entry = record(value)
    return entry ? [entry] : []
  })
}

function normalizeEntry(source: Record<string, unknown>, index: number): WorldbookEntry[] {
  const content = string(source.content)
  if (!content) return []
  return [{
    id: string(source.uid ?? source.id) ?? `entry-${index}`,
    content,
    keys: strings(source.key ?? source.keys),
    secondaryKeys: strings(source.keysecondary ?? source.secondary_keys),
    constant: source.constant === true,
    selective: source.selective === true,
    enabled: source.disable !== true && source.enabled !== false,
    order: number(source.order ?? source.priority) ?? 100,
    position: number(source.position ?? source.insertion_position) ?? index,
    insertionPosition: number(source.position ?? source.insertion_position) ?? 1,
    scanDepth: Math.max(1, Math.min(100, Math.floor(number(source.scan_depth ?? source.scanDepth) ?? 20))),
    probability: source.useProbability === false ? 1 : normalizeProbability(source.probability),
    recursive: source.recursive === true || source.excludeRecursion === false,
    recursionSource: source.preventRecursion !== true,
    useRegex: source.use_regex === true || source.useRegex === true,
    exclusionGroup: string(source.group ?? source.exclusion_group ?? source.group_override),
    depth: Math.max(0, Math.min(100, Math.floor(number(source.depth) ?? 4))),
  }]
}

function plainTextEntry(content: string): WorldbookEntry {
  return { id: "plain-text", content, keys: [], secondaryKeys: [], constant: true, selective: false, enabled: true, order: 100, position: 0, insertionPosition: 1, scanDepth: 20, probability: 1, recursive: false, recursionSource: false, useRegex: false, depth: 4 }
}

function matches(entry: WorldbookEntry, transcript: TavernTranscriptEntry[]) {
  if (!entry.keys.length) return false
  const context = transcript.slice(-entry.scanDepth).map((item) => item.text).join("\n").slice(-16_000)
  const primary = entry.keys.some((key) => matchesKey(key, context, entry.useRegex))
  if (!primary) return false
  if (!entry.selective || !entry.secondaryKeys.length) return true
  return entry.secondaryKeys.some((key) => matchesKey(key, context, entry.useRegex))
}

function collectRecursiveEntries(entries: WorldbookEntry[], transcript: TavernTranscriptEntry[]) {
  const selected = entries.filter((entry) => entry.constant || matches(entry, transcript))
  const selectedIDs = new Set(selected.map((entry) => entry.id))
  const context = [...transcript.slice(-20).map((entry) => entry.text), ...selected.filter((entry) => entry.recursionSource).map((entry) => entry.content)]
  for (let round = 0; round < 4; round++) {
    const next = entries.filter((entry) => entry.recursive && !selectedIDs.has(entry.id) && matches(entry, context.map((text) => ({ role: "assistant" as const, text }))))
    if (!next.length) return selected
    next.forEach((entry) => {
      selected.push(entry)
      selectedIDs.add(entry.id)
      if (entry.recursionSource) context.push(entry.content)
    })
  }
  return selected
}

function excludeConflictingEntries(entries: WorldbookEntry[]) {
  const groups = new Map<string, WorldbookEntry>()
  const ungrouped = entries.filter((entry) => {
    if (!entry.exclusionGroup) return true
    const existing = groups.get(entry.exclusionGroup)
    if (!existing || entry.order > existing.order || (entry.order === existing.order && entry.position < existing.position)) groups.set(entry.exclusionGroup, entry)
    return false
  })
  return [...ungrouped, ...groups.values()]
}

function includesByProbability(entry: WorldbookEntry, random: (() => number) | undefined) {
  return entry.probability >= 1 || Math.max(0, Math.min(0.999999999, random?.() ?? Math.random())) < entry.probability
}

function matchesKey(key: string, context: string, useRegex: boolean) {
  if (!useRegex) return context.toLocaleLowerCase().includes(key.toLocaleLowerCase())
  if (!isSafeRegex(key)) return false
  try {
    return new RegExp(key, "iu").test(context)
  } catch {
    return false
  }
}

function isSafeRegex(source: string) {
  if (source.length === 0 || source.length > 256) return false
  return !/(?:\([^)]*[+*][^)]*\)|\[[^\]]+\])[+*][+*{]/.test(source)
}

function parseObject(value: string) {
  try {
    return record(JSON.parse(value))
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function strings(value: unknown) {
  if (typeof value === "string") return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = string(item)
    return text ? [text] : []
  })
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizeProbability(value: unknown) {
  const probability = number(value)
  if (probability === undefined) return 1
  return Math.max(0, Math.min(1, probability > 1 ? probability / 100 : probability))
}
