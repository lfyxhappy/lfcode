import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tag } from "@lfcode-ai/ui/tag"
import { showToast } from "@lfcode-ai/ui/toast"
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
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

type RuntimeManageItemID = "voice-recorder" | "ffmpeg" | "python-base" | "python-managed" | "cpp-compiler" | "java-runtime" | "java-sdk" | "officecli"

type RuntimeManageItem = {
  id: RuntimeManageItemID
  group: "voice" | "code"
  title: string
  description: string
  installed: boolean
  version?: string
  source: "bundled" | "managed" | "system" | "missing"
  scope: "required" | "recommended" | "optional"
  usedBy: string[]
  path?: string
  detail?: string
  targets: { id: string; label: string; source: RuntimeManageItem["source"]; active: boolean }[]
  actions: { install: boolean; repair: boolean; update?: boolean; activate: boolean; openPath: boolean; viewLogs: boolean }
}

type RuntimeOperationLog = {
  timestamp: number
  id: RuntimeManageItemID
  action: "install" | "repair" | "update" | "activate"
  status: "success" | "failed"
  title: string
  message: string
}

type PluginInspect = {
  kind: "plugin" | "runtime"
  spec: string
  scope: "global" | "local"
  source: "file" | "npm" | "managed" | "runtime"
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
    skillRequirements?: { id: string; purpose?: string; required?: boolean }[]
    uiContributions?: {
      slot: "tui-slot" | "desktop-settings-panel" | "desktop-session-toolbar" | "desktop-session-composer"
      title?: string
      sessionComposer?: {
        type: string
        mode: "replace" | "append"
        renderer: "conversation"
        placeholder?: string
        submitLabel?: string
        description?: string
      }
      managedSession?: {
        type: string
        title?: string
        label?: string
      }
    }[]
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
  runtimeItem?: RuntimeManageItem
  runtimeDependencies: {
    id: string
    required: boolean
    installed: boolean
    source: "bundled" | "managed" | "system" | "missing"
    version?: string
    detail?: string
    install: boolean
  }[]
  skillRequirements: {
    id: string
    required: boolean
    available: boolean
    purpose?: string
  }[]
}

type PluginUIContribution = NonNullable<NonNullable<PluginInspect["manifest"]>["uiContributions"]>[number]

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
  const navigate = useNavigate()
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
  const [launching, setLaunching] = createSignal<string>()
  const [runtimeBusy, setRuntimeBusy] = createSignal<string>()
  const [selectedRuntimeLog, setSelectedRuntimeLog] = createSignal<RuntimeManageItemID>()
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
  const [runtimeLogs, { refetch: refetchRuntimeLogs }] = createResource(selectedRuntimeLog, async (id) => {
    const result = await globalSDK.client.global.runtime.logs({ id, limit: 20 })
    return (result.data?.entries ?? []) as RuntimeOperationLog[]
  })

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

  const launchManagedSession = async (plugin: PluginInspect, contribution: PluginUIContribution) => {
    const launcher = contribution.managedSession
    const pluginID = plugin.manifest?.id
    if (!launcher || !pluginID || launching()) return
    setLaunching(`${plugin.spec}:${launcher.type}`)
    try {
      const project = await sdk().project.getManaged({ pluginID, type: launcher.type })
      if (!project.data) throw new Error("受管项目尚未初始化，请先启用插件后重试")
      const extension = { pluginID, type: launcher.type }
      const sessions = await sdk().session.list({ directory: project.data.worktree, roots: true })
      const existing = sessions.data?.find(
        (session) => session.extension?.pluginID === extension.pluginID && session.extension.type === extension.type,
      )
      const result = existing
        ? existing
        : (
            await sdk().session.createManaged({
              projectID: project.data.id,
              extension,
              title: launcher.title ?? contribution.title ?? plugin.manifest?.name ?? pluginID,
            })
          ).data
      if (!result?.id) throw new Error("酒馆会话创建失败")
      navigate(`/${base64Encode(result.directory)}/session/${result.id}`)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setLaunching(undefined)
    }
  }

  const runRuntimeAction = async (id: RuntimeManageItemID, action: "install" | "repair" | "update") => {
    if (runtimeBusy()) return
    setRuntimeBusy(`${action}:${id}`)
    try {
      const result =
        action === "install"
          ? await globalSDK.client.global.runtime.install({ id })
          : action === "repair"
            ? await globalSDK.client.global.runtime.repair({ id })
            : await globalSDK.client.global.runtime.update({ id })
      await refresh()
      await refetchRuntimeLogs()
      showToast({
        variant: "success",
        title: language.t(
          action === "install"
            ? "settings.runtimes.toast.install.title"
            : action === "repair"
              ? "settings.runtimes.toast.repair.title"
              : "settings.runtimes.toast.update.title",
        ),
        description: result.data?.message ?? language.t("settings.runtimes.toast.success.description"),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t(
          action === "install"
            ? "settings.runtimes.toast.install.failed"
            : action === "repair"
              ? "settings.runtimes.toast.repair.failed"
              : "settings.runtimes.toast.update.failed",
        ),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setRuntimeBusy(undefined)
    }
  }

  const activateRuntimeTarget = async (id: RuntimeManageItemID, target: string) => {
    if (runtimeBusy()) return
    setRuntimeBusy(`activate:${id}:${target}`)
    try {
      const result = await globalSDK.client.global.runtime.activate({ id, target })
      await refresh()
      await refetchRuntimeLogs()
      showToast({
        variant: "success",
        title: language.t("settings.runtimes.toast.activate.title"),
        description: result.data?.message ?? language.t("settings.runtimes.toast.success.description"),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.runtimes.toast.activate.failed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setRuntimeBusy(undefined)
    }
  }

  const installRuntimeDependency = (id: RuntimeManageItemID) => runRuntimeAction(id, "install")

  return (
    <div
      class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10"
      data-automation-id="settings-plugins"
    >
      <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
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
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-base p-4">
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
          <div class="rounded-lg bg-surface-base px-4 py-4 text-13-regular text-text-weak">
            {language.t("settings.plugins.projectRequired")}
          </div>
        </Show>
        <Show when={plugins.error}>
          <div class="rounded-lg bg-surface-base px-4 py-4 text-13-regular text-status-warning">
            {formatServerError(plugins.error, language.t, language.t("common.requestFailed"))}
          </div>
        </Show>
        <Show when={library.error}>
          <div class="rounded-lg bg-surface-base px-4 py-4 text-13-regular text-status-warning">
            {formatServerError(library.error, language.t, language.t("common.requestFailed"))}
          </div>
        </Show>
        <Show when={directory() && !plugins.loading && !plugins.error}>
          <Show
            when={(plugins.latest ?? []).length > 0}
            fallback={
              <div class="rounded-lg bg-surface-base px-4 py-8 text-center text-13-regular text-text-weak">
                {language.t("settings.plugins.empty")}
              </div>
            }
          >
            <For each={plugins.latest ?? []}>
              {(plugin) =>
                plugin.kind === "runtime" && plugin.runtimeItem ? (
                  <RuntimePluginCard
                    item={plugin.runtimeItem}
                    busy={runtimeBusy()}
                    platform={platform}
                    language={language}
                    onAction={runRuntimeAction}
                    onActivate={activateRuntimeTarget}
                    onViewLogs={(id) => setSelectedRuntimeLog(id)}
                  />
                ) : (
                  <PluginCard
                    plugin={plugin}
                    toggling={toggling() === plugin.spec}
                    onToggle={toggle}
                    launching={launching()}
                    onLaunchManagedSession={launchManagedSession}
                    runtimeBusy={runtimeBusy()}
                    onInstallRuntime={installRuntimeDependency}
                  />
                )
              }
            </For>
          </Show>
        </Show>
        <Show when={selectedRuntimeLog()}>
          {(id) => (
            <RuntimePluginLogs
              id={id()}
              entries={runtimeLogs.latest ?? []}
              loading={runtimeLogs.loading}
              error={runtimeLogs.error}
              language={language}
              onClose={() => setSelectedRuntimeLog(undefined)}
              onRefresh={() => void refetchRuntimeLogs()}
            />
          )}
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
    <section class="rounded-lg border border-border-warning-base bg-surface-base p-4">
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
      <div class="mt-3 grid gap-1 rounded-md bg-surface-raised-base px-3 py-2 font-mono text-11-regular text-text-weak">
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
  <section class="rounded-lg bg-surface-base p-4">
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

const RuntimePluginCard: Component<{
  item: RuntimeManageItem
  busy?: string
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  onAction: (id: RuntimeManageItemID, action: "install" | "repair" | "update") => Promise<void>
  onActivate: (id: RuntimeManageItemID, target: string) => Promise<void>
  onViewLogs: (id: RuntimeManageItemID) => void
}> = (props) => {
  const installing = () => props.busy === `install:${props.item.id}`
  const repairing = () => props.busy === `repair:${props.item.id}`
  const updating = () => props.busy === `update:${props.item.id}`
  const activeTarget = () => props.item.targets.find((target) => target.active)
  const inactiveTargets = () => props.item.targets.filter((target) => !target.active)
  const status = () => {
    if (!props.item.installed) return props.language.t("settings.runtimes.status.missing")
    if (props.item.source === "managed") return props.language.t("settings.runtimes.status.installedManaged")
    if (props.item.source === "bundled") return props.language.t("settings.runtimes.status.installedBundled")
    return props.language.t("settings.runtimes.status.installedSystem")
  }
  const installLabel = () => {
    if (props.item.installed && props.item.source !== "managed") return props.language.t("settings.runtimes.action.installManaged")
    return props.language.t("settings.runtimes.action.install")
  }

  return (
    <section class="rounded-lg bg-surface-base p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <Icon name="status" size="small" class={props.item.installed ? "text-status-success" : "text-status-warning"} />
            <h3 class="truncate text-14-medium text-text-strong">{props.item.title}</h3>
          </div>
          <div class="mt-1 truncate font-mono text-11-regular text-text-weaker">runtime:{props.item.id}</div>
        </div>
        <div class="flex flex-wrap justify-end gap-1">
          <Tag>runtime</Tag>
          <Tag>global</Tag>
          <Tag>{props.item.source}</Tag>
          <Tag>{props.item.scope}</Tag>
          <Tag>{status()}</Tag>
        </div>
      </div>

      <div class="mt-3 text-12-regular text-text-weak">{props.item.description}</div>
      <Show when={props.item.usedBy.length}>
        <div class="mt-3 flex flex-wrap gap-1">
          <For each={props.item.usedBy}>{(capability) => <Tag>{capability}</Tag>}</For>
        </div>
      </Show>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <Show when={props.item.version}>
          {(version) => <RuntimePluginField title={props.language.t("settings.runtimes.version")} value={version()} />}
        </Show>
        <Show when={activeTarget()}>
          {(target) => <RuntimePluginField title={props.language.t("settings.runtimes.activeTarget")} value={target().label} />}
        </Show>
      </div>
      <Show when={props.item.path ?? props.item.detail}>
        <div class="mt-3 grid gap-1 rounded-md bg-surface-raised-base px-3 py-2 text-11-regular text-text-weak">
          <Show when={props.item.path}>{(value) => <div class="break-all font-mono">{value()}</div>}</Show>
          <Show when={props.item.detail}>{(value) => <div>{value()}</div>}</Show>
        </div>
      </Show>
      <div class="mt-4 flex flex-wrap gap-2">
        <Show when={props.item.actions.install}>
          <Button size="small" variant="secondary" disabled={Boolean(props.busy)} onClick={() => void props.onAction(props.item.id, "install")}>
            {installing() ? props.language.t("common.loading") : installLabel()}
          </Button>
        </Show>
        <Show when={props.item.actions.repair}>
          <Button size="small" variant="secondary" disabled={Boolean(props.busy)} onClick={() => void props.onAction(props.item.id, "repair")}>
            {repairing() ? props.language.t("common.loading") : props.language.t("settings.runtimes.action.repair")}
          </Button>
        </Show>
        <Show when={props.item.actions.update}>
          <Button size="small" variant="secondary" disabled={Boolean(props.busy)} onClick={() => void props.onAction(props.item.id, "update")}>
            {updating() ? props.language.t("common.loading") : props.language.t("settings.runtimes.action.update")}
          </Button>
        </Show>
        <Show when={props.item.actions.activate}>
          <For each={inactiveTargets()}>
            {(target) => (
              <Button
                size="small"
                variant="ghost"
                disabled={Boolean(props.busy)}
                onClick={() => void props.onActivate(props.item.id, target.id)}
              >
                {props.busy === `activate:${props.item.id}:${target.id}`
                  ? props.language.t("common.loading")
                  : props.language.t("settings.runtimes.action.useTarget", { target: target.label })}
              </Button>
            )}
          </For>
        </Show>
        <Show when={props.item.actions.openPath && props.item.path}>
          {(value) => (
            <Button size="small" variant="ghost" disabled={!props.platform.openPath} onClick={() => void props.platform.openPath?.(value())}>
              {props.language.t("settings.runtimes.action.openPath")}
            </Button>
          )}
        </Show>
        <Show when={props.item.actions.viewLogs}>
          <Button size="small" variant="ghost" onClick={() => props.onViewLogs(props.item.id)}>
            {props.language.t("settings.runtimes.action.viewLogs")}
          </Button>
        </Show>
      </div>
    </section>
  )
}

const RuntimePluginField: Component<{ title: string; value: string }> = (props) => (
  <div class="rounded-md bg-surface-raised-base px-3 py-2">
    <div class="text-11-medium text-text-weak">{props.title}</div>
    <div class="mt-1 line-clamp-2 break-all text-11-regular text-text-strong">{props.value}</div>
  </div>
)

const RuntimePluginLogs: Component<{
  id: RuntimeManageItemID
  entries: RuntimeOperationLog[]
  loading: boolean
  error: unknown
  language: ReturnType<typeof useLanguage>
  onClose: () => void
  onRefresh: () => void
}> = (props) => (
  <section class="rounded-lg bg-surface-base p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-14-medium text-text-strong">{props.language.t("settings.runtimes.logs.title")}</h3>
        <div class="mt-1 text-12-regular text-text-weak">runtime:{props.id}</div>
      </div>
      <div class="flex gap-2">
        <Button size="small" variant="secondary" disabled={props.loading} onClick={props.onRefresh}>
          {props.loading ? props.language.t("common.loading") : props.language.t("settings.runtimes.logs.refresh")}
        </Button>
        <Button size="small" variant="ghost" onClick={props.onClose}>
          {props.language.t("common.close")}
        </Button>
      </div>
    </div>
    <Show when={props.error}>
      <div class="mt-3 text-12-regular text-status-warning">
        {formatServerError(props.error, props.language.t, props.language.t("common.requestFailed"))}
      </div>
    </Show>
    <Show
      when={props.entries.length > 0}
      fallback={<div class="mt-3 text-12-regular text-text-weak">{props.language.t("settings.runtimes.logs.empty")}</div>}
    >
      <div class="mt-3 grid gap-2">
        <For each={props.entries}>
          {(entry) => (
            <div class="rounded-md bg-surface-raised-base px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <span class="text-12-medium text-text-strong">{entry.title}</span>
                <Tag>{entry.status}</Tag>
              </div>
              <div class="mt-1 text-11-regular text-text-weak">{entry.message}</div>
              <div class="mt-1 text-11-regular text-text-weaker">{formatRuntimeLogTime(entry.timestamp)}</div>
            </div>
          )}
        </For>
      </div>
    </Show>
  </section>
)

const PluginCard: Component<{
  plugin: PluginInspect
  toggling: boolean
  onToggle: (plugin: PluginInspect) => Promise<void>
  launching?: string
  onLaunchManagedSession: (
    plugin: PluginInspect,
    contribution: PluginUIContribution,
  ) => Promise<void>
  runtimeBusy?: string
  onInstallRuntime: (id: RuntimeManageItemID) => Promise<void>
}> = (props) => {
  const language = useLanguage()
  const plugin = () => props.plugin
  return (
    <section class="rounded-lg bg-surface-base p-4">
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
      <Show when={plugin().runtimeDependencies.length}>
        <div class="mt-3 flex flex-wrap gap-1">
          <For each={plugin().runtimeDependencies}>
            {(dependency) => (
              <div class="flex items-center gap-1">
                <Tag>{`runtime:${dependency.id} ${dependency.installed ? dependency.source : dependency.required ? "missing" : "optional"}`}</Tag>
                <Show when={!dependency.installed && dependency.install}>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={Boolean(props.runtimeBusy)}
                    onClick={() => void props.onInstallRuntime(dependency.id as RuntimeManageItemID)}
                  >
                    {language.t("settings.runtimes.action.install")}
                  </Button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={plugin().skillRequirements.length}>
        <div class="mt-3 flex flex-wrap gap-1">
          <For each={plugin().skillRequirements}>
            {(requirement) => (
              <Tag>{`skill:${requirement.id} ${requirement.available ? "available" : requirement.required ? "missing" : "optional"}`}</Tag>
            )}
          </For>
        </div>
      </Show>
      <Show when={plugin().manifest?.uiContributions?.length}>
        <div class="mt-3 flex flex-wrap items-center gap-1">
          <For each={plugin().manifest?.uiContributions ?? []}>
            {(contribution) => (
              <>
                <Tag>{`ui:${contribution.slot} ${contribution.slot === "tui-slot" ? "guarded" : "declared"}${contribution.title ? ` ${contribution.title}` : ""}`}</Tag>
                <Show when={contribution.managedSession && plugin().enabled && plugin().compatible}>
                  <Button
                    size="small"
                    variant="secondary"
                    data-automation-id={`plugin-managed-session:${plugin().manifest?.id ?? plugin().spec}:${contribution.managedSession?.type ?? "session"}`}
                    disabled={Boolean(props.launching)}
                    onClick={() => void props.onLaunchManagedSession(plugin(), contribution)}
                  >
                    {contribution.managedSession?.label ?? contribution.title ?? "打开会话"}
                  </Button>
                </Show>
              </>
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
        <div class="mt-4 flex items-center justify-between gap-3 rounded-md bg-surface-raised-base px-3 py-2">
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
        <div class="mt-2 grid gap-1 rounded-md bg-surface-raised-base px-3 py-2">
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
    <div class="rounded-md bg-surface-raised-base px-3 py-2">
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

function formatRuntimeLogTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" }).format(timestamp)
}

function showPluginError(error: unknown, language: ReturnType<typeof useLanguage>) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: formatServerError(error, language.t, language.t("common.requestFailed")),
  })
}
