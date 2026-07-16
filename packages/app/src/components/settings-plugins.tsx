import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tag } from "@lfcode-ai/ui/tag"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"

type TargetStatus = {
  status: "ready" | "missing" | "unresolved" | "error"
  target?: string
  entry?: string
  message?: string
}

type PluginInspect = {
  spec: string
  scope: "global" | "local"
  source: "file" | "npm" | "managed"
  declaredIn: string
  packageName?: string
  enabled: boolean
  manifest?: {
    id?: string
    name?: string
    version?: string
    description?: string
    category?: "tool" | "provider" | "integration" | "ui" | "theme" | "runtime" | "mixed"
    trust?: string
    apiVersion?: string
    capabilities?: string[]
    lfcodeRange?: string
    runtimeDependencies?: { id: string; version?: string; required?: boolean }[]
  }
  compatible: boolean
  compatibilityMessage?: string
  server: TargetStatus
  tui: TargetStatus
  runtime?: {
    id: string
    lifecycle: "active" | "disabled" | "degraded"
    error?: string
  }
}

type ManagedPlugin = {
  id: string
  name: string
  version: string
  description?: string
  category: "tool" | "provider" | "integration" | "ui" | "theme" | "runtime" | "mixed"
  capabilities: string[]
  trust: string
  spec: string
  enabled: boolean
  source: { type: string; label: string; digest: string }
  files: { count: number; bytes: number }
  installedAt: number
}

type ImportPreview = {
  token: string
  expiresAt: number
  report: Omit<ManagedPlugin, "spec" | "enabled" | "installedAt"> & {
    operation: "install" | "replace" | "unchanged"
    entrypoints: string[]
    runtimeDependencies: { id: string; version?: string; required?: boolean }[]
    dependencies: { name: string; requested: string; version?: string; integrity?: string; optional: boolean }[]
    warnings: string[]
  }
}

export const SettingsPlugins: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const sdk = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const [revision, setRevision] = createSignal(0)
  const [plugins, pluginsActions] = createResource(
    () => [directory(), revision()] as const,
    async ([currentDirectory]) => {
      if (!currentDirectory) return [] as PluginInspect[]
      const result = await sdk().plugin.list()
      return ((result.data ?? []) as PluginInspect[])
        .filter((plugin) => plugin.source !== "managed")
        .toSorted((a, b) => pluginLabel(a).localeCompare(pluginLabel(b)))
    },
  )

  const [toggling, setToggling] = createSignal<string>()
  const [libraryRevision, setLibraryRevision] = createSignal(0)
  const [libraryBusy, setLibraryBusy] = createSignal<string>()
  const [preview, setPreview] = createSignal<ImportPreview>()
  const [npmSpec, setNpmSpec] = createSignal("")
  const [library, libraryActions] = createResource(
    () => [directory(), libraryRevision()] as const,
    async ([currentDirectory]) => {
      if (!currentDirectory) return [] as ManagedPlugin[]
      const result = await sdk().plugin.libraryList()
      return ((result.data ?? []) as ManagedPlugin[]).toSorted((a, b) => a.name.localeCompare(b.name))
    },
  )

  const refresh = async () => {
    setRevision((value) => value + 1)
    setLibraryRevision((value) => value + 1)
    await pluginsActions.refetch()
    await libraryActions.refetch()
  }

  const importPlugin = async (source: "directory" | "zip") => {
    if (libraryBusy() || server.isLocal() !== true) return
    const selected =
      source === "directory"
        ? await platform.openDirectoryPickerDialog?.({ title: language.t("settings.plugins.import.directory") })
        : await platform.openFilePickerDialog?.({
            title: language.t("settings.plugins.import.zip"),
            extensions: ["zip"],
          })
    const selectedPath = Array.isArray(selected) ? selected[0] : selected
    if (!selectedPath) return
    setLibraryBusy("preview")
    try {
      const result = await sdk().plugin.libraryPreview({ pluginLibraryPreviewInput: { source, path: selectedPath } })
      setPreview(result.data)
    } catch (error) {
      showPluginError(error, language)
    } finally {
      setLibraryBusy(undefined)
    }
  }

  const importNpmPlugin = async () => {
    const source = npmSpec().trim()
    if (!source || libraryBusy()) return
    setLibraryBusy("preview")
    try {
      const result = await sdk().plugin.libraryPreview({ pluginLibraryPreviewInput: { source: "npm", path: source } })
      setPreview(result.data)
    } catch (error) {
      showPluginError(error, language)
    } finally {
      setLibraryBusy(undefined)
    }
  }

  const commitPreview = async () => {
    const current = preview()
    if (!current || libraryBusy()) return
    setLibraryBusy("commit")
    try {
      await sdk().plugin.libraryCommit({ pluginLibraryCommitInput: { token: current.token } })
      setPreview(undefined)
      await refresh()
      showToast({ title: language.t("settings.plugins.import.completed") })
    } catch (error) {
      showPluginError(error, language)
    } finally {
      setLibraryBusy(undefined)
    }
  }

  const toggleManaged = async (plugin: ManagedPlugin) => {
    if (libraryBusy()) return
    setLibraryBusy(plugin.spec)
    try {
      await sdk().plugin.libraryToggle({ pluginLibraryToggleInput: { spec: plugin.spec, enabled: !plugin.enabled } })
      await refresh()
    } catch (error) {
      showPluginError(error, language)
    } finally {
      setLibraryBusy(undefined)
    }
  }

  const uninstallManaged = async (plugin: ManagedPlugin) => {
    if (libraryBusy() || !window.confirm(language.t("settings.plugins.uninstall.confirm", { name: plugin.name })))
      return
    setLibraryBusy(plugin.spec)
    try {
      await sdk().plugin.libraryUninstall({ pluginLibrarySpecInput: { spec: plugin.spec } })
      await refresh()
    } catch (error) {
      showPluginError(error, language)
    } finally {
      setLibraryBusy(undefined)
    }
  }

  const exportManaged = async (plugin: ManagedPlugin) => {
    if (libraryBusy() || server.isLocal() !== true) return
    const output = await platform.saveFilePickerDialog?.({
      title: language.t("settings.plugins.export"),
      defaultPath: `${plugin.id}-${plugin.version}.lfplugin.zip`,
    })
    if (!output) return
    setLibraryBusy(plugin.spec)
    try {
      await sdk().plugin.libraryExport({ pluginLibraryExportInput: { spec: plugin.spec, output } })
      showToast({ title: language.t("settings.plugins.export.completed") })
    } catch (error) {
      showPluginError(error, language)
    } finally {
      setLibraryBusy(undefined)
    }
  }

  const toggle = async (plugin: PluginInspect) => {
    if (toggling()) return
    setToggling(plugin.spec)
    try {
      await sdk().plugin.toggle({ pluginToggle: { spec: plugin.spec, enabled: !plugin.enabled } })
      await refresh()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setToggling(undefined)
    }
  }

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[980px] items-start justify-between gap-4 pb-6 pt-6">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.plugins.title")}</h2>
            <p class="text-14-regular text-text-weak">{language.t("settings.plugins.description")}</p>
          </div>
          <Button
            size="large"
            variant="secondary"
            disabled={plugins.loading || !directory()}
            onClick={() => void refresh()}
          >
            {plugins.loading ? language.t("common.loading") : language.t("settings.plugins.refresh")}
          </Button>
        </div>
      </div>

      <div class="mx-auto flex w-full max-w-[980px] flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-surface-base p-4">
          <div>
            <div class="text-14-medium text-text-strong">{language.t("settings.plugins.library.title")}</div>
            <div class="mt-1 text-12-regular text-text-weak">{language.t("settings.plugins.library.description")}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <input
              class="h-8 min-w-[220px] rounded-lg border border-border-weak-base bg-surface-raised-base px-3 text-12-regular text-text-strong outline-none"
              value={npmSpec()}
              placeholder={language.t("settings.plugins.import.npm.placeholder")}
              onInput={(event) => setNpmSpec(event.currentTarget.value)}
            />
            <Button
              variant="secondary"
              disabled={!directory() || !npmSpec().trim() || Boolean(libraryBusy())}
              onClick={() => void importNpmPlugin()}
            >
              {language.t("settings.plugins.import.npm")}
            </Button>
            <Button
              variant="secondary"
              disabled={
                !directory() ||
                server.isLocal() !== true ||
                !platform.openDirectoryPickerDialog ||
                Boolean(libraryBusy())
              }
              onClick={() => void importPlugin("directory")}
            >
              {language.t("settings.plugins.import.directory")}
            </Button>
            <Button
              variant="secondary"
              disabled={
                !directory() || server.isLocal() !== true || !platform.openFilePickerDialog || Boolean(libraryBusy())
              }
              onClick={() => void importPlugin("zip")}
            >
              {language.t("settings.plugins.import.zip")}
            </Button>
          </div>
        </div>
        <Show when={preview()}>
          {(value) => (
            <ImportReview
              preview={value()}
              busy={Boolean(libraryBusy())}
              onCancel={() => setPreview(undefined)}
              onCommit={commitPreview}
            />
          )}
        </Show>
        <Show when={!library.loading && (library.latest ?? []).length > 0}>
          <div class="grid gap-3">
            <For each={library.latest ?? []}>
              {(plugin) => (
                <ManagedPluginCard
                  plugin={plugin}
                  busy={Boolean(libraryBusy())}
                  canExport={server.isLocal() === true && platform.saveFilePickerDialog !== undefined}
                  onToggle={toggleManaged}
                  onUninstall={uninstallManaged}
                  onExport={exportManaged}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={!directory()}>
          <div class="rounded-[20px] bg-surface-base px-4 py-4 text-13-regular text-text-weak">
            {language.t("settings.plugins.projectRequired")}
          </div>
        </Show>
        <Show when={plugins.error}>
          <div class="rounded-[20px] bg-surface-base px-4 py-4 text-13-regular text-status-warning">
            {formatServerError(plugins.error, language.t, language.t("common.requestFailed"))}
          </div>
        </Show>
        <Show when={library.error}>
          <div class="rounded-[20px] bg-surface-base px-4 py-4 text-13-regular text-status-warning">
            {formatServerError(library.error, language.t, language.t("common.requestFailed"))}
          </div>
        </Show>
        <Show when={directory() && !plugins.loading && !plugins.error}>
          <Show
            when={(plugins.latest ?? []).length > 0}
            fallback={
              <div class="rounded-[20px] bg-surface-base px-4 py-8 text-center text-13-regular text-text-weak">
                {language.t("settings.plugins.empty")}
              </div>
            }
          >
            <For each={plugins.latest ?? []}>
              {(plugin) => <PluginCard plugin={plugin} toggling={toggling() === plugin.spec} onToggle={toggle} />}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}

const ImportReview: Component<{
  preview: ImportPreview
  busy: boolean
  onCancel: () => void
  onCommit: () => Promise<void>
}> = (props) => {
  const language = useLanguage()
  const report = () => props.preview.report
  return (
    <section class="rounded-[20px] border border-border-warning-base bg-surface-base p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="text-14-medium text-text-strong">{language.t("settings.plugins.review.title")}</div>
          <div class="mt-1 text-13-regular text-text-weak">
            {report().name} · {report().version}
          </div>
        </div>
        <div class="flex gap-1">
          <Tag>{report().operation}</Tag>
          <Tag>{report().category}</Tag>
          <Tag>{report().trust}</Tag>
        </div>
      </div>
      <div class="mt-3 grid gap-1 rounded-xl bg-surface-raised-base px-3 py-2 font-mono text-11-regular text-text-weak">
        <div>id: {report().id}</div>
        <div>
          source: {report().source.type} · {report().source.label}
        </div>
        <div>sha256: {report().source.digest}</div>
        <div>
          files: {report().files.count} · {formatBytes(report().files.bytes)}
        </div>
        <div>entrypoints: {report().entrypoints.join(", ")}</div>
        <Show when={report().dependencies.length > 0}>
          <div>
            dependencies:{" "}
            {report()
              .dependencies.map((item) => `${item.name}@${item.version ?? item.requested}`)
              .join(", ")}
          </div>
        </Show>
      </div>
      <Show when={report().warnings.length}>
        <div class="mt-3 text-12-regular text-status-warning">{report().warnings.join(" · ")}</div>
      </Show>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="secondary" disabled={props.busy} onClick={props.onCancel}>
          {language.t("common.cancel")}
        </Button>
        <Button disabled={props.busy} onClick={() => void props.onCommit()}>
          {language.t("settings.plugins.review.confirm")}
        </Button>
      </div>
    </section>
  )
}

const ManagedPluginCard: Component<{
  plugin: ManagedPlugin
  busy: boolean
  canExport: boolean
  onToggle: (plugin: ManagedPlugin) => Promise<void>
  onUninstall: (plugin: ManagedPlugin) => Promise<void>
  onExport: (plugin: ManagedPlugin) => Promise<void>
}> = (props) => (
  <section class="rounded-[20px] bg-surface-base p-4 shadow-sm">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="text-14-medium text-text-strong">{props.plugin.name}</div>
        <div class="mt-1 font-mono text-11-regular text-text-weaker">
          {props.plugin.spec} · {props.plugin.version}
        </div>
      </div>
      <div class="flex gap-1">
        <Tag>{props.plugin.category}</Tag>
        <Tag>{props.plugin.source.type}</Tag>
        <Tag>{props.plugin.trust}</Tag>
      </div>
    </div>
    <Show when={props.plugin.description}>
      <div class="mt-3 text-12-regular text-text-weak">{props.plugin.description}</div>
    </Show>
    <div class="mt-3 font-mono text-11-regular text-text-weaker">sha256: {props.plugin.source.digest}</div>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-2">
        <ManagedActions
          plugin={props.plugin}
          busy={props.busy}
          canExport={props.canExport}
          onExport={props.onExport}
          onUninstall={props.onUninstall}
        />
      </div>
      <Switch
        checked={props.plugin.enabled}
        disabled={props.busy}
        onChange={() => void props.onToggle(props.plugin)}
        hideLabel
      >
        {props.plugin.name}
      </Switch>
    </div>
  </section>
)

const ManagedActions: Component<{
  plugin: ManagedPlugin
  busy: boolean
  canExport: boolean
  onUninstall: (plugin: ManagedPlugin) => Promise<void>
  onExport: (plugin: ManagedPlugin) => Promise<void>
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="flex gap-2">
      <Button
        variant="secondary"
        disabled={props.busy || !props.canExport}
        onClick={() => void props.onExport(props.plugin)}
      >
        {language.t("settings.plugins.export")}
      </Button>
      <Button variant="secondary" disabled={props.busy} onClick={() => void props.onUninstall(props.plugin)}>
        {language.t("settings.plugins.uninstall")}
      </Button>
    </div>
  )
}

const PluginCard: Component<{
  plugin: PluginInspect
  toggling: boolean
  onToggle: (plugin: PluginInspect) => Promise<void>
}> = (props) => {
  const language = useLanguage()
  const plugin = () => props.plugin
  return (
    <section class="rounded-[20px] bg-surface-base p-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <Icon
              name="status"
              size="small"
              class={plugin().compatible ? "text-status-success" : "text-status-warning"}
            />
            <h3 class="truncate text-14-medium text-text-strong">{pluginLabel(plugin())}</h3>
          </div>
          <div class="mt-1 truncate font-mono text-11-regular text-text-weaker">{plugin().spec}</div>
        </div>
        <div class="flex flex-wrap justify-end gap-1">
          <Tag>{plugin().scope}</Tag>
          <Tag>{plugin().source}</Tag>
          <Show when={plugin().manifest?.trust}>{(trust) => <Tag>{trust()}</Tag>}</Show>
          <Show when={plugin().manifest?.category}>{(category) => <Tag>{category()}</Tag>}</Show>
          <Tag>{plugin().compatible ? "compatible" : "incompatible"}</Tag>
          <Tag>{plugin().runtime?.lifecycle ?? (plugin().enabled ? "ready" : "disabled")}</Tag>
        </div>
      </div>

      <Show when={plugin().manifest?.capabilities?.length}>
        <div class="mt-3 flex flex-wrap gap-1">
          <For each={plugin().manifest?.capabilities ?? []}>{(capability) => <Tag>{capability}</Tag>}</For>
        </div>
      </Show>
      <Show when={plugin().manifest?.runtimeDependencies?.length}>
        <div class="mt-3 flex flex-wrap gap-1">
          <For each={plugin().manifest?.runtimeDependencies ?? []}>
            {(dependency) => (
              <Tag>{`runtime:${dependency.id}${dependency.version ? `@${dependency.version}` : ""}`}</Tag>
            )}
          </For>
        </div>
      </Show>
      <Show when={plugin().compatibilityMessage}>
        {(message) => <div class="mt-3 text-12-regular text-status-warning">{message()}</div>}
      </Show>

      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <PluginTarget title="Server" status={plugin().server} />
        <PluginTarget title="TUI" status={plugin().tui} />
      </div>

      <Show when={canTogglePlugin(plugin())}>
        <div class="mt-4 flex items-center justify-between gap-3 rounded-xl bg-surface-raised-base px-3 py-2">
          <div>
            <div class="text-12-medium text-text-strong">
              {plugin().enabled
                ? language.t("settings.plugins.runtime.active")
                : language.t("settings.plugins.runtime.disabled")}
            </div>
            <Show when={plugin().runtime?.error}>
              {(error) => <div class="mt-1 text-11-regular text-status-warning">{error()}</div>}
            </Show>
          </div>
          <Switch
            checked={plugin().enabled}
            disabled={props.toggling}
            onChange={() => void props.onToggle(plugin())}
            hideLabel
          >
            {plugin().manifest?.name ?? plugin().spec}
          </Switch>
        </div>
      </Show>

      <details class="mt-3 text-11-regular text-text-weak">
        <summary class="cursor-pointer select-none hover:text-text-strong">
          {plugin().manifest?.id ?? "Plugin diagnostics"}
        </summary>
        <div class="mt-2 grid gap-1 rounded-xl bg-surface-raised-base px-3 py-2">
          <div>declared in: {plugin().declaredIn}</div>
          <Show when={plugin().packageName}>
            <div>package: {plugin().packageName}</div>
          </Show>
          <Show when={plugin().manifest?.apiVersion}>
            <div>api: {plugin().manifest?.apiVersion}</div>
          </Show>
          <Show when={plugin().manifest?.lfcodeRange}>
            <div>lfcode: {plugin().manifest?.lfcodeRange}</div>
          </Show>
        </div>
      </details>
    </section>
  )
}

const PluginTarget: Component<{ title: string; status: TargetStatus }> = (props) => {
  return (
    <div class="rounded-xl bg-surface-raised-base px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-12-medium text-text-strong">{props.title}</span>
        <span class={`text-11-medium ${targetTone(props.status.status)}`}>{props.status.status}</span>
      </div>
      <Show when={props.status.entry ?? props.status.message}>
        {(value) => <div class="mt-1 line-clamp-2 break-all text-11-regular text-text-weak">{value()}</div>}
      </Show>
    </div>
  )
}

function pluginLabel(plugin: PluginInspect) {
  return plugin.manifest?.name ?? plugin.manifest?.id ?? plugin.packageName ?? plugin.spec
}

function canTogglePlugin(plugin: PluginInspect) {
  if (plugin.source === "file") return false
  if (plugin.declaredIn.startsWith("http://") || plugin.declaredIn.startsWith("https://")) return false
  return plugin.server.status === "ready" || plugin.tui.status === "ready"
}

function targetTone(status: TargetStatus["status"]) {
  if (status === "ready") return "text-status-success"
  if (status === "error") return "text-status-error"
  return "text-text-weak"
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function showPluginError(error: unknown, language: ReturnType<typeof useLanguage>) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: formatServerError(error, language.t, language.t("common.requestFailed")),
  })
}
