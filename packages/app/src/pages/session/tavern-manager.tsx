import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { Icon } from "@lfcode-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { formatServerError } from "@/utils/server-errors"
import { createTavernCharacter, readTavernCharacterCard, updateTavernCharacter } from "./tavern-character-card"
import { filterTavernCharacters, tavernCharacterTags } from "./tavern-character-library"
import {
  filterTavernHistory,
  parseSillyTavernHistory,
  serializeSillyTavernHistory,
  setTavernHistoryCharacter,
  type TavernHistory,
} from "./tavern-history"
import { defaultRoadwaySettings, normalizeRoadwaySettings, type TavernRoadwaySettings } from "./tavern-roadway"
import {
  defaultTavernSpeechSettings,
  normalizeTavernSpeechSettings,
  stopTavernSpeech,
  tavernSpeechAvailable,
  type TavernSpeechSettings,
} from "./tavern-tts"
import {
  moveTavernItemToTrash,
  restoreTavernTrashItem,
  type TavernTrashItem,
  type TavernWorldbook,
} from "./tavern-trash"
import { normalizeTavernViewSettings } from "./tavern-view"
import {
  normalizeTavernAvatarPath,
  normalizeTavernVisualSettings,
  type TavernVisualAsset,
  type TavernVisualSettings,
} from "./tavern-visual"
import { normalizeTavernMemorySettings, type TavernMemorySettings } from "./tavern-memory"
import type { TavernConversationData, TavernGroup, TavernPersona, TavernPreset } from "./tavern-conversation"
import { downloadTavernExport, type TavernExportFile } from "./tavern-export"
import { updateTavernWorldbook } from "./tavern-worldbook"
import {
  tavernPersonaDescription,
  tavernPresetConfigText,
  updateTavernPersona,
  updateTavernPreset,
} from "./tavern-shared-resource"
import { rebindTavernGroupSpeakers, updateTavernGroup } from "./tavern-group"

type TavernCharacter = TavernConversationData["characters"][number]
type TavernTtsStatus = {
  config: { baseUrl: string; model: string; voice: string }
  secureStorage: "available" | "unavailable"
  hasSecret: boolean
}
type TavernMemoryStatus = {
  config: { baseUrl: string; model: string }
  secureStorage: "available" | "unavailable"
  hasSecret: boolean
  indexed: number
  pending: number
}
type TavernData = TavernConversationData & {
  worldbooks: TavernWorldbook[]
  chats: TavernHistory[]
  trash?: TavernTrashItem[]
  settings?: {
    html?: boolean
    storyPrediction?: boolean
    immersive?: boolean
    dualView?: boolean
    visual?: TavernVisualSettings
    roadway?: TavernRoadwaySettings
    tts?: TavernSpeechSettings
    memory?: TavernMemorySettings
  }
}

export function TavernManager(props: {
  view: "new" | "characters" | "personas" | "presets" | "groups" | "worldbooks" | "history" | "trash" | "settings"
  projectID: string
  worktree: string
}) {
  const sdk = useSDK()
  const platform = usePlatform()
  const navigate = useNavigate()
  const [error, setError] = createSignal<string>()
  const [creating, setCreating] = createSignal(false)
  const [characterID, setCharacterID] = createSignal<string>()
  const [groupID, setGroupID] = createSignal<string>()
  const [recordName, setRecordName] = createSignal("")
  const [recordPrompt, setRecordPrompt] = createSignal("")
  const [groupName, setGroupName] = createSignal("")
  const [groupMemberIDs, setGroupMemberIDs] = createSignal<string[]>([])
  const [groupMemberWeights, setGroupMemberWeights] = createSignal<Record<string, number>>({})
  const [editingGroupID, setEditingGroupID] = createSignal<string>()
  const [editingGroupName, setEditingGroupName] = createSignal("")
  const [editingGroupMemberIDs, setEditingGroupMemberIDs] = createSignal<string[]>([])
  const [editingGroupMemberWeights, setEditingGroupMemberWeights] = createSignal<Record<string, number>>({})
  const [confirmEmptyTrash, setConfirmEmptyTrash] = createSignal(false)
  const [exporting, setExporting] = createSignal<string>()
  const [editingWorldbookID, setEditingWorldbookID] = createSignal<string>()
  const [worldbookName, setWorldbookName] = createSignal("")
  const [worldbookContent, setWorldbookContent] = createSignal("")
  const [editingCharacterID, setEditingCharacterID] = createSignal<string>()
  const [creatingCharacter, setCreatingCharacter] = createSignal(false)
  const [characterName, setCharacterName] = createSignal("")
  const [characterPrompt, setCharacterPrompt] = createSignal("")
  const [characterPersonality, setCharacterPersonality] = createSignal("")
  const [characterScenario, setCharacterScenario] = createSignal("")
  const [characterExampleDialogue, setCharacterExampleDialogue] = createSignal("")
  const [characterSystemPrompt, setCharacterSystemPrompt] = createSignal("")
  const [characterPostHistoryInstructions, setCharacterPostHistoryInstructions] = createSignal("")
  const [characterDepthPrompt, setCharacterDepthPrompt] = createSignal("")
  const [characterFirstMessage, setCharacterFirstMessage] = createSignal("")
  const [characterGreetings, setCharacterGreetings] = createSignal("")
  const [characterTags, setCharacterTags] = createSignal("")
  const [expressionLabel, setExpressionLabel] = createSignal("")
  const [expressionUploadBusy, setExpressionUploadBusy] = createSignal(false)
  const [editingRecord, setEditingRecord] = createSignal<{ kind: "personas" | "presets"; id: string }>()
  const [editingRecordName, setEditingRecordName] = createSignal("")
  const [editingRecordContent, setEditingRecordContent] = createSignal("")
  const [historyImportCharacterID, setHistoryImportCharacterID] = createSignal("")
  const [historyQuery, setHistoryQuery] = createSignal("")
  const [historyFilterCharacterID, setHistoryFilterCharacterID] = createSignal("")
  const [characterQuery, setCharacterQuery] = createSignal("")
  const [characterTag, setCharacterTag] = createSignal("")
  const [importingHistory, setImportingHistory] = createSignal(false)
  const [exportingHistory, setExportingHistory] = createSignal<string>()
  const [data, { mutate, refetch }] = createResource(async (): Promise<TavernData> => {
    const value = (await sdk.client.plugin.dataGet({ pluginID: "lfcode-tavern" }).catch(() => ({ data: undefined })))
      .data?.value
    if (!value || typeof value !== "object") return emptyTavernData()
    const input = value as Partial<TavernData>
    return {
      ...input,
      characters: input.characters ?? [],
      personas: input.personas ?? [],
      presets: input.presets ?? [],
      groups: input.groups ?? [],
      worldbooks: input.worldbooks ?? [],
      chats: input.chats ?? [],
      trash: input.trash ?? [],
      sessions: input.sessions ?? {},
      settings: {
        ...input.settings,
        roadway: normalizeRoadwaySettings(input.settings?.roadway),
        tts: normalizeTavernSpeechSettings(input.settings?.tts),
        visual: normalizeTavernVisualSettings(input.settings?.visual),
      },
    }
  })
  const character = createMemo(() => data()?.characters.find((item) => item.id === characterID()))
  const group = createMemo(() => data()?.groups?.find((item) => item.id === groupID()))
  const editingWorldbook = createMemo(() => data()?.worldbooks.find((item) => item.id === editingWorldbookID()))
  const editingCharacter = createMemo(() => data()?.characters.find((item) => item.id === editingCharacterID()))
  const editingGroup = createMemo(() => data()?.groups?.find((item) => item.id === editingGroupID()))
  const editingPersona = createMemo(() =>
    editingRecord()?.kind === "personas"
      ? data()?.personas?.find((item) => item.id === editingRecord()?.id)
      : undefined,
  )
  const editingPreset = createMemo(() =>
    editingRecord()?.kind === "presets" ? data()?.presets?.find((item) => item.id === editingRecord()?.id) : undefined,
  )
  let input: HTMLInputElement | undefined
  let expressionInput: HTMLInputElement | undefined
  let historyImportInput: HTMLInputElement | undefined

  const save = async (next: TavernData) => {
    mutate(() => next)
    await sdk.client.plugin.dataSet({ pluginID: "lfcode-tavern", pluginData: { value: next } })
  }

  const createConversation = async () => {
    const current = data() ?? emptyTavernData()
    const selectedGroup = group()
    const members =
      selectedGroup?.memberIDs
        .map((id) => current.characters.find((item) => item.id === id))
        .filter((item): item is TavernCharacter => !!item) ?? []
    const selected = character() ?? members[0]
    if (!selected) {
      setError("请先选择角色或包含角色的群组")
      return
    }
    setCreating(true)
    setError()
    try {
      const created = await sdk.client.session.createManaged({
        projectID: props.projectID,
        extension: { pluginID: "lfcode-tavern", type: "tavern" },
        title: `${selected.name} 的对话`,
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      })
      const session = created.data
      if (!session) throw new Error("未能创建酒馆对话")
      await save({
        ...current,
        sessions: {
          ...current.sessions,
          [session.id]: {
            characterID: selected.id,
            groupID: selectedGroup?.id,
            speakerID: selectedGroup ? selected.id : undefined,
            worldbookIDs: [...new Set((selectedGroup ? members : [selected]).flatMap((item) => item.worldbookIDs))],
          },
        },
      })
      navigate(`/${base64Encode(props.worktree)}/session/${session.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建酒馆对话失败")
    } finally {
      setCreating(false)
    }
  }

  const importFile = async (file: File) => {
    setError()
    const current = data() ?? emptyTavernData()
    if (props.view === "worldbooks") {
      if (!file.name.toLocaleLowerCase().endsWith(".json")) throw new Error("请选择 JSON 世界书文件")
      const content = await file.text()
      JSON.parse(content)
      const stored = await sdk.client.plugin.dataFilePut({
        pluginID: "lfcode-tavern",
        pluginDataFile: { kind: "worldbooks", filename: file.name, base64: await toBase64(file) },
      })
      const item = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.json$/i, ""),
        content,
        source: stored.data?.path,
      }
      await save({ ...current, worldbooks: [...current.worldbooks.filter((entry) => entry.name !== item.name), item] })
      return
    }

    const card = await readTavernCharacterCard(file)
    if (!card) throw new Error("请选择 SillyTavern JSON 或 PNG 角色卡")
    const source = record(card.data) ?? card
    const name = string(source.name) ?? file.name.replace(/\.[^.]+$/, "")
    const stored = await sdk.client.plugin.dataFilePut({
      pluginID: "lfcode-tavern",
      pluginDataFile: { kind: "characters", filename: file.name, base64: await toBase64(file) },
    })
    const extensions = record(source.extensions)
    const embedded = record(source.character_book)
    const existingWorldbook = embedded
      ? current.worldbooks.find(
          (item) => item.name.toLocaleLowerCase() === (string(embedded.name) ?? `${name} 的世界书`).toLocaleLowerCase(),
        )
      : undefined
    const embeddedWorldbook = embedded
      ? {
          id: existingWorldbook?.id ?? crypto.randomUUID(),
          name: string(embedded.name) ?? `${name} 的世界书`,
          content: JSON.stringify(embedded, null, 2),
          source: stored.data?.path,
        }
      : undefined
    const externalWorldbookName = string(extensions?.world) ?? string(source.world)
    const externalWorldbook = externalWorldbookName
      ? current.worldbooks.find((item) => item.name.toLocaleLowerCase() === externalWorldbookName.toLocaleLowerCase())
      : undefined
    const item = {
      id: crypto.randomUUID(),
      name,
      prompt: [
        source.description,
        source.personality,
        source.scenario,
        source.mes_example,
        source.system_prompt,
        source.post_history_instructions,
        record(extensions?.depth_prompt)?.prompt,
      ]
        .map(string)
        .filter(Boolean)
        .join("\n\n"),
      description: string(source.description),
      personality: string(source.personality),
      scenario: string(source.scenario),
      exampleDialogue: string(source.mes_example),
      systemPrompt: string(source.system_prompt),
      postHistoryInstructions: string(source.post_history_instructions),
      depthPrompt: string(record(extensions?.depth_prompt)?.prompt),
      firstMessage: string(source.first_mes),
      alternateGreetings: strings(source.alternate_greetings),
      tags: strings(source.tags),
      worldbookIDs: [embeddedWorldbook?.id, externalWorldbook?.id].filter((item): item is string => !!item),
      avatar: file.name.toLowerCase().endsWith(".png") ? stored.data?.path : undefined,
      source: stored.data?.path,
    }
    await save({
      ...current,
      worldbooks: embeddedWorldbook
        ? [...current.worldbooks.filter((entry) => entry.id !== embeddedWorldbook.id), embeddedWorldbook]
        : current.worldbooks,
      characters: [...current.characters.filter((entry) => entry.name !== item.name), item],
    })
  }

  const remove = async (id: string) => {
    const current = data()
    if (!current) return
    if (
      props.view === "characters" ||
      props.view === "worldbooks" ||
      props.view === "personas" ||
      props.view === "presets" ||
      props.view === "groups"
    ) {
      await save(moveTavernItemToTrash(current, props.view, id))
    }
  }

  const restore = async (trashID: string) => {
    const current = data()
    if (!current) return
    await save(restoreTavernTrashItem(current, trashID))
  }

  const emptyTrash = async () => {
    if (!confirmEmptyTrash()) {
      setConfirmEmptyTrash(true)
      return
    }
    const current = data()
    if (!current) return
    await save({ ...current, trash: [] })
    setConfirmEmptyTrash(false)
  }

  const exportItem = async (id: string) => {
    const kind = props.view === "characters" ? "character" : props.view === "worldbooks" ? "worldbook" : undefined
    if (!kind || exporting()) return
    const item = items().find((item) => item.id === id)
    if (!item) return
    setError()
    setExporting(id)
    try {
      const result = await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "exportResource",
        pluginActionInput: { input: { kind, id } },
      })
      const value = result.data?.value as Partial<TavernExportFile> | undefined
      if (typeof value?.base64 !== "string" || typeof value.filename !== "string" || typeof value.mime !== "string") {
        throw new Error("酒馆导出没有返回文件")
      }
      const output = await platform.saveFilePickerDialog?.({
        title: `导出${kind === "character" ? "角色卡" : "世界书"}`,
        defaultPath: value.filename,
      })
      if (platform.saveFilePickerDialog && !output) return
      if (output) {
        await sdk.client.plugin.action({
          pluginID: "lfcode-tavern",
          action: "exportResource",
          pluginActionInput: { input: { kind, id, output } },
        })
        return
      }
      downloadTavernExport({ base64: value.base64, filename: value.filename, mime: value.mime })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败")
    } finally {
      setExporting()
    }
  }

  const editWorldbook = (worldbook: TavernWorldbook) => {
    setEditingWorldbookID(worldbook.id)
    setWorldbookName(worldbook.name)
    setWorldbookContent(worldbook.content)
    setError()
  }

  const saveWorldbook = async () => {
    const current = data()
    const worldbook = editingWorldbook()
    if (!current || !worldbook) return
    try {
      const next = updateTavernWorldbook({ worldbook, name: worldbookName(), content: worldbookContent() })
      await save({ ...current, worldbooks: current.worldbooks.map((item) => (item.id === next.id ? next : item)) })
      setEditingWorldbookID()
      setWorldbookName("")
      setWorldbookContent("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存世界书失败")
    }
  }

  const editCharacter = (character: TavernCharacter) => {
    setCreatingCharacter(false)
    setEditingCharacterID(character.id)
    setCharacterName(character.name)
    setCharacterPrompt(character.description ?? character.prompt)
    setCharacterPersonality(character.personality ?? "")
    setCharacterScenario(character.scenario ?? "")
    setCharacterExampleDialogue(character.exampleDialogue ?? "")
    setCharacterSystemPrompt(character.systemPrompt ?? "")
    setCharacterPostHistoryInstructions(character.postHistoryInstructions ?? "")
    setCharacterDepthPrompt(character.depthPrompt ?? "")
    setCharacterFirstMessage(character.firstMessage ?? "")
    setCharacterGreetings((character.alternateGreetings ?? []).join("\n"))
    setCharacterTags((character.tags ?? []).join(", "))
    setError()
  }

  const createCharacter = () => {
    setEditingCharacterID()
    setCreatingCharacter(true)
    setCharacterName("")
    setCharacterPrompt("")
    setCharacterPersonality("")
    setCharacterScenario("")
    setCharacterExampleDialogue("")
    setCharacterSystemPrompt("")
    setCharacterPostHistoryInstructions("")
    setCharacterDepthPrompt("")
    setCharacterFirstMessage("")
    setCharacterGreetings("")
    setCharacterTags("")
    setExpressionLabel("")
    setError()
  }

  const saveCharacter = async () => {
    const current = data()
    const character = editingCharacter()
    if (!current || (!character && !creatingCharacter())) return
    try {
      const input = {
        name: characterName(),
        prompt: characterPrompt(),
        description: characterPrompt(),
        personality: characterPersonality(),
        scenario: characterScenario(),
        exampleDialogue: characterExampleDialogue(),
        systemPrompt: characterSystemPrompt(),
        postHistoryInstructions: characterPostHistoryInstructions(),
        depthPrompt: characterDepthPrompt(),
        firstMessage: characterFirstMessage(),
        alternateGreetings: characterGreetings(),
        tags: characterTags(),
      }
      const next = character
        ? updateTavernCharacter({ character, ...input })
        : createTavernCharacter({ id: crypto.randomUUID(), ...input })
      await save({
        ...current,
        characters: character ? current.characters.map((item) => (item.id === next.id ? next : item)) : [...current.characters, next],
      })
      setEditingCharacterID()
      setCreatingCharacter(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存角色失败")
    }
  }

  const addCharacterExpression = async (file: File) => {
    const current = data()
    const character = editingCharacter()
    if (!current || !character || expressionUploadBusy()) return
    setExpressionUploadBusy(true)
    setError()
    try {
      const result = await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "visualAssetPut",
        pluginActionInput: { input: { filename: file.name, base64: await toBase64(file) } },
      })
      const stored = result.data?.value as Partial<Pick<TavernVisualAsset, "path" | "mime">> | undefined
      if (!stored?.path || !stored.mime) throw new Error("酒馆没有保存表情图片")
      const label = expressionLabel().trim() || file.name.replace(/\.[^.]+$/, "")
      const expression = {
        id: crypto.randomUUID(),
        label,
        path: stored.path,
        mime: stored.mime,
      } satisfies TavernVisualAsset
      await save({
        ...current,
        characters: current.characters.map((item) =>
          item.id === character.id
            ? { ...item, expressions: [...(item.expressions ?? []), expression], source: undefined }
            : item,
        ),
      })
      setExpressionLabel("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加角色表情失败")
    } finally {
      setExpressionUploadBusy(false)
    }
  }

  const removeCharacterExpression = async (expression: TavernVisualAsset) => {
    const current = data()
    const character = editingCharacter()
    if (!current || !character) return
    try {
      await save({
        ...current,
        characters: current.characters.map((item) =>
          item.id === character.id
            ? {
                ...item,
                expressions: (item.expressions ?? []).filter((candidate) => candidate.id !== expression.id),
                source: undefined,
              }
            : item,
        ),
      })
      await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "visualAssetRemove",
        pluginActionInput: { input: { path: expression.path } },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除角色表情失败")
    }
  }

  const editRecord = (kind: "personas" | "presets", item: TavernPersona | TavernPreset) => {
    setEditingRecord({ kind, id: item.id })
    setEditingRecordName(item.name)
    setEditingRecordContent(
      kind === "personas"
        ? tavernPersonaDescription(item as TavernPersona)
        : tavernPresetConfigText(item as TavernPreset),
    )
    setError()
  }

  const saveRecord = async () => {
    const current = data()
    if (!current) return
    try {
      if (editingPersona()) {
        const next = updateTavernPersona({
          persona: editingPersona()!,
          name: editingRecordName(),
          description: editingRecordContent(),
        })
        await save({
          ...current,
          personas: (current.personas ?? []).map((item) => (item.id === next.id ? next : item)),
        })
      }
      if (editingPreset()) {
        const next = updateTavernPreset({
          preset: editingPreset()!,
          name: editingRecordName(),
          prompt: editingRecordContent(),
        })
        await save({ ...current, presets: (current.presets ?? []).map((item) => (item.id === next.id ? next : item)) })
      }
      setEditingRecord()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存共享资源失败")
    }
  }

  const createRecord = async () => {
    const current = data() ?? emptyTavernData()
    const name = recordName().trim()
    const prompt = recordPrompt().trim()
    if (!name || !prompt) {
      setError("请填写名称和内容")
      return
    }
    if (props.view === "personas") {
      const item: TavernPersona = { id: crypto.randomUUID(), name, description: prompt }
      await save({ ...current, personas: [...(current.personas ?? []).filter((entry) => entry.name !== name), item] })
    }
    if (props.view === "presets") {
      const item: TavernPreset = { id: crypto.randomUUID(), name, prompt, config: { name, system_prompt: prompt } }
      await save({ ...current, presets: [...(current.presets ?? []).filter((entry) => entry.name !== name), item] })
    }
    setRecordName("")
    setRecordPrompt("")
  }

  const createGroup = async () => {
    const current = data() ?? emptyTavernData()
    const name = groupName().trim()
    if (!name || groupMemberIDs().length === 0) {
      setError("请填写群组名称并至少选择一名角色")
      return
    }
    const item: TavernGroup = {
      id: crypto.randomUUID(),
      name,
      memberIDs: groupMemberIDs(),
      memberWeights: Object.fromEntries(groupMemberIDs().map((id) => [id, Math.max(0, groupMemberWeights()[id] ?? 1)])),
    }
    await save({ ...current, groups: [...(current.groups ?? []).filter((entry) => entry.name !== name), item] })
    setGroupName("")
    setGroupMemberIDs([])
    setGroupMemberWeights({})
  }

  const editGroup = (group: TavernGroup) => {
    setEditingGroupID(group.id)
    setEditingGroupName(group.name)
    setEditingGroupMemberIDs(group.memberIDs)
    setEditingGroupMemberWeights(group.memberWeights ?? {})
    setError()
  }

  const saveGroup = async () => {
    const current = data()
    const group = editingGroup()
    if (!current || !group) return
    try {
      const next = updateTavernGroup({
        group,
        name: editingGroupName(),
        memberIDs: editingGroupMemberIDs(),
        memberWeights: editingGroupMemberWeights(),
      })
      await save({
        ...current,
        groups: (current.groups ?? []).map((item) => (item.id === next.id ? next : item)),
        sessions: rebindTavernGroupSpeakers({ sessions: current.sessions, group: next }),
      })
      setEditingGroupID()
      setEditingGroupName("")
      setEditingGroupMemberIDs([])
      setEditingGroupMemberWeights({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存群组失败")
    }
  }

  const setHistoryCharacter = async (historyID: string, characterID: string) => {
    const current = data()
    if (!current) return
    const next = setTavernHistoryCharacter({
      chats: current.chats,
      characters: current.characters,
      sessions: current.sessions,
      historyID,
      characterID: characterID || undefined,
    })
    if (!next) {
      setError("这条历史没有可绑定的酒馆会话")
      return
    }
    await save({ ...current, ...next })
  }

  const importHistory = async (file: File) => {
    const current = data() ?? emptyTavernData()
    const character = current.characters.find((item) => item.id === historyImportCharacterID())
    const messages = parseSillyTavernHistory(await file.text())
    setImportingHistory(true)
    setError()
    try {
      const created = await sdk.client.session.importHistory({
        projectID: props.projectID,
        extension: { pluginID: "lfcode-tavern", type: "tavern" },
        title: `${file.name.replace(/\.[^.]+$/, "")} 的导入历史`,
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
        messages,
      })
      if (!created.data) throw new Error("未能创建酒馆导入会话")
      const stored = await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "historyArchive",
        pluginActionInput: { input: { filename: file.name, base64: await toBase64(file) } },
      })
      const history: TavernHistory = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        path: file.name,
        source: (stored.data?.value as { path?: string } | undefined)?.path,
        characterID: character?.id,
        sessionID: created.data.id,
      }
      await save({
        ...current,
        chats: [...current.chats, history],
        sessions: {
          ...current.sessions,
          [created.data.id]: {
            characterID: character?.id,
            worldbookIDs: character?.worldbookIDs ?? [],
          },
        },
      })
      setHistoryImportCharacterID("")
      navigate(`/${base64Encode(props.worktree)}/session/${created.data.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入聊天历史失败")
    } finally {
      setImportingHistory(false)
      if (historyImportInput) historyImportInput.value = ""
    }
  }

  const exportHistory = async (history: TavernHistory) => {
    if (!history.sessionID || exportingHistory()) return
    setExportingHistory(history.id)
    setError()
    try {
      const messages: unknown[] = []
      let before: string | undefined
      for (let page = 0; page < 100; page++) {
        const result = await sdk.client.session.messages({
          sessionID: history.sessionID,
          agent_id: "*",
          limit: 100,
          before,
        })
        messages.push(...(result.data ?? []))
        const next = result.response.headers.get("x-next-cursor") ?? undefined
        if (!next) break
        before = next
      }
      const content = serializeSillyTavernHistory(messages.reverse())
      const filename = `${history.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "tavern-history"}.jsonl`
      const base64 = btoa(Array.from(new TextEncoder().encode(content), (byte) => String.fromCharCode(byte)).join(""))
      const output = await platform.saveFilePickerDialog?.({ title: "导出酒馆聊天", defaultPath: filename })
      if (platform.saveFilePickerDialog && !output) return
      if (output) {
        await sdk.client.plugin.action({
          pluginID: "lfcode-tavern",
          action: "historyExport",
          pluginActionInput: { input: { output, base64 } },
        })
        return
      }
      downloadTavernExport({ base64, filename, mime: "application/x-ndjson" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出聊天历史失败")
    } finally {
      setExportingHistory()
    }
  }

  const historyCharacterID = (history: TavernHistory) =>
    history.characterID ?? (history.sessionID ? data()?.sessions[history.sessionID]?.characterID : undefined) ?? ""
  const filteredHistory = createMemo(() =>
    filterTavernHistory({
      chats: data()?.chats ?? [],
      characters: data()?.characters ?? [],
      sessions: data()?.sessions ?? {},
      query: historyQuery(),
      characterID: historyFilterCharacterID() || undefined,
    }),
  )
  const libraryTags = createMemo(() => tavernCharacterTags(data()?.characters ?? []))
  const filteredCharacters = createMemo(() =>
    filterTavernCharacters({ characters: data()?.characters ?? [], query: characterQuery(), tag: characterTag() || undefined }),
  )
  const viewSettings = () => normalizeTavernViewSettings(data()?.settings)
  const title = () =>
    ({
      new: "新建酒馆对话",
      characters: "角色管理",
      personas: "Persona 身份",
      presets: "对话预设",
      groups: "群组管理",
      worldbooks: "世界书管理",
      history: "聊天历史",
      trash: "回收站",
      settings: "酒馆设置",
    })[props.view]
  const items = () => {
    if (props.view === "characters") return filteredCharacters()
    if (props.view === "personas") return data()?.personas ?? []
    if (props.view === "presets") return data()?.presets ?? []
    if (props.view === "groups") return data()?.groups ?? []
    return data()?.worldbooks ?? []
  }
  const itemDescription = (item: TavernCharacter | TavernWorldbook | TavernPersona | TavernPreset | TavernGroup) => {
    if (props.view === "personas") return (item as TavernPersona).description || "未设置身份描述"
    if (props.view === "presets") return (item as TavernPreset).prompt || "原版格式预设（暂无直接提示词）"
    if (props.view === "groups") return `包含 ${(item as TavernGroup).memberIDs.length} 名角色`
    if ("memberIDs" in item) return `包含 ${item.memberIDs.length} 名角色`
    if ("description" in item) return item.description || "未设置身份描述"
    if ("prompt" in item) return item.prompt || "未设置对话提示词"
    if ("content" in item) return "JSON 世界书"
    return "未设置角色描述"
  }

  return (
    <div class="h-full overflow-auto bg-background-stronger px-6 py-8">
      <div class="mx-auto flex w-full max-w-220 flex-col gap-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <button
              type="button"
              class="mb-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
              data-automation-id="tavern-manager-back"
              onClick={() => navigate(`/${base64Encode(props.worktree)}/session`)}
            >
              <Icon name="arrow-left" size="small" />
              返回酒馆
            </button>
            <div>
              <h1 class="text-20-medium text-text-strong">{title()}</h1>
              <p class="mt-1 text-13-regular text-text-weak">
                <Show when={props.view === "new"}>先选择角色；该角色绑定的世界书会随对话自动加载。</Show>
                <Show when={props.view === "characters"}>
                  新建角色，或导入 SillyTavern JSON / PNG 角色卡；导入文件保存在酒馆插件的私有目录。
                </Show>
                <Show when={props.view === "personas"}>Persona 定义玩家在叙事中的身份，并会随会话保存。</Show>
                <Show when={props.view === "presets"}>预设为该会话增加自定义叙事约束或写作提示。</Show>
                <Show when={props.view === "groups"}>创建由多个角色构成的群组；对话中可随时选择当前发言角色。</Show>
                <Show when={props.view === "worldbooks"}>导入 JSON 世界书，角色可在新建对话时自动加载绑定世界书。</Show>
                <Show when={props.view === "history"}>为未自动匹配的迁移历史选择角色；绑定会同步到对应酒馆会话。</Show>
                <Show when={props.view === "trash"}>
                  已移除的角色、世界书、Persona、预设和群组可在这里恢复；原始导入文件不会随移除删除。
                </Show>
                <Show when={props.view === "settings"}>控制酒馆会话的 HTML 渲染、剧情预测、朗读、沉浸与双视图。</Show>
              </p>
            </div>
          </div>
          <Show when={props.view === "characters" || props.view === "worldbooks"}>
            <div class="flex flex-wrap gap-2">
              <Show when={props.view === "characters"}>
                <button
                  type="button"
                  class="rounded-lg border border-border-base px-3 py-2 text-13-medium text-text-base hover:bg-surface-base-hover"
                  data-automation-id="tavern-create-character"
                  onClick={createCharacter}
                >
                  新建角色
                </button>
              </Show>
              <button
                type="button"
                class="rounded-lg bg-icon-info-base px-3 py-2 text-13-medium text-white"
                onClick={() => input?.click()}
              >
                导入{props.view === "characters" ? "角色卡" : "世界书"}
              </button>
            </div>
          </Show>
        </div>

        <Show when={props.view === "characters"}>
          <div class="flex flex-wrap items-center gap-2" data-automation-id="tavern-character-library-filters">
            <input
              class="min-w-48 flex-1 rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
              type="search"
              placeholder="搜索角色、设定或标签"
              value={characterQuery()}
              data-automation-id="tavern-character-search"
              onInput={(event) => setCharacterQuery(event.currentTarget.value)}
            />
            <select
              class="rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
              value={characterTag()}
              data-automation-id="tavern-character-tag-filter"
              onChange={(event) => setCharacterTag(event.currentTarget.value)}
            >
              <option value="">全部标签</option>
              <For each={libraryTags()}>{(tag) => <option value={tag}>{tag}</option>}</For>
            </select>
            <span class="text-12-regular text-text-weak" data-automation-id="tavern-character-result-count">
              {filteredCharacters().length} / {data()?.characters.length ?? 0}
            </span>
          </div>
        </Show>

        <Show when={props.view === "new"}>
          <div class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
            <Show
              when={(data()?.characters.length ?? 0) > 0}
              fallback={
                <div class="px-4 py-10 text-center text-13-regular text-text-weak">请先在角色管理中导入角色卡</div>
              }
            >
              <div class="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                <For each={data()?.characters ?? []}>
                  {(item) => (
                    <button
                      type="button"
                      data-automation-id={`tavern-character-${item.id}`}
                      class="rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface-base-hover"
                      classList={{
                        "border-icon-info-base bg-icon-info-base/10": characterID() === item.id,
                        "border-border-base": characterID() !== item.id,
                      }}
                      onClick={() => {
                        setCharacterID(item.id)
                        setGroupID()
                      }}
                    >
                      <div class="flex items-center gap-2">
                        <TavernCharacterAvatar character={item} />
                        <div class="min-w-0 truncate text-14-medium text-text-strong">{item.name}</div>
                      </div>
                      <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">
                        {item.prompt || "未设置角色描述"}
                      </div>
                      <Show when={item.worldbookIDs.length}>
                        <div class="mt-2 text-11-regular text-text-weak">
                          自动加载 {item.worldbookIDs.length} 本世界书
                        </div>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={(data()?.groups?.length ?? 0) > 0}>
              <div class="border-t border-border-base p-3">
                <div class="mb-2 text-12-medium text-text-weak">或选择群组</div>
                <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <For each={data()?.groups ?? []}>
                    {(item) => (
                      <button
                        type="button"
                        data-automation-id={`tavern-group-${item.id}`}
                        class="rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface-base-hover"
                        classList={{
                          "border-icon-info-base bg-icon-info-base/10": groupID() === item.id,
                          "border-border-base": groupID() !== item.id,
                        }}
                        onClick={() => {
                          setGroupID(item.id)
                          setCharacterID()
                        }}
                      >
                        <div class="truncate text-14-medium text-text-strong">{item.name}</div>
                        <div class="mt-1 text-12-regular text-text-weak">{item.memberIDs.length} 名角色</div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
          <button
            data-automation-id="tavern-create-conversation"
            class="self-start rounded-lg bg-icon-info-base px-4 py-2 text-13-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={(!character() && !group()) || creating()}
            onClick={() => void createConversation()}
          >
            {creating() ? "正在创建…" : group() ? "以此群组开始对话" : "以此角色开始对话"}
          </button>
        </Show>

        <Show when={props.view === "personas" || props.view === "presets"}>
          <section class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4">
            <div class="grid gap-3">
              <input
                class="rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                placeholder={props.view === "personas" ? "Persona 名称" : "预设名称"}
                value={recordName()}
                onInput={(event) => setRecordName(event.currentTarget.value)}
              />
              <textarea
                class="min-h-24 rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                placeholder={props.view === "personas" ? "玩家身份、背景与行为描述" : "叙事约束或提示词"}
                value={recordPrompt()}
                onInput={(event) => setRecordPrompt(event.currentTarget.value)}
              />
              <button
                type="button"
                data-automation-id={`tavern-create-${props.view === "personas" ? "persona" : "preset"}`}
                class="self-start rounded-md bg-icon-info-base px-3 py-2 text-13-medium text-white"
                onClick={() => void createRecord()}
              >
                {props.view === "personas" ? "保存 Persona" : "保存预设"}
              </button>
            </div>
          </section>
        </Show>

        <Show when={props.view === "groups" && !editingGroup()}>
          <section class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4">
            <input
              class="block w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
              placeholder="群组名称"
              value={groupName()}
              onInput={(event) => setGroupName(event.currentTarget.value)}
            />
            <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <For each={data()?.characters ?? []}>
                {(item) => (
                  <div class="flex items-center gap-2 rounded-md border border-border-base px-3 py-2 text-13-regular text-text-base">
                    <label class="min-w-0 flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupMemberIDs().includes(item.id)}
                        onChange={(event) => {
                          const selected = event.currentTarget.checked
                          setGroupMemberIDs(
                            selected ? [...groupMemberIDs(), item.id] : groupMemberIDs().filter((id) => id !== item.id),
                          )
                          setGroupMemberWeights((current) =>
                            selected
                              ? { ...current, [item.id]: current[item.id] ?? 1 }
                              : Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)),
                          )
                        }}
                      />
                      {item.name}
                    </label>
                    <label class="flex items-center gap-1 text-11-regular text-text-weak">
                      权重
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        class="w-14 rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base disabled:opacity-50"
                        aria-label={`${item.name} 的随机发言权重`}
                        disabled={!groupMemberIDs().includes(item.id)}
                        value={groupMemberWeights()[item.id] ?? 1}
                        onInput={(event) =>
                          setGroupMemberWeights((current) => ({
                            ...current,
                            [item.id]: Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)),
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
              </For>
            </div>
            <button
              type="button"
              data-automation-id="tavern-create-group"
              class="mt-3 rounded-md bg-icon-info-base px-3 py-2 text-13-medium text-white"
              onClick={() => void createGroup()}
            >
              保存群组
            </button>
          </section>
        </Show>
        <Show when={props.view === "groups" && editingGroup()}>
          <section
            class="mt-4 overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4"
            data-automation-id="tavern-group-editor"
          >
            <div class="grid gap-3">
              <label class="text-12-regular text-text-weak">
                群组名称
                <input
                  class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={editingGroupName()}
                  onInput={(event) => setEditingGroupName(event.currentTarget.value)}
                />
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white"
                  data-automation-id="tavern-group-save"
                  onClick={() => void saveGroup()}
                >
                  保存群组
                </button>
                <button
                  type="button"
                  class="rounded-md px-3 py-2 text-12-medium text-text-weak hover:bg-surface-base-hover"
                  onClick={() => setEditingGroupID()}
                >
                  取消
                </button>
              </div>
              <div class="max-h-96 overflow-y-auto pr-1">
                <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <For each={data()?.characters ?? []}>
                    {(item) => (
                      <div class="flex items-center gap-2 rounded-md border border-border-base px-3 py-2 text-13-regular text-text-base">
                        <label class="min-w-0 flex flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editingGroupMemberIDs().includes(item.id)}
                            onChange={(event) => {
                              const selected = event.currentTarget.checked
                              setEditingGroupMemberIDs((current) =>
                                selected ? [...current, item.id] : current.filter((id) => id !== item.id),
                              )
                              setEditingGroupMemberWeights((current) =>
                                selected
                                  ? { ...current, [item.id]: current[item.id] ?? 1 }
                                  : Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)),
                              )
                            }}
                          />
                          {item.name}
                        </label>
                        <label class="flex items-center gap-1 text-11-regular text-text-weak">
                          权重
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            class="w-14 rounded border border-border-base bg-background-base px-1 py-0.5 text-text-base disabled:opacity-50"
                            aria-label={`${item.name} 的随机发言权重`}
                            disabled={!editingGroupMemberIDs().includes(item.id)}
                            value={editingGroupMemberWeights()[item.id] ?? 1}
                            onInput={(event) =>
                              setEditingGroupMemberWeights((current) => ({
                                ...current,
                                [item.id]: Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)),
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </section>
        </Show>

        <Show when={props.view === "characters" || props.view === "worldbooks"}>
          <input
            ref={(el) => (input = el)}
            class="hidden"
            type="file"
            accept={props.view === "characters" ? ".json,image/png" : "application/json,.json"}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (!file) return
              void importFile(file).catch((cause) => setError(cause instanceof Error ? cause.message : "导入失败"))
            }}
          />
        </Show>
        <Show when={props.view === "characters" && (editingCharacter() || creatingCharacter())}>
          <section
            class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4"
            data-automation-id="tavern-character-editor"
          >
            <div class="grid gap-3">
              <h2 class="text-15-medium text-text-strong">{creatingCharacter() ? "新建角色" : "编辑角色"}</h2>
              <label class="text-12-regular text-text-weak">
                角色名称
                <input
                  class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterName()}
                  onInput={(event) => setCharacterName(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                角色描述
                <textarea
                  class="mt-1 block min-h-40 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterPrompt()}
                  onInput={(event) => setCharacterPrompt(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                性格
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterPersonality()}
                  onInput={(event) => setCharacterPersonality(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                场景
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterScenario()}
                  onInput={(event) => setCharacterScenario(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                示例对话
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterExampleDialogue()}
                  onInput={(event) => setCharacterExampleDialogue(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                系统提示
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterSystemPrompt()}
                  onInput={(event) => setCharacterSystemPrompt(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                历史后指令
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterPostHistoryInstructions()}
                  onInput={(event) => setCharacterPostHistoryInstructions(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                深度提示
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterDepthPrompt()}
                  onInput={(event) => setCharacterDepthPrompt(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                开场白
                <textarea
                  class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterFirstMessage()}
                  onInput={(event) => setCharacterFirstMessage(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                备用开场白（每行一条）
                <textarea
                  class="mt-1 block min-h-20 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterGreetings()}
                  onInput={(event) => setCharacterGreetings(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                标签（逗号分隔）
                <input
                  class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={characterTags()}
                  onInput={(event) => setCharacterTags(event.currentTarget.value)}
                />
              </label>
              <div class="border-t border-border-base pt-3">
                <div class="text-12-medium text-text-strong">角色表情</div>
                <p class="mt-1 text-11-regular text-text-weak">
                  为当前角色添加可在会话中切换的 PNG、JPEG、GIF 或 WebP 图片。
                </p>
                <div class="mt-2 flex flex-wrap items-end gap-2">
                  <label class="min-w-40 flex-1 text-11-regular text-text-weak">
                    表情名称
                    <input
                      class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-1.5 text-12-regular text-text-base"
                      value={expressionLabel()}
                      placeholder="例如：微笑"
                      onInput={(event) => setExpressionLabel(event.currentTarget.value)}
                    />
                  </label>
                  <input
                    ref={expressionInput}
                    class="hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      if (file) void addCharacterExpression(file)
                      event.currentTarget.value = ""
                    }}
                  />
                  <button
                    type="button"
                    class="rounded-md border border-border-base px-3 py-2 text-12-medium text-text-base hover:bg-surface-base-hover disabled:opacity-50"
                    data-automation-id="tavern-character-expression-add"
                    disabled={!editingCharacter() || expressionUploadBusy()}
                    onClick={() => expressionInput?.click()}
                  >
                    {expressionUploadBusy() ? "上传中…" : "添加表情"}
                  </button>
                </div>
                <Show
                  when={(editingCharacter()?.expressions?.length ?? 0) > 0}
                  fallback={<p class="mt-2 text-11-regular text-text-weak">尚未添加表情图片。</p>}
                >
                  <div class="mt-2 flex flex-wrap gap-2">
                    <For each={editingCharacter()?.expressions ?? []}>
                      {(expression) => (
                        <div class="flex items-center gap-2 rounded-md border border-border-base px-2 py-1 text-12-regular text-text-base">
                          <span>{expression.label}</span>
                          <button
                            type="button"
                            class="text-text-weak hover:text-icon-critical-base"
                            aria-label={`移除表情 ${expression.label}`}
                            onClick={() => void removeCharacterExpression(expression)}
                          >
                            移除
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white"
                  data-automation-id="tavern-character-save"
                  onClick={() => void saveCharacter()}
                >
                  {creatingCharacter() ? "创建角色" : "保存角色"}
                </button>
                <button
                  type="button"
                  class="rounded-md px-3 py-2 text-12-medium text-text-weak hover:bg-surface-base-hover"
                  onClick={() => {
                    setEditingCharacterID()
                    setCreatingCharacter(false)
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </section>
        </Show>

        <Show when={(props.view === "personas" && editingPersona()) || (props.view === "presets" && editingPreset())}>
          <section
            class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4"
            data-automation-id="tavern-shared-resource-editor"
          >
            <div class="grid gap-3">
              <label class="text-12-regular text-text-weak">
                名称
                <input
                  class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={editingRecordName()}
                  onInput={(event) => setEditingRecordName(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                {props.view === "personas" ? "身份描述" : "原版预设 JSON"}
                <textarea
                  class="mt-1 block min-h-32 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 font-mono text-13-regular text-text-base"
                  value={editingRecordContent()}
                  onInput={(event) => setEditingRecordContent(event.currentTarget.value)}
                />
              </label>
              <Show when={props.view === "presets"}>
                <p class="text-11-regular text-text-weak">
                  完整保留原版字段；必须包含 system_prompt、prompt 或 content。
                </p>
              </Show>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white"
                  data-automation-id="tavern-shared-resource-save"
                  onClick={() => void saveRecord()}
                >
                  保存
                </button>
                <button
                  type="button"
                  class="rounded-md px-3 py-2 text-12-medium text-text-weak hover:bg-surface-base-hover"
                  onClick={() => setEditingRecord()}
                >
                  取消
                </button>
              </div>
            </div>
          </section>
        </Show>

        <Show when={props.view === "worldbooks" && editingWorldbook()}>
          <section
            class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4"
            data-automation-id="tavern-worldbook-editor"
          >
            <div class="grid gap-3">
              <label class="text-12-regular text-text-weak">
                世界书名称
                <input
                  class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
                  value={worldbookName()}
                  onInput={(event) => setWorldbookName(event.currentTarget.value)}
                />
              </label>
              <label class="text-12-regular text-text-weak">
                世界书 JSON
                <textarea
                  class="mt-1 block min-h-80 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 font-mono text-12-regular text-text-base"
                  value={worldbookContent()}
                  onInput={(event) => setWorldbookContent(event.currentTarget.value)}
                />
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white"
                  data-automation-id="tavern-worldbook-save"
                  onClick={() => void saveWorldbook()}
                >
                  保存世界书
                </button>
                <button
                  type="button"
                  class="rounded-md px-3 py-2 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                  onClick={() => {
                    setEditingWorldbookID()
                    setWorldbookName("")
                    setWorldbookContent("")
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </section>
        </Show>

        <Show
          when={
            props.view === "characters" ||
            props.view === "worldbooks" ||
            props.view === "personas" ||
            props.view === "presets" ||
            props.view === "groups"
          }
        >
          <div class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
            <Show
              when={items().length}
              fallback={
                <div class="px-4 py-10 text-center text-13-regular text-text-weak">
                  {props.view === "characters" && !!(characterQuery().trim() || characterTag())
                    ? "未找到匹配角色"
                    : "尚未导入任何内容"}
                </div>
              }
            >
              <For each={items()}>
                {(item) => (
                  <div class="flex items-center justify-between gap-4 border-b border-border-base px-4 py-3 last:border-b-0">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Show when={props.view === "characters"}>
                          <TavernCharacterAvatar character={item as TavernCharacter} />
                        </Show>
                        <div class="min-w-0 truncate text-14-medium text-text-strong">{item.name}</div>
                      </div>
                      <div class="mt-1 truncate text-12-regular text-text-weak">{itemDescription(item)}</div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Show when={props.view === "characters" || props.view === "worldbooks"}>
                        <button
                          class="whitespace-nowrap rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base disabled:opacity-50"
                          disabled={!!exporting()}
                          data-automation-id={`tavern-export-${item.id}`}
                          onClick={() => void exportItem(item.id)}
                        >
                          {exporting() === item.id ? "导出中…" : "导出"}
                        </button>
                      </Show>
                      <Show when={props.view === "worldbooks"}>
                        <button
                          class="whitespace-nowrap rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                          data-automation-id={`tavern-edit-worldbook-${item.id}`}
                          onClick={() => editWorldbook(item as TavernWorldbook)}
                        >
                          编辑
                        </button>
                      </Show>
                      <Show when={props.view === "characters"}>
                        <button
                          class="whitespace-nowrap rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                          data-automation-id={`tavern-edit-character-${item.id}`}
                          onClick={() => editCharacter(item as TavernCharacter)}
                        >
                          编辑
                        </button>
                      </Show>
                      <Show when={props.view === "groups"}>
                        <button
                          class="whitespace-nowrap rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                          data-automation-id={`tavern-edit-group-${item.id}`}
                          onClick={() => editGroup(item as TavernGroup)}
                        >
                          编辑
                        </button>
                      </Show>
                      <Show when={props.view === "personas" || props.view === "presets"}>
                        <button
                          class="whitespace-nowrap rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                          data-automation-id={`tavern-edit-${props.view}-${item.id}`}
                          onClick={() =>
                            editRecord(props.view as "personas" | "presets", item as TavernPersona | TavernPreset)
                          }
                        >
                          编辑
                        </button>
                      </Show>
                      <button
                        class="whitespace-nowrap rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-icon-critical-base"
                        onClick={() => void remove(item.id)}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={props.view === "history"}>
          <section
            class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base p-4"
            data-automation-id="tavern-history-import"
          >
            <div class="flex flex-wrap items-end gap-3">
              <label class="min-w-48 flex-1 text-12-regular text-text-weak">
                绑定角色（可选）
                <select
                  class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
                  value={historyImportCharacterID()}
                  onChange={(event) => setHistoryImportCharacterID(event.currentTarget.value)}
                >
                  <option value="">未绑定角色</option>
                  <For each={data()?.characters ?? []}>
                    {(character) => <option value={character.id}>{character.name}</option>}
                  </For>
                </select>
              </label>
              <input
                ref={historyImportInput}
                class="hidden"
                type="file"
                accept=".jsonl,.json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void importHistory(file)
                }}
              />
              <button
                type="button"
                class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white disabled:opacity-50"
                data-automation-id="tavern-history-import-button"
                disabled={importingHistory()}
                onClick={() => historyImportInput?.click()}
              >
                {importingHistory() ? "导入中…" : "导入 SillyTavern 聊天"}
              </button>
            </div>
            <p class="mt-3 text-11-regular text-text-weak">
              仅解析 JSONL 中的玩家和角色文本及 Swipe 候选；原文件会复制到酒馆插件私有目录。
            </p>
          </section>
          <div
            class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base"
            data-automation-id="tavern-history-list"
          >
            <div class="flex flex-wrap gap-2 border-b border-border-base px-4 py-3">
              <input
                class="min-w-48 flex-1 rounded-md border border-border-base bg-background-base px-2 py-1.5 text-12-regular text-text-base outline-none"
                data-automation-id="tavern-history-search"
                value={historyQuery()}
                placeholder="搜索历史、文件或角色"
                onInput={(event) => setHistoryQuery(event.currentTarget.value)}
              />
              <select
                class="rounded-md border border-border-base bg-background-base px-2 py-1.5 text-12-regular text-text-base"
                aria-label="筛选聊天历史角色"
                data-automation-id="tavern-history-filter-character"
                value={historyFilterCharacterID()}
                onChange={(event) => setHistoryFilterCharacterID(event.currentTarget.value)}
              >
                <option value="">全部角色</option>
                <option value="unbound">未绑定角色</option>
                <For each={data()?.characters ?? []}>
                  {(character) => <option value={character.id}>{character.name}</option>}
                </For>
              </select>
            </div>
            <Show
              when={(data()?.chats.length ?? 0) > 0 && filteredHistory().length > 0}
              fallback={
                <div class="px-4 py-10 text-center text-13-regular text-text-weak">
                  {(data()?.chats.length ?? 0) > 0 ? "没有匹配的聊天历史" : "尚未导入可管理的聊天历史"}
                </div>
              }
            >
              <For each={filteredHistory()}>
                {(item) => (
                  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-base px-4 py-3 last:border-b-0">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-14-medium text-text-strong">{item.name}</div>
                      <div class="mt-1 truncate text-12-regular text-text-weak">
                        {item.sessionID ? item.path : "没有可打开的已导入会话"}
                      </div>
                    </div>
                    <select
                      class="max-w-48 rounded-md border border-border-base bg-background-base px-2 py-1.5 text-12-regular text-text-base disabled:opacity-50"
                      data-automation-id={`tavern-history-character-${item.id}`}
                      disabled={!item.sessionID}
                      value={historyCharacterID(item)}
                      onChange={(event) =>
                        void setHistoryCharacter(item.id, event.currentTarget.value).catch((cause) =>
                          setError(cause instanceof Error ? cause.message : "更新角色绑定失败"),
                        )
                      }
                    >
                      <option value="">未绑定角色</option>
                      <For each={data()?.characters ?? []}>
                        {(character) => <option value={character.id}>{character.name}</option>}
                      </For>
                    </select>
                    <Show when={item.sessionID}>
                      <button
                        type="button"
                        class="rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                        data-automation-id={`tavern-history-open-${item.id}`}
                        onClick={() => navigate(`/${base64Encode(props.worktree)}/session/${item.sessionID}`)}
                      >
                        打开
                      </button>
                      <button
                        type="button"
                        class="rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base disabled:opacity-50"
                        data-automation-id={`tavern-history-export-${item.id}`}
                        disabled={!!exportingHistory()}
                        onClick={() => void exportHistory(item)}
                      >
                        {exportingHistory() === item.id ? "导出中…" : "导出"}
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={props.view === "trash"}>
          <div
            class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base"
            data-automation-id="tavern-trash-list"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border-base px-4 py-3">
              <div class="text-13-regular text-text-weak">
                清空只会移除回收站索引，不会删除角色卡、世界书或迁移归档中的原始文件。
              </div>
              <Show when={(data()?.trash?.length ?? 0) > 0}>
                <button
                  type="button"
                  class="shrink-0 rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-icon-critical-base"
                  data-automation-id="tavern-trash-empty"
                  onClick={() => void emptyTrash()}
                >
                  {confirmEmptyTrash() ? "再次点击确认清空" : "清空回收站"}
                </button>
              </Show>
            </div>
            <Show
              when={(data()?.trash?.length ?? 0) > 0}
              fallback={<div class="px-4 py-10 text-center text-13-regular text-text-weak">回收站为空</div>}
            >
              <For each={data()?.trash ?? []}>
                {(item) => (
                  <div class="flex items-center justify-between gap-4 border-b border-border-base px-4 py-3 last:border-b-0">
                    <div class="min-w-0">
                      <div class="truncate text-14-medium text-text-strong">{item.item.name}</div>
                      <div class="mt-1 text-12-regular text-text-weak">
                        {trashLabel(item.kind)} · {new Date(item.deletedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                      data-automation-id={`tavern-trash-restore-${item.id}`}
                      onClick={() => void restore(item.id)}
                    >
                      恢复
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={props.view === "settings"}>
          <div class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
            <For
              each={
                [
                  ["html", "酒馆 HTML 渲染", "以受控方式显示酒馆消息中的 HTML 内容"],
                  ["storyPrediction", "剧情预测", "在输入区显示下一步剧情建议"],
                  ["immersive", "沉浸模式", "收起酒馆导航、会话配置和消息导航轨，专注角色对话"],
                  ["dualView", "剧情双视图", "宽屏显示只读剧情侧栏；窄屏自动保持单栏对话"],
                ] as const
              }
            >
              {([key, label, description]) => (
                <label class="flex cursor-pointer items-center justify-between gap-4 border-b border-border-base px-4 py-4 last:border-b-0">
                  <span>
                    <span class="block text-14-medium text-text-strong">{label}</span>
                    <span class="mt-1 block text-12-regular text-text-weak">{description}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={
                      key === "immersive" || key === "dualView"
                        ? viewSettings()[key]
                        : (data()?.settings?.[key] ?? true)
                    }
                    onChange={(event) => {
                      const current = data() ?? emptyTavernData()
                      void save({ ...current, settings: { ...current.settings, [key]: event.currentTarget.checked } })
                    }}
                  />
                </label>
              )}
            </For>
          </div>
          <TavernVisualSettingsPanel data={data} save={save} />
          <TavernSpeechSettingsPanel data={data} save={save} />
          <TavernMemorySettingsPanel />
          <RoadwaySettingsPanel data={data} save={save} />
        </Show>
        <Show when={error()}>
          {(message) => (
            <div class="rounded-lg border border-icon-critical-base/30 bg-icon-critical-base/10 px-3 py-2 text-13-regular text-icon-critical-base">
              {message()}
            </div>
          )}
        </Show>
        <button class="self-start text-12-regular text-text-weak hover:text-text-base" onClick={() => void refetch()}>
          刷新数据
        </button>
      </div>
    </div>
  )
}

function TavernVisualSettingsPanel(props: {
  data: () => TavernData | undefined
  save: (next: TavernData) => Promise<void>
}) {
  const sdk = useSDK()
  const [error, setError] = createSignal<string>()
  const [uploading, setUploading] = createSignal(false)
  let input: HTMLInputElement | undefined
  const visual = () => normalizeTavernVisualSettings(props.data()?.settings?.visual)
  const uploadBackground = async (file: File) => {
    if (uploading()) return
    setUploading(true)
    setError()
    try {
      const result = await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "visualAssetPut",
        pluginActionInput: { input: { filename: file.name, base64: await toBase64(file) } },
      })
      const stored = result.data?.value as Partial<Pick<TavernVisualAsset, "path" | "mime">> | undefined
      if (!stored?.path || !stored.mime) throw new Error("酒馆没有保存背景图片")
      const background = {
        id: crypto.randomUUID(),
        label: file.name.replace(/\.[^.]+$/, ""),
        path: stored.path,
        mime: stored.mime,
      } satisfies TavernVisualAsset
      const previous = visual().background
      const current = props.data() ?? emptyTavernData()
      await props.save({ ...current, settings: { ...current.settings, visual: { ...visual(), background } } })
      if (previous) {
        await sdk.client.plugin.action({
          pluginID: "lfcode-tavern",
          action: "visualAssetRemove",
          pluginActionInput: { input: { path: previous.path } },
        })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存酒馆背景失败")
    } finally {
      setUploading(false)
    }
  }
  const clearBackground = async () => {
    const background = visual().background
    if (!background) return
    setError()
    try {
      const current = props.data() ?? emptyTavernData()
      await props.save({ ...current, settings: { ...current.settings, visual: {} } })
      await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "visualAssetRemove",
        pluginActionInput: { input: { path: background.path } },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除酒馆背景失败")
    }
  }
  return (
    <section class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
      <div class="border-b border-border-base px-4 py-3">
        <h2 class="text-15-medium text-text-strong">会话视觉</h2>
        <p class="mt-1 text-12-regular text-text-weak">背景图片与角色表情都只保存在 Tavern 插件私有目录。</p>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div class="text-13-medium text-text-strong">自定义背景</div>
          <div class="mt-1 text-12-regular text-text-weak">{visual().background?.label ?? "未设置"}</div>
        </div>
        <div class="flex items-center gap-2">
          <input
            ref={input}
            class="hidden"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void uploadBackground(file)
              event.currentTarget.value = ""
            }}
          />
          <button
            type="button"
            class="rounded-md border border-border-base px-3 py-2 text-12-medium text-text-base hover:bg-surface-base-hover disabled:opacity-50"
            data-automation-id="tavern-background-upload"
            disabled={uploading()}
            onClick={() => input?.click()}
          >
            {uploading() ? "上传中…" : visual().background ? "更换背景" : "选择背景"}
          </button>
          <Show when={visual().background}>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-icon-critical-base"
              data-automation-id="tavern-background-remove"
              onClick={() => void clearBackground()}
            >
              移除
            </button>
          </Show>
        </div>
      </div>
      <Show when={error()}>
        {(message) => (
          <div class="border-t border-icon-critical-base/30 px-4 py-2 text-12-regular text-icon-critical-base">
            {message()}
          </div>
        )}
      </Show>
    </section>
  )
}

function TavernSpeechSettingsPanel(props: {
  data: () => TavernData | undefined
  save: (next: TavernData) => Promise<void>
}) {
  const sdk = useSDK()
  const [voices, setVoices] = createSignal<SpeechSynthesisVoice[]>([])
  const [apiKey, setApiKey] = createSignal("")
  const [ttsError, setTtsError] = createSignal<string>()
  const [savingTts, setSavingTts] = createSignal(false)
  const [ttsStatus, { mutate: mutateTtsStatus, refetch: refetchTtsStatus }] = createResource(async () => {
    const result = await sdk.client.plugin.action({
      pluginID: "lfcode-tavern",
      action: "ttsStatus",
      pluginActionInput: { input: {} },
    })
    return result.data?.value as TavernTtsStatus
  })
  const settings = () => normalizeTavernSpeechSettings(props.data()?.settings?.tts)
  const update = (patch: Partial<TavernSpeechSettings>) => {
    const current = props.data() ?? emptyTavernData()
    void props.save({ ...current, settings: { ...current.settings, tts: { ...settings(), ...patch } } })
  }
  onMount(() => {
    if (!tavernSpeechAvailable()) return
    const refresh = () => setVoices(window.speechSynthesis.getVoices())
    refresh()
    window.speechSynthesis.addEventListener("voiceschanged", refresh)
    onCleanup(() => window.speechSynthesis.removeEventListener("voiceschanged", refresh))
  })
  const saveExternalTts = async () => {
    const current = ttsStatus()
    if (!current) return
    setSavingTts(true)
    setTtsError()
    try {
      await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "ttsConfigure",
        pluginActionInput: { input: { ...current.config, apiKey: apiKey() || undefined } },
      })
      setApiKey("")
      await refetchTtsStatus()
    } catch (cause) {
      setTtsError(formatServerError(cause, (key) => key, "保存 TTS 配置失败"))
    } finally {
      setSavingTts(false)
    }
  }
  return (
    <section class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
      <div class="border-b border-border-base px-4 py-3">
        <h2 class="text-15-medium text-text-strong">角色朗读</h2>
        <p class="mt-1 text-12-regular text-text-weak">
          系统语音不会上传内容；外部 TTS 只会将点选朗读的文本发送到你配置的服务。
        </p>
      </div>
      <label class="flex cursor-pointer items-center justify-between gap-4 border-b border-border-base px-4 py-3">
        <span>
          <span class="block text-13-medium text-text-strong">启用朗读</span>
          <span class="mt-1 block text-12-regular text-text-weak">角色回复下显示“朗读”操作。</span>
        </span>
        <input
          type="checkbox"
          checked={settings().enabled}
          onChange={(event) => {
            if (!event.currentTarget.checked) stopTavernSpeech()
            update({ enabled: event.currentTarget.checked })
          }}
        />
      </label>
      <label class="flex items-center justify-between gap-4 border-b border-border-base px-4 py-3">
        <span>
          <span class="block text-13-medium text-text-strong">朗读提供商</span>
          <span class="mt-1 block text-12-regular text-text-weak">可随时切回不联网的系统语音。</span>
        </span>
        <select
          class="rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base"
          value={settings().provider}
          onChange={(event) =>
            update({
              provider:
                event.currentTarget.value === "mimo"
                  ? "mimo"
                  : event.currentTarget.value === "openai-compatible"
                    ? "openai-compatible"
                    : "system",
            })
          }
        >
          <option value="system">系统语音</option>
          <option value="openai-compatible">OpenAI-compatible TTS</option>
          <option value="mimo">Xiaomi MiMo TTS</option>
        </select>
      </label>
      <Show when={settings().provider === "openai-compatible" || settings().provider === "mimo"}>
        <div class="grid gap-4 border-b border-border-base px-4 py-4 md:grid-cols-2">
          <label class="text-12-regular text-text-weak">
            Base URL
            <input
              class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
              value={ttsStatus()?.config.baseUrl ?? ""}
              placeholder="https://api.openai.com/v1"
              onInput={(event) =>
                mutateTtsStatus((current) =>
                  current ? { ...current, config: { ...current.config, baseUrl: event.currentTarget.value } } : current,
                )
              }
            />
          </label>
          <label class="text-12-regular text-text-weak">
            模型
            <input
              class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
              value={ttsStatus()?.config.model ?? ""}
              placeholder={settings().provider === "mimo" ? "mimo-v2.5-tts-voicedesign" : "gpt-4o-mini-tts"}
              onInput={(event) =>
                mutateTtsStatus((current) =>
                  current ? { ...current, config: { ...current.config, model: event.currentTarget.value } } : current,
                )
              }
            />
          </label>
          <label class="text-12-regular text-text-weak">
            音色
            <input
              class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
              value={ttsStatus()?.config.voice ?? ""}
              placeholder="alloy"
              onInput={(event) =>
                mutateTtsStatus((current) =>
                  current ? { ...current, config: { ...current.config, voice: event.currentTarget.value } } : current,
                )
              }
            />
          </label>
          <label class="text-12-regular text-text-weak">
            API Key
            <input
              type="password"
              autocomplete="off"
              class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
              value={apiKey()}
              placeholder={ttsStatus()?.hasSecret ? "已安全保存；留空保持不变" : "输入 API Key"}
              onInput={(event) => setApiKey(event.currentTarget.value)}
            />
          </label>
        </div>
        <div class="flex items-center gap-3 border-b border-border-base px-4 py-3">
          <button
            type="button"
            class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white disabled:opacity-50"
            disabled={savingTts() || ttsStatus()?.secureStorage !== "available"}
            onClick={() => void saveExternalTts()}
          >
            {savingTts() ? "保存中…" : "保存外部 TTS 配置"}
          </button>
          <span class="text-11-regular text-text-weak">
            {ttsStatus()?.hasSecret ? "API Key 已安全保存" : "尚未保存 API Key"}
          </span>
        </div>
        <Show when={ttsStatus()?.secureStorage === "unavailable"}>
          <p class="border-b border-border-base px-4 py-3 text-12-regular text-status-warning">
            当前运行环境不支持系统安全存储，请在桌面版配置密钥。
          </p>
        </Show>
        <Show when={ttsError()}>
          {(message) => (
            <p class="border-b border-border-base px-4 py-3 text-12-regular text-icon-critical-base">{message()}</p>
          )}
        </Show>
      </Show>
      <Show when={settings().provider === "system" && tavernSpeechAvailable()}>
        <label class="flex cursor-pointer items-center justify-between gap-4 border-b border-border-base px-4 py-3">
          <span>
            <span class="block text-13-medium text-text-strong">自动朗读新回复</span>
            <span class="mt-1 block text-12-regular text-text-weak">默认关闭；只朗读开启后新生成的角色回复。</span>
          </span>
          <input
            type="checkbox"
            checked={settings().autoPlay}
            disabled={!settings().enabled}
            onChange={(event) => update({ autoPlay: event.currentTarget.checked })}
          />
        </label>
        <div class="grid gap-4 border-b border-border-base px-4 py-4 md:grid-cols-2">
          <label class="text-12-regular text-text-weak">
            语音
            <select
              class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
              value={settings().voiceURI ?? ""}
              onChange={(event) => update({ voiceURI: event.currentTarget.value || undefined })}
            >
              <option value="">系统默认</option>
              <For each={voices()}>
                {(voice) => (
                  <option value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="text-12-regular text-text-weak">
            语速 {settings().rate.toFixed(1)}
            <input
              class="mt-2 block w-full"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings().rate}
              onInput={(event) => update({ rate: Number(event.currentTarget.value) })}
            />
          </label>
          <label class="text-12-regular text-text-weak">
            音调 {settings().pitch.toFixed(1)}
            <input
              class="mt-2 block w-full"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings().pitch}
              onInput={(event) => update({ pitch: Number(event.currentTarget.value) })}
            />
          </label>
          <label class="text-12-regular text-text-weak">
            音量 {Math.round(settings().volume * 100)}%
            <input
              class="mt-2 block w-full"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings().volume}
              onInput={(event) => update({ volume: Number(event.currentTarget.value) })}
            />
          </label>
        </div>
      </Show>
      <Show when={settings().provider === "system" && !tavernSpeechAvailable()}>
        <div class="px-4 py-3 text-12-regular text-text-weak">当前运行环境未提供系统语音，可改用外部 TTS。</div>
      </Show>
    </section>
  )
}

function TavernMemorySettingsPanel() {
  const sdk = useSDK()
  const [apiKey, setApiKey] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const [status, { mutate, refetch }] = createResource(async () => {
    const result = await sdk.client.plugin.action({
      pluginID: "lfcode-tavern",
      action: "memoryStatus",
      pluginActionInput: { input: {} },
    })
    return result.data?.value as TavernMemoryStatus
  })
  const save = async () => {
    const current = status()
    if (!current) return
    setSaving(true)
    setError()
    try {
      await sdk.client.plugin.action({
        pluginID: "lfcode-tavern",
        action: "memoryConfigure",
        pluginActionInput: { input: { ...current.config, apiKey: apiKey() || undefined } },
      })
      setApiKey("")
      await refetch()
    } catch (cause) {
      setError(formatServerError(cause, (key) => key, "保存 Embedding 配置失败"))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
      <div class="border-b border-border-base px-4 py-3">
        <h2 class="text-15-medium text-text-strong">长期记忆与 Embedding</h2>
        <p class="mt-1 text-12-regular text-text-weak">
          记忆按酒馆角色或群组项目隔离。只有在会话内明确开启自动召回时，输入才会发送至此处配置的兼容 Embedding 服务。
        </p>
      </div>
      <div class="grid gap-4 border-b border-border-base px-4 py-4 md:grid-cols-2">
        <label class="text-12-regular text-text-weak">
          Base URL
          <input
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            value={status()?.config.baseUrl ?? ""}
            placeholder="https://api.openai.com/v1"
            onInput={(event) =>
              mutate((current) =>
                current ? { ...current, config: { ...current.config, baseUrl: event.currentTarget.value } } : current,
              )
            }
          />
        </label>
        <label class="text-12-regular text-text-weak">
          Embedding 模型
          <input
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            value={status()?.config.model ?? ""}
            placeholder="text-embedding-3-small"
            onInput={(event) =>
              mutate((current) =>
                current ? { ...current, config: { ...current.config, model: event.currentTarget.value } } : current,
              )
            }
          />
        </label>
        <label class="text-12-regular text-text-weak md:col-span-2">
          API Key
          <input
            type="password"
            autocomplete="off"
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            value={apiKey()}
            placeholder={status()?.hasSecret ? "已安全保存；留空保持不变" : "输入 API Key"}
            onInput={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-3 border-b border-border-base px-4 py-3">
        <button
          type="button"
          class="rounded-md bg-icon-info-base px-3 py-2 text-12-medium text-white disabled:opacity-50"
          disabled={saving() || status()?.secureStorage !== "available"}
          onClick={() => void save()}
        >
          {saving() ? "保存中…" : "保存 Embedding 配置"}
        </button>
        <span class="text-11-regular text-text-weak">
          {status()?.hasSecret ? "API Key 已安全保存" : "尚未保存 API Key"} · 已索引 {status()?.indexed ?? 0} 条 ·
          待索引 {status()?.pending ?? 0} 条
        </span>
      </div>
      <Show when={status()?.secureStorage === "unavailable"}>
        <p class="border-b border-border-base px-4 py-3 text-12-regular text-status-warning">
          当前运行环境不支持系统安全存储，请在桌面版配置密钥。
        </p>
      </Show>
      <Show when={error()}>
        {(message) => <p class="px-4 py-3 text-12-regular text-icon-critical-base">{message()}</p>}
      </Show>
    </section>
  )
}

function RoadwaySettingsPanel(props: {
  data: () => TavernData | undefined
  save: (next: TavernData) => Promise<void>
}) {
  const local = useLocal()
  const settings = () => normalizeRoadwaySettings(props.data()?.settings?.roadway)
  const modelIndex = () =>
    local.model
      .list()
      .findIndex((item) => item.provider.id === settings().model?.providerID && item.id === settings().model?.modelID)
  const update = (patch: Partial<TavernRoadwaySettings>) => {
    const current = props.data() ?? emptyTavernData()
    void props.save({
      ...current,
      settings: { ...current.settings, roadway: { ...settings(), ...patch } },
    })
  }
  return (
    <section class="overflow-hidden rounded-xl border border-border-base bg-surface-raised-base">
      <div class="border-b border-border-base px-4 py-3">
        <h2 class="text-15-medium text-text-strong">Roadway 剧情建议</h2>
        <p class="mt-1 text-12-regular text-text-weak">根据当前酒馆对话生成玩家行动建议；辅助结果不会写入剧情消息。</p>
      </div>
      <label class="flex cursor-pointer items-center justify-between gap-4 border-b border-border-base px-4 py-3">
        <span>
          <span class="block text-13-medium text-text-strong">启用 Roadway</span>
          <span class="mt-1 block text-12-regular text-text-weak">在酒馆消息下显示行动建议入口。</span>
        </span>
        <input
          type="checkbox"
          checked={settings().enabled}
          onChange={(event) => update({ enabled: event.currentTarget.checked })}
        />
      </label>
      <div class="grid gap-4 border-b border-border-base px-4 py-4 md:grid-cols-2">
        <label class="text-12-regular text-text-weak">
          生成模型来源
          <select
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            value={settings().modelSource}
            onChange={(event) => update({ modelSource: event.currentTarget.value === "custom" ? "custom" : "session" })}
          >
            <option value="session">跟随当前酒馆对话模型</option>
            <option value="custom">使用指定模型</option>
          </select>
        </label>
        <Show when={settings().modelSource === "custom"}>
          <label class="text-12-regular text-text-weak">
            指定模型
            <select
              class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
              value={modelIndex() < 0 ? "" : String(modelIndex())}
              onChange={(event) => {
                const model = local.model.list()[Number(event.currentTarget.value)]
                if (model) update({ model: { providerID: model.provider.id, modelID: model.id } })
              }}
            >
              <option value="">选择模型</option>
              <For each={local.model.list()}>
                {(item, index) => (
                  <option value={String(index())}>
                    {item.provider.name} / {item.name}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
      </div>
      <div class="grid gap-4 border-b border-border-base px-4 py-4 md:grid-cols-2">
        <label class="text-12-regular text-text-weak">
          提取策略
          <select
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            value={settings().extractionStrategy}
            onChange={(event) =>
              update({ extractionStrategy: event.currentTarget.value === "none" ? "none" : "bullet" })
            }
          >
            <option value="bullet">编号 / 项目符号行动</option>
            <option value="none">保留完整文本</option>
          </select>
        </label>
        <label class="text-12-regular text-text-weak">
          消息角色
          <select
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            value={settings().messageRole}
            onChange={(event) =>
              update({ messageRole: event.currentTarget.value as TavernRoadwaySettings["messageRole"] })
            }
          >
            <option value="system">系统</option>
            <option value="user">用户</option>
            <option value="assistant">助手</option>
          </select>
        </label>
        <label class="text-12-regular text-text-weak">
          最大上下文消息数
          <input
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            type="number"
            min="1"
            max="200"
            value={settings().maxContextMessages}
            onChange={(event) => update({ maxContextMessages: Number(event.currentTarget.value) })}
          />
        </label>
        <label class="text-12-regular text-text-weak">
          最大输出 Token
          <input
            class="mt-1 block w-full rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-base"
            type="number"
            min="16"
            max="16000"
            value={settings().maxOutputTokens}
            onChange={(event) => update({ maxOutputTokens: Number(event.currentTarget.value) })}
          />
        </label>
      </div>
      <label class="block border-b border-border-base px-4 py-4 text-12-regular text-text-weak">
        Roadway 提示词
        <textarea
          class="mt-1 block min-h-32 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
          value={settings().prompt}
          onChange={(event) => update({ prompt: event.currentTarget.value })}
        />
      </label>
      <label class="block border-b border-border-base px-4 py-4 text-12-regular text-text-weak">
        代入为我提示词
        <textarea
          class="mt-1 block min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base"
          value={settings().impersonatePrompt}
          onChange={(event) => update({ impersonatePrompt: event.currentTarget.value })}
        />
      </label>
      <For
        each={
          [
            ["autoTrigger", "角色回复后自动生成", "默认关闭，避免每次回复自动消耗模型请求。"],
            ["autoOpen", "自动展开结果", "生成后自动展开 Roadway 结果卡。"],
            ["showUseAction", "显示使用按钮", "允许把建议写入酒馆输入框。"],
            ["autoSubmitUseAction", "使用后自动发送", "点击使用后直接发送该建议。"],
          ] as const
        }
      >
        {([key, label, description]) => (
          <label class="flex cursor-pointer items-center justify-between gap-4 border-b border-border-base px-4 py-3 last:border-b-0">
            <span>
              <span class="block text-13-medium text-text-strong">{label}</span>
              <span class="mt-1 block text-12-regular text-text-weak">{description}</span>
            </span>
            <input
              type="checkbox"
              checked={settings()[key]}
              onChange={(event) => update({ [key]: event.currentTarget.checked } as Partial<TavernRoadwaySettings>)}
            />
          </label>
        )}
      </For>
    </section>
  )
}

function emptyTavernData(): TavernData {
  return {
    characters: [],
    worldbooks: [],
    chats: [],
    sessions: {},
    settings: { roadway: defaultRoadwaySettings(), tts: defaultTavernSpeechSettings() },
  }
}

function TavernCharacterAvatar(props: { character: TavernCharacter }) {
  const sdk = useSDK()
  const path = createMemo(() => normalizeTavernAvatarPath(props.character.avatar))
  const [image] = createResource(path, async (avatar) => {
    const result = await sdk.client.plugin.action({
      pluginID: "lfcode-tavern",
      action: "visualAssetRead",
      pluginActionInput: { input: { paths: [avatar] } },
    })
    const value = result.data?.value
    return value && typeof value === "object" && typeof (value as Record<string, unknown>)[avatar] === "string"
      ? (value as Record<string, string>)[avatar]
      : undefined
  })
  return (
    <Show when={image()}>
      {(source) => (
        <img
          class="size-8 shrink-0 rounded-md border border-border-base object-cover"
          data-automation-id={`tavern-character-avatar-${props.character.id}`}
          src={source()}
          alt={`${props.character.name}头像`}
        />
      )}
    </Show>
  )
}

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let result = ""
  for (const byte of bytes) result += String.fromCharCode(byte)
  return btoa(result)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function trashLabel(kind: TavernTrashItem["kind"]) {
  if (kind === "characters") return "角色"
  if (kind === "worldbooks") return "世界书"
  if (kind === "personas") return "Persona"
  if (kind === "presets") return "预设"
  return "群组"
}
