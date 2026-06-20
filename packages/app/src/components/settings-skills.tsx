import { Button } from "@lfcode-ai/ui/button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { TextField } from "@lfcode-ai/ui/text-field"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { Tag } from "@lfcode-ai/ui/tag"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { SettingsList } from "./settings-list"
import {
  localSkillDirectory,
  localSkillKey,
  removeLocalSkill,
  replaceLocalSkill,
  skillImportSources,
  type LocalSkillItem,
  type SkillImportSource,
  type SkillMode,
} from "./settings-skills-helpers"

type DiscoveryRepository = {
  id: string
  owner: string
  repo: string
  label: string
  count: number
}

type DiscoverySkillItem = {
  source: "skills.sh"
  owner: string
  repo: string
  repository: string
  skill: string
  name: string
  description: string
  url: string
  install: string
  installed: boolean
}

type DiscoveryResponse = {
  items: DiscoverySkillItem[]
  repositories: DiscoveryRepository[]
  total: number
  page: number
  pageSize: number
}

const skillName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const sections = [
  { value: "repository", label: "settings.skills.section.repository" },
  { value: "skills-sh", label: "settings.skills.section.skillsSh" },
] as const
const statusOptions = [
  { value: "all", label: "settings.skills.filter.status.all" },
  { value: "installed", label: "settings.skills.filter.status.installed" },
  { value: "available", label: "settings.skills.filter.status.available" },
] as const

function apiUrl(base: string | undefined, directory: string | undefined, input: string, query?: Record<string, string | number | undefined>) {
  if (!base) return undefined
  const url = new URL(input, base)
  if (directory) url.searchParams.set("directory", directory)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function title(mode: SkillMode, language: ReturnType<typeof useLanguage>) {
  return mode === "manage" ? language.t("settings.skills.manage.title") : language.t("settings.skills.title")
}

function dirLabel(sessionDirectory: string | undefined, location: string) {
  if (!sessionDirectory) return location
  if (!location.startsWith(sessionDirectory)) return location
  const rel = location.slice(sessionDirectory.length).replace(/^[\\/]/, "")
  return rel || "."
}

export const SettingsSkills: Component<{ mode?: SkillMode; onModeChange?: (mode: SkillMode) => void }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const [innerMode, setInnerMode] = createSignal<SkillMode>("browse")
  const mode = createMemo(() => props.mode ?? innerMode())
  const setMode = (next: SkillMode) => {
    props.onModeChange?.(next)
    if (props.mode === undefined) setInnerMode(next)
  }
  const sessionDirectory = createMemo(() => directory())
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [busy, setBusy] = createSignal<"refresh" | "create" | "import" | "discover" | "manage">()
  const [section, setSection] = createSignal<(typeof sections)[number]["value"]>("repository")
  const [query, setQuery] = createSignal("")
  const [manageQuery, setManageQuery] = createSignal("")
  const [repository, setRepository] = createSignal("all")
  const [status, setStatus] = createSignal<(typeof statusOptions)[number]["value"]>("all")
  const [page, setPage] = createSignal(1)
  const [confirmDelete, setConfirmDelete] = createSignal<LocalSkillItem>()

  const authHeaders = () => {
    const current = server.current?.http
    if (!current?.password) return undefined
    return {
      Authorization: `Basic ${btoa(`${current.username ?? "lfcode"}:${current.password}`)}`,
    }
  }

  const request = async (input: string, init?: RequestInit) =>
    fetch(input, {
      ...init,
      headers: {
        ...(init?.headers && !(init?.headers instanceof Headers) ? init.headers : {}),
        ...authHeaders(),
      },
    })

  const [manageSkills, manageActions] = createResource(
    () => (mode() === "manage" ? refreshTick() : undefined),
    async () => {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/manage/list")
      if (!url) return [] as LocalSkillItem[]
      const res = await request(url)
      if (!res.ok) throw new Error(`Load skills failed: ${res.status}`)
      return ((await res.json()) as LocalSkillItem[]).toSorted((a, b) => localSkillKey(a).localeCompare(localSkillKey(b)))
    },
  )

  const [browseSkills, browseActions] = createResource(
    () => (mode() === "browse" && section() === "repository" ? refreshTick() : undefined),
    async () => {
      const url = apiUrl(server.current?.http.url, directory(), "/skills")
      if (!url) return [] as LocalSkillItem[]
      const res = await request(url)
      if (!res.ok) throw new Error(`Load skills failed: ${res.status}`)
      return (await res.json()) as LocalSkillItem[]
    },
  )

  const [discovery] = createResource(
    () => (mode() === "browse" && section() === "skills-sh" ? ([refreshTick(), query(), repository(), status(), page()] as const) : undefined),
    async () => {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/discover", {
        source: "skills.sh",
        q: query().trim() || undefined,
        repo: repository() !== "all" ? repository() : undefined,
        status: status() !== "all" ? status() : undefined,
        page: page(),
        pageSize: 24,
      })
      if (!url) return { items: [], repositories: [], total: 0, page: 1, pageSize: 24 }
      const res = await request(url)
      if (!res.ok) throw new Error(`Load skills failed: ${res.status}`)
      return (await res.json()) as DiscoveryResponse
    },
  )

  const manageItems = createMemo(() => manageSkills.latest ?? [])
  const browseItems = createMemo(() => browseSkills.latest ?? [])
  const discoveryData = createMemo<DiscoveryResponse>(() => discovery.latest ?? { items: [], repositories: [], total: 0, page: 1, pageSize: 24 })
  const localSkills = createMemo(() => (mode() === "manage" ? manageItems() : browseItems()))
  const filteredManageSkills = createMemo(() => {
    const term = manageQuery().trim().toLowerCase()
    const skills = localSkills()
    if (!term) return skills
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.location, skill.directory]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .some((value) => value.toLowerCase().includes(term)),
    )
  })
  const discoveryList = createMemo(() => discoveryData().items)
  const repositories = createMemo(() => discoveryData().repositories)
  const selectedRepository = createMemo(() => repositories().find((item) => item.id === repository()) ?? undefined)
  const totalPages = createMemo(() => Math.max(1, Math.ceil(discoveryData().total / discoveryData().pageSize)))

  const refresh = async () => {
    if (busy()) return
    setBusy("refresh")
    try {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/refresh")
      if (!url) return
      const res = await request(url, { method: "POST" })
      if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)
      setRefreshTick((v) => v + 1)
      await manageActions.refetch()
      await browseActions.refetch()
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const createSkill = async () => {
    if (busy()) return
    const name = window.prompt(language.t("settings.skills.create.name.prompt"))
    if (!name) return
    if (!skillName.test(name)) {
      showToast({ title: language.t("common.requestFailed"), description: language.t("settings.skills.create.name.invalid") })
      return
    }

    const description = window.prompt(language.t("settings.skills.create.description.prompt"))
    if (!description) return

    setBusy("create")
    try {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/create")
      if (!url) return
      const res = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      })
      if (!res.ok) throw new Error(`Create failed: ${res.status}`)
      setRefreshTick((v) => v + 1)
      await browseActions.refetch()
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const importSkill = async (kind: SkillImportSource) => {
    if (busy()) return
    const selected =
      kind === "folder"
        ? await platform.openDirectoryPickerDialog?.({ title: language.t("settings.skills.import.folder") })
        : kind === "zip"
          ? await platform.openFilePickerDialog?.({ title: language.t("settings.skills.import.zip"), extensions: ["zip"] })
          : undefined
    const source = Array.isArray(selected) ? selected[0] : selected
    if ((kind === "folder" || kind === "zip") && !source) return

    setBusy("import")
    try {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/import")
      if (!url) return
      const res = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...(source ? { source } : {}) }),
      })
      if (!res.ok) throw new Error(`Import failed: ${res.status}`)
      const imported = (await res.json()) as LocalSkillItem[]
      setRefreshTick((v) => v + 1)
      await browseActions.refetch()
      await manageActions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.skills.toast.imported.title"),
        description: language.t("settings.skills.toast.imported.description", { count: imported.length }),
      })
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const installSkill = async (item: DiscoverySkillItem) => {
    if (busy()) return
    setBusy("discover")
    try {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/discover/install")
      if (!url) return
      const res = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, owner: item.owner, repo: item.repo, skill: item.skill }),
      })
      if (!res.ok) throw new Error(`Install failed: ${res.status}`)
      setRefreshTick((v) => v + 1)
      await browseActions.refetch()
      await manageActions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.skills.toast.installed.title"),
        description: language.t("settings.skills.toast.installed.description", { skill: item.name }),
      })
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const toggleLocalSkill = async (item: LocalSkillItem, nextHidden: boolean) => {
    if (busy()) return
    setBusy("manage")
    const original = manageItems()
    try {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/manage/update")
      if (!url) return
      const res = await request(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: localSkillDirectory(item), hidden: nextHidden }),
      })
      if (!res.ok) throw new Error(`Update failed: ${res.status}`)
      const updated = (await res.json()) as LocalSkillItem
      manageActions.mutate((items) => replaceLocalSkill(items ?? original, updated))
      setRefreshTick((v) => v + 1)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: nextHidden ? language.t("settings.skills.manage.toast.hidden.title") : language.t("settings.skills.manage.toast.shown.title"),
        description: language.t(
          nextHidden ? "settings.skills.manage.toast.hidden.description" : "settings.skills.manage.toast.shown.description",
          { name: item.name },
        ),
      })
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const deleteLocalSkill = async (item: LocalSkillItem) => {
    if (busy()) return
    setBusy("manage")
    try {
      const url = apiUrl(server.current?.http.url, directory(), "/skills/manage/delete")
      if (!url) return
      const res = await request(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: localSkillDirectory(item) }),
      })
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      manageActions.mutate((items) => removeLocalSkill(items ?? [], localSkillKey(item)))
      setConfirmDelete(undefined)
      setRefreshTick((v) => v + 1)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.skills.manage.toast.deleted.title"),
        description: language.t("settings.skills.manage.toast.deleted.description", { name: item.name }),
      })
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div class="flex h-full flex-col overflow-y-auto no-scrollbar px-4 pb-10 sm:px-6 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[1120px] flex-col gap-4 pb-6 pt-6">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-16-medium text-text-strong">{title(mode(), language)}</h2>
              <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.skills.description")}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Show when={mode() === "browse"}>
                <Button size="large" variant="secondary" onClick={() => setMode("manage")} disabled={busy() !== undefined}>
                  <Icon name="edit-small-2" />
                  {language.t("settings.skills.action.manage")}
                </Button>
              </Show>
              <Show when={mode() === "manage"}>
                <Button size="large" variant="secondary" onClick={() => setMode("browse")} disabled={busy() !== undefined}>
                  <Icon name="arrow-left" />
                  {language.t("common.goBack")}
                </Button>
              </Show>
              <Button size="large" variant="secondary" onClick={() => void refresh()} disabled={busy() !== undefined}>
                <Icon name="reset" />
                {language.t("settings.skills.action.refresh")}
              </Button>
              <Show when={mode() === "browse"}>
                <Button size="large" variant="secondary" onClick={() => void createSkill()} disabled={busy() !== undefined}>
                  <Icon name="plus-small" />
                  {language.t("settings.skills.action.create")}
                </Button>
                <DropdownMenu>
                  <DropdownMenu.Trigger as={Button} size="large" variant="secondary" disabled={busy() !== undefined}>
                    <Icon name="folder-add-left" />
                    {language.t("settings.skills.action.import")}
                    <Icon name="chevron-down" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="mt-1 min-w-[220px]">
                      <For each={skillImportSources}>
                        {(option) => (
                          <DropdownMenu.Item onSelect={() => void importSkill(option.value)}>
                            <DropdownMenu.ItemLabel>{language.t(option.label)}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </Show>
            </div>
          </div>

          <Show when={mode() === "browse"}>
            <Tabs value={section()} onChange={(value) => setSection((value as (typeof sections)[number]["value"]) ?? "repository")}>
              <Tabs.List class="gap-2">
                <Tabs.Trigger value="repository">{language.t("settings.skills.section.repository")}</Tabs.Trigger>
                <Tabs.Trigger value="skills-sh">{language.t("settings.skills.section.skillsSh")}</Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </Show>

          <Show when={mode() === "browse"}>
            <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_180px_auto]">
              <div class="flex h-9 items-center gap-2 rounded-lg bg-surface-base px-3">
                <Icon name="magnifying-glass" class="flex-shrink-0 text-icon-weak-base" />
                <TextField
                  variant="ghost"
                  type="text"
                  value={query()}
                  onChange={(value) => {
                    setQuery(value)
                    setPage(1)
                  }}
                  placeholder={language.t("settings.skills.search.placeholder")}
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                  class="min-w-0 flex-1"
                />
                <Show when={query()}>
                  <IconButton icon="circle-x" variant="ghost" onClick={() => setQuery("")} />
                </Show>
              </div>

              <Select
                options={[
                  { value: "all", label: language.t("settings.skills.filter.repository.all") },
                  ...repositories().map((item) => ({ value: item.id, label: `${item.label} (${item.count})` })),
                ]}
                current={
                  repository() === "all"
                    ? { value: "all", label: language.t("settings.skills.filter.repository.all") }
                    : selectedRepository()
                      ? { value: selectedRepository()!.id, label: `${selectedRepository()!.label} (${selectedRepository()!.count})` }
                      : undefined
                }
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => {
                  setRepository(item?.value ?? "all")
                  setPage(1)
                }}
                placeholder={language.t("settings.skills.filter.repository.placeholder")}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "220px" }}
              />

              <Select
                options={statusOptions.map((item) => ({ value: item.value, label: language.t(item.label) }))}
                current={{ value: status(), label: language.t(statusOptions.find((item) => item.value === status())?.label ?? "settings.skills.filter.status.all") }}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => {
                  setStatus((item?.value ?? "all") as (typeof statusOptions)[number]["value"])
                  setPage(1)
                }}
                placeholder={language.t("settings.skills.filter.status.placeholder")}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "180px" }}
              />

              <Button size="large" variant="secondary" onClick={() => void browseActions.refetch()} disabled={busy() !== undefined}>
                <Icon name="reset" />
                {language.t("settings.skills.action.discover")}
              </Button>
            </div>
          </Show>

          <Show when={mode() === "manage"}>
            <div class="flex h-9 items-center gap-2 rounded-lg bg-surface-base px-3 xl:max-w-[520px]">
              <Icon name="magnifying-glass" class="flex-shrink-0 text-icon-weak-base" />
              <TextField
                variant="ghost"
                type="text"
                value={manageQuery()}
                onChange={setManageQuery}
                placeholder={language.t("settings.skills.manage.search.placeholder")}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                class="min-w-0 flex-1"
              />
              <Show when={manageQuery()}>
                <IconButton icon="circle-x" variant="ghost" onClick={() => setManageQuery("")} />
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="flex max-w-[1120px] flex-col gap-6">
        <Show when={mode() === "manage"}>
          <SettingsList>
            <Show
              when={!manageSkills.loading}
              fallback={
                <div class="flex flex-col items-center justify-center py-16 text-center text-text-weak">
                  <Icon name="reset" class="h-6 w-6 animate-spin" />
                </div>
              }
            >
              <Show
                when={filteredManageSkills().length > 0}
                fallback={<div class="py-8 text-center text-14-regular text-text-weak">{language.t("settings.skills.manage.empty")}</div>}
              >
                <For each={filteredManageSkills()}>
                  {(skill) => (
                    <div class="flex flex-col gap-3 border-b border-border-weak-base py-4 last:border-none">
                      <div class="flex flex-wrap items-start justify-between gap-4">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="truncate text-14-medium text-text-strong">{skill.name}</span>
                            <Show when={skill.hidden}>
                              <Tag>{language.t("settings.skills.hidden")}</Tag>
                            </Show>
                          </div>
                          <div class="truncate text-12-regular text-text-weak">{skill.description}</div>
                          <div class="truncate text-11-regular text-text-weaker">{dirLabel(directory(), skill.location)}</div>
                        </div>
                        <div class="flex flex-shrink-0 items-center gap-2">
                          <Button
                            size="large"
                            variant="secondary"
                            onClick={() =>
                              globalThis.navigator.clipboard.writeText(skill.content).catch(() => {
                                showToast({
                                  title: language.t("common.requestFailed"),
                                  description: language.t("settings.skills.copyFailed"),
                                })
                              })
                            }
                          >
                            {language.t("settings.skills.action.copy")}
                          </Button>
                          <Switch checked={!skill.hidden} onChange={(checked) => void toggleLocalSkill(skill, !checked)} hideLabel>
                            {language.t("settings.skills.manage.action.enabled")}
                          </Switch>
                          <IconButton
                            icon="trash"
                            variant="ghost"
                            onClick={() => setConfirmDelete(skill)}
                            aria-label={language.t("settings.skills.manage.action.delete")}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </SettingsList>
        </Show>

        <Show when={mode() === "browse" && section() === "repository"}>
          <SettingsList>
            <Show
              when={!browseSkills.loading}
              fallback={
                <div class="flex flex-col items-center justify-center py-16 text-center text-text-weak">
                  <Icon name="reset" class="h-6 w-6 animate-spin" />
                </div>
              }
            >
              <Show
                when={browseItems().length > 0}
                fallback={<div class="py-8 text-center text-14-regular text-text-weak">{language.t("settings.skills.empty")}</div>}
              >
                <For each={browseItems()}>
                  {(skill) => (
                    <div class="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-none">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="truncate text-14-medium text-text-strong">{skill.name}</span>
                          <Show when={skill.hidden}>
                            <span class="text-11-regular text-text-weak">{language.t("settings.skills.hidden")}</span>
                          </Show>
                        </div>
                        <div class="truncate text-12-regular text-text-weak">{skill.description}</div>
                        <div class="truncate text-11-regular text-text-weaker">{skill.location}</div>
                      </div>
                      <Button
                        size="large"
                        variant="ghost"
                        onClick={() =>
                          globalThis.navigator.clipboard.writeText(skill.content).catch(() => {
                            showToast({
                              title: language.t("common.requestFailed"),
                              description: language.t("settings.skills.copyFailed"),
                            })
                          })
                        }
                      >
                        {language.t("settings.skills.action.copy")}
                      </Button>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </SettingsList>
        </Show>

        <Show when={mode() === "browse" && section() === "skills-sh"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-4">
              <div class="text-14-medium text-text-strong">
                {language.t("settings.skills.discovery.title")}
                <span class="ml-2 text-text-weak">{language.t("settings.skills.discovery.subtitle")}</span>
              </div>
              <div class="text-12-regular text-text-weak">
                {language.t("settings.skills.discovery.count", {
                  count: discoveryData().total,
                })}
              </div>
            </div>

            <SettingsList>
              <Show
                when={!discovery.loading}
                fallback={
                  <div class="flex flex-col items-center justify-center py-16 text-center text-text-weak">
                    <Icon name="reset" class="h-6 w-6 animate-spin" />
                  </div>
                }
              >
                <Show
                  when={discoveryList().length > 0}
                  fallback={<div class="py-8 text-center text-14-regular text-text-weak">{language.t("settings.skills.discovery.empty")}</div>}
                >
                  <For each={discoveryList()}>
                    {(skill) => (
                      <div class="flex flex-col gap-3 border-b border-border-weak-base py-4 last:border-none">
                        <div class="flex flex-wrap items-start justify-between gap-4">
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="truncate text-14-medium text-text-strong">{skill.name}</span>
                              <Tag>{skill.repository}</Tag>
                              <Show when={skill.installed}>
                                <Tag>{language.t("settings.skills.discovery.installed")}</Tag>
                              </Show>
                            </div>
                            <div class="truncate text-12-regular text-text-weak">{skill.description}</div>
                            <div class="truncate text-11-regular text-text-weaker">{skill.url}</div>
                          </div>
                          <div class="flex gap-2">
                            <Button
                              size="large"
                              variant="secondary"
                              onClick={() =>
                                globalThis.navigator.clipboard.writeText(skill.install).catch(() => {
                                  showToast({
                                    title: language.t("common.requestFailed"),
                                    description: language.t("settings.skills.copyFailed"),
                                  })
                                })
                              }
                            >
                              {language.t("settings.skills.action.copyInstall")}
                            </Button>
                            <Button size="large" variant="ghost" onClick={() => void installSkill(skill)} disabled={busy() !== undefined}>
                              {language.t("settings.skills.action.install")}
                            </Button>
                          </div>
                        </div>
                        <div class="rounded-md border border-border-weak-base bg-background-base/50 px-3 py-2 text-12-regular text-text-weak">
                          {skill.install}
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </SettingsList>

            <div class="flex items-center justify-between text-12-regular text-text-weak">
              <span>
                {language.t("settings.skills.discovery.page", {
                  page: discoveryData().page,
                  total: totalPages(),
                })}
              </span>
              <div class="flex gap-2">
                <Button size="small" variant="secondary" disabled={page() <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  {language.t("settings.skills.discovery.prev")}
                </Button>
                <Button size="small" variant="secondary" disabled={page() >= totalPages()} onClick={() => setPage((value) => Math.min(totalPages(), value + 1))}>
                  {language.t("settings.skills.discovery.next")}
                </Button>
              </div>
            </div>
          </div>
        </Show>
      </div>

      <Show when={confirmDelete()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div class="w-full max-w-[440px] rounded-lg border border-border-weak-base bg-surface-base px-4 py-4 shadow-lg">
            <div class="text-14-medium text-text-strong">{language.t("settings.skills.manage.delete.title")}</div>
            <div class="pt-1 text-14-regular text-text-base">
              {language.t("settings.skills.manage.delete.confirm", { name: confirmDelete()!.name })}
            </div>
            <div class="pt-1 text-12-regular text-text-weak">{language.t("settings.skills.manage.delete.description")}</div>
            <div class="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(undefined)}>
                {language.t("common.cancel")}
              </Button>
              <Button variant="primary" disabled={busy() !== undefined} onClick={() => void deleteLocalSkill(confirmDelete()!)}>
                {language.t("settings.skills.manage.action.delete")}
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
