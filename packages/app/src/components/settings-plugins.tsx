import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tag } from "@lfcode-ai/ui/tag"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
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
  source: "file" | "npm"
  declaredIn: string
  packageName?: string
  enabled: boolean
  manifest?: {
    id?: string
    name?: string
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

export const SettingsPlugins: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const sdk = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const [revision, setRevision] = createSignal(0)
  const [plugins, pluginsActions] = createResource(
    () => [directory(), revision()] as const,
    async ([currentDirectory]) => {
      if (!currentDirectory) return [] as PluginInspect[]
      const result = await sdk().plugin.list()
      return ((result.data ?? []) as PluginInspect[]).toSorted((a, b) => pluginLabel(a).localeCompare(pluginLabel(b)))
    },
  )

  const [toggling, setToggling] = createSignal<string>()

  const refresh = async () => {
    setRevision((value) => value + 1)
    await pluginsActions.refetch()
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
          <Button size="large" variant="secondary" disabled={plugins.loading || !directory()} onClick={() => void refresh()}>
            {plugins.loading ? language.t("common.loading") : language.t("settings.plugins.refresh")}
          </Button>
        </div>
      </div>

      <div class="mx-auto flex w-full max-w-[980px] flex-col gap-4">
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
        <Show when={directory() && !plugins.loading && !plugins.error}>
          <Show
            when={(plugins.latest ?? []).length > 0}
            fallback={<div class="rounded-[20px] bg-surface-base px-4 py-8 text-center text-13-regular text-text-weak">{language.t("settings.plugins.empty")}</div>}
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
            <Icon name="status" size="small" class={plugin().compatible ? "text-status-success" : "text-status-warning"} />
            <h3 class="truncate text-14-medium text-text-strong">{pluginLabel(plugin())}</h3>
          </div>
          <div class="mt-1 truncate font-mono text-11-regular text-text-weaker">{plugin().spec}</div>
        </div>
        <div class="flex flex-wrap justify-end gap-1">
          <Tag>{plugin().scope}</Tag>
          <Tag>{plugin().source}</Tag>
          <Show when={plugin().manifest?.trust}>{(trust) => <Tag>{trust()}</Tag>}</Show>
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
            {(dependency) => <Tag>{`runtime:${dependency.id}${dependency.version ? `@${dependency.version}` : ""}`}</Tag>}
          </For>
        </div>
      </Show>
      <Show when={plugin().compatibilityMessage}>{(message) => <div class="mt-3 text-12-regular text-status-warning">{message()}</div>}</Show>

      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <PluginTarget title="Server" status={plugin().server} />
        <PluginTarget title="TUI" status={plugin().tui} />
      </div>

      <Show when={plugin().server.status === "ready"}>
        <div class="mt-4 flex items-center justify-between gap-3 rounded-xl bg-surface-raised-base px-3 py-2">
          <div>
            <div class="text-12-medium text-text-strong">
              {plugin().enabled ? language.t("settings.plugins.runtime.active") : language.t("settings.plugins.runtime.disabled")}
            </div>
            <Show when={plugin().runtime?.error}>{(error) => <div class="mt-1 text-11-regular text-status-warning">{error()}</div>}</Show>
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
        <summary class="cursor-pointer select-none hover:text-text-strong">{plugin().manifest?.id ?? "Plugin diagnostics"}</summary>
        <div class="mt-2 grid gap-1 rounded-xl bg-surface-raised-base px-3 py-2">
          <div>declared in: {plugin().declaredIn}</div>
          <Show when={plugin().packageName}><div>package: {plugin().packageName}</div></Show>
          <Show when={plugin().manifest?.apiVersion}><div>api: {plugin().manifest?.apiVersion}</div></Show>
          <Show when={plugin().manifest?.lfcodeRange}><div>lfcode: {plugin().manifest?.lfcodeRange}</div></Show>
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

function targetTone(status: TargetStatus["status"]) {
  if (status === "ready") return "text-status-success"
  if (status === "error") return "text-status-error"
  return "text-text-weak"
}
