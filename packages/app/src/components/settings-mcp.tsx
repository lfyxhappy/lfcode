import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { Tag } from "@lfcode-ai/ui/tag"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { SettingsList } from "./settings-list"

type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "pending" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

type McpConfig =
  | {
      type: "local"
      command: string[]
      enabled?: boolean
      timeout?: number
      environment?: Record<string, string>
    }
  | {
      type: "remote"
      url: string
      enabled?: boolean
      timeout?: number
      headers?: Record<string, string>
      oauth?: { clientId?: string; clientSecret?: string; scope?: string; redirectUri?: string } | false
    }

type ManagedManifest = {
  adapter: "bundled-playwright" | "bundled-windows-computer-use" | "bundled-codegraph" | "minimax-token-plan" | "registry-remote"
  installedAt: string
}

type ManageItem = {
  name: string
  status: McpStatus
  origin: { type: string; source: string } | null
  managed: boolean
  installable: boolean
  installAdapter: "bundled-playwright" | "bundled-windows-computer-use" | "bundled-codegraph" | "minimax-token-plan" | "registry-remote" | null
  manifest: ManagedManifest | null
  config: McpConfig
}

type CatalogItem = {
  id: string
  serverName: string
  title: string
  description: string
  source: "official-registry" | "builtin"
  packageType: string
  transportType: string
  installable: boolean
  installed: boolean
  installAdapter: "bundled-playwright" | "bundled-windows-computer-use" | "bundled-codegraph" | "minimax-token-plan" | "registry-remote" | null
  installReason?: string
  official: boolean
  version?: string
}

type Mode = "installed" | "catalog"

function originLabel(item: ManageItem) {
  if (item.manifest) return "managed"
  if (!item.origin) return "unknown"
  return `${item.origin.type}:${item.origin.source}`
}

function statusKey(status: McpStatus) {
  switch (status.status) {
    case "connected":
      return "settings.mcp.status.connected"
    case "disabled":
      return "settings.mcp.status.disabled"
    case "pending":
      return "settings.mcp.status.pending"
    case "failed":
      return "settings.mcp.status.failed"
    case "needs_auth":
      return "settings.mcp.status.needsAuth"
    case "needs_client_registration":
      return "settings.mcp.status.needsClientRegistration"
  }
}

function statusError(status: McpStatus) {
  if (status.status === "failed" || status.status === "needs_client_registration") return status.error
}

export const SettingsMcp: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const sdk = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const [mode, setMode] = createSignal<Mode>("installed")
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [confirmDelete, setConfirmDelete] = createSignal<ManageItem>()
  const [editing, setEditing] = createSignal<ManageItem>()
  const [busy, setBusy] = createSignal<string>()
  const [target, setTarget] = createSignal<"project" | "global">("project")
  const [draftText, setDraftText] = createSignal("")
  const [installedError, setInstalledError] = createSignal<string>()
  const [catalogError, setCatalogError] = createSignal<string>()

  const [installed, installedActions] = createResource(
    () => refreshTick(),
    async () => {
      try {
        const result = await sdk().mcp.manage.list()
        setInstalledError(undefined)
        return ((result.data ?? []) as ManageItem[]).toSorted((a, b) => a.name.localeCompare(b.name))
      } catch (error) {
        setInstalledError(formatServerError(error, language.t, language.t("common.requestFailed")))
        return [] as ManageItem[]
      }
    },
  )

  const [catalog, catalogActions] = createResource(
    () => [refreshTick(), query(), mode()] as const,
    async () => {
      if (mode() !== "catalog") {
        setCatalogError(undefined)
        return [] as CatalogItem[]
      }
      try {
        const result = await sdk().mcp.catalog.list({
          q: query().trim() || undefined,
        })
        setCatalogError(undefined)
        return (result.data ?? []) as CatalogItem[]
      } catch (error) {
        setCatalogError(formatServerError(error, language.t, language.t("common.requestFailed")))
        return [] as CatalogItem[]
      }
    },
  )

  const installedItems = createMemo(() => installed.latest ?? [])
  const catalogItems = createMemo(() => catalog.latest ?? [])

  const refresh = async () => {
    if (busy()) return
    setRefreshTick((value) => value + 1)
    await installedActions.refetch()
    if (mode() === "catalog") await catalogActions.refetch()
  }

  const toggle = useMutation(() => ({
    mutationFn: async (item: ManageItem) => {
      if (item.status.status === "connected") {
        await sdk().mcp.disconnect({ name: item.name })
      } else {
        await sdk().mcp.connect({ name: item.name })
      }
      await refresh()
    },
  }))

  const install = useMutation(() => ({
    mutationFn: async (item: CatalogItem) => {
      await sdk().mcp.catalog.install({
        id: item.id,
        target: target(),
      })
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.mcp.toast.installed.title"),
        description: language.t("settings.mcp.toast.installed.description", { name: item.title }),
      })
    },
  }))

  const remove = useMutation(() => ({
    mutationFn: async (item: ManageItem) => {
      await sdk().mcp.manage.delete({ name: item.name })
      setConfirmDelete(undefined)
      await refresh()
    },
  }))

  const saveEdit = async () => {
    const item = editing()
    if (!item) return
    try {
      const config = JSON.parse(draftText()) as McpConfig
      await sdk().mcp.manage.update({
        name: item.name,
        config: config as any,
        target: target(),
      })
      setEditing(undefined)
      await refresh()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    }
  }

  const authenticate = async (item: ManageItem) => {
    try {
      await sdk().mcp.auth.start({ name: item.name })
      await refresh()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    }
  }

  const logout = async (item: ManageItem) => {
    try {
      await sdk().mcp.auth.remove({ name: item.name })
      await refresh()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    }
  }

  const filteredInstalled = createMemo(() => {
    const term = query().trim().toLowerCase()
    const items = installedItems()
    if (!term) return items
    return items.filter((item) => [item.name, originLabel(item)].some((value) => value.toLowerCase().includes(term)))
  })

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
        <div class="flex max-w-[980px] flex-col gap-4 pb-6 pt-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
              <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.mcp.description")}</p>
            </div>
            <div class="flex items-center gap-2">
              <Select
                options={[
                  { value: "project", label: language.t("settings.mcp.target.project") },
                  { value: "global", label: language.t("settings.mcp.target.global") },
                ]}
                current={{ value: target(), label: language.t(`settings.mcp.target.${target()}`) }}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setTarget(item.value as "project" | "global")}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
              <Button size="large" variant="secondary" onClick={() => void refresh()}>
                <Icon name="reset" />
                {language.t("settings.mcp.action.refresh")}
              </Button>
            </div>
          </div>
          <div class="flex h-9 items-center gap-2 rounded-lg bg-surface-base px-3">
            <Icon name="magnifying-glass" class="flex-shrink-0 text-icon-weak-base" />
            <TextField
              variant="ghost"
              type="text"
              value={query()}
              onChange={setQuery}
              placeholder={language.t("settings.mcp.search.placeholder")}
              class="min-w-0 flex-1"
            />
          </div>
          <Tabs value={mode()} onChange={(value) => setMode(value as Mode)}>
            <Tabs.List>
              <Tabs.Trigger value="installed">{language.t("settings.mcp.tab.installed")}</Tabs.Trigger>
              <Tabs.Trigger value="catalog">{language.t("settings.mcp.tab.catalog")}</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </div>
      </div>

      <div class="max-w-[980px]">
        <Show when={confirmDelete()}>
          {(item) => (
            <div class="mb-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-4">
              <div class="text-14-medium text-text-strong">{language.t("settings.mcp.delete.title")}</div>
              <p class="pt-1 text-14-regular text-text-base">{language.t("settings.mcp.delete.confirm", { name: item().name })}</p>
              <div class="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(undefined)}>
                  {language.t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={() => remove.mutate(item())}>
                  {language.t("settings.mcp.action.delete")}
                </Button>
              </div>
            </div>
          )}
        </Show>

        <Show when={editing()}>
          {(item) => (
            <div class="mb-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-4">
              <div class="text-14-medium text-text-strong">{language.t("settings.mcp.edit.title", { name: item().name })}</div>
              <div class="mt-3 rounded-lg bg-surface-raised p-3">
                <textarea
                  class="min-h-[220px] w-full bg-transparent text-12-regular text-text-strong outline-none"
                  value={draftText()}
                  onInput={(event) => setDraftText(event.currentTarget.value)}
                />
              </div>
              <div class="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(undefined)}>
                  {language.t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={() => void saveEdit()}>
                  {language.t("common.save")}
                </Button>
              </div>
            </div>
          )}
        </Show>

        <Show when={mode() === "installed"}>
          <SettingsList>
            <Show when={installedError()}>
              {(error) => (
                <div class="border-b border-border-weak-base px-4 py-4 text-12-regular text-status-warning">
                  {error()}
                </div>
              )}
            </Show>
            <Show
              when={filteredInstalled().length > 0}
              fallback={<div class="py-8 text-center text-14-regular text-text-weak">{language.t("settings.mcp.empty.installed")}</div>}
            >
              <For each={filteredInstalled()}>
                {(item) => (
                  <div class="flex flex-col gap-3 border-b border-border-weak-base px-4 py-4 last:border-b-0">
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="truncate text-14-medium text-text-strong">{item.name}</span>
                          <Tag>{language.t(statusKey(item.status))}</Tag>
                          <Show when={item.managed}>
                            <Tag>{language.t("settings.mcp.tag.managed")}</Tag>
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-weak">{originLabel(item)}</div>
                        <Show when={item.installAdapter === "minimax-token-plan"}>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {language.t("settings.mcp.minimax.tools")}
                          </div>
                        </Show>
                        <Show when={statusError(item.status)}>
                          {(error) => <div class="pt-1 text-12-regular text-status-warning">{error()}</div>}
                        </Show>
                      </div>
                      <Switch
                        checked={item.status.status === "connected"}
                        onChange={() => toggle.mutate(item)}
                        disabled={toggle.isPending}
                        hideLabel
                      >
                        {item.name}
                      </Switch>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => {
                          setEditing(item)
                          setDraftText(JSON.stringify(item.config, null, 2))
                        }}
                      >
                        {language.t("settings.mcp.action.edit")}
                      </Button>
                      <Show when={item.status.status === "needs_auth" || item.config.type === "remote"}>
                        <Button size="small" variant="secondary" onClick={() => void authenticate(item)}>
                          {language.t("settings.mcp.action.authenticate")}
                        </Button>
                        <Button size="small" variant="secondary" onClick={() => void logout(item)}>
                          {language.t("settings.mcp.action.logout")}
                        </Button>
                      </Show>
                      <Button size="small" variant="secondary" onClick={() => setConfirmDelete(item)}>
                        {language.t("settings.mcp.action.delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </Show>

        <Show when={mode() === "catalog"}>
          <SettingsList>
            <Show when={catalogError()}>
              {(error) => (
                <div class="border-b border-border-weak-base px-4 py-4 text-12-regular text-status-warning">
                  {error()}
                </div>
              )}
            </Show>
            <Show
              when={catalogItems().length > 0}
              fallback={<div class="py-8 text-center text-14-regular text-text-weak">{language.t("settings.mcp.empty.catalog")}</div>}
            >
              <For each={catalogItems()}>
                {(item) => (
                  <div class="flex flex-col gap-3 border-b border-border-weak-base px-4 py-4 last:border-b-0">
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="truncate text-14-medium text-text-strong">{item.title}</span>
                          <Tag>{item.packageType}</Tag>
                          <Tag>{item.transportType}</Tag>
                          <Show when={item.installed}>
                            <Tag>{language.t("settings.mcp.tag.installed")}</Tag>
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-weak">{item.serverName}</div>
                        <div class="pt-1 text-12-regular text-text-weak">{item.description}</div>
                        <Show when={item.installAdapter === "minimax-token-plan"}>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {language.t("settings.mcp.minimax.usage")}
                          </div>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {language.t("settings.mcp.minimax.requirements")}
                          </div>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {language.t("settings.mcp.minimax.tools")}
                          </div>
                        </Show>
                        <Show when={item.installReason}>
                          <div class="pt-1 text-12-regular text-status-warning">{item.installReason}</div>
                        </Show>
                      </div>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={!item.installable || install.isPending}
                        onClick={() => install.mutate(item)}
                      >
                        {language.t("settings.mcp.action.install")}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </Show>
      </div>
    </div>
  )
}
