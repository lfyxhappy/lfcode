import { type Component, type JSX, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { Button } from "@lfcode-ai/ui/button"
import { showToast } from "@lfcode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { formatServerError } from "@/utils/server-errors"

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
  targets: {
    id: string
    label: string
    source: "bundled" | "managed" | "system" | "missing"
    active: boolean
  }[]
  actions: {
    install: boolean
    repair: boolean
    update?: boolean
    activate: boolean
    openPath: boolean
    viewLogs: boolean
  }
}

type RuntimeManageState = {
  refreshedAt: number
  items: RuntimeManageItem[]
}

type RuntimeOperationLog = {
  timestamp: number
  id: RuntimeManageItemID
  action: "install" | "repair" | "update" | "activate"
  status: "success" | "failed"
  title: string
  message: string
  sourceLabel?: string
}

type RuntimeOperationLogState = {
  refreshedAt: number
  entries: RuntimeOperationLog[]
}

const PYTHON_BASE_ID = "python-base"
const PYTHON_MANAGED_ID = "python-managed"

export const SettingsRuntimes: Component<{ embedded?: boolean }> = (props) => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const platform = usePlatform()
  const [runningID, setRunningID] = createSignal<string>()
  const [selectedLogID, setSelectedLogID] = createSignal<RuntimeManageItemID>()

  const [state, { mutate, refetch }] = createResource(async () => {
    const result = await globalSDK.client.global.runtime.manage()
    return result.data as RuntimeManageState
  })

  const [logs, { refetch: refetchLogs }] = createResource(async () => {
    const id = selectedLogID()
    const result = await globalSDK.client.global.runtime.logs(id ? { limit: 20, id } : { limit: 20 })
    return result.data as RuntimeOperationLogState
  })

  const loadError = createMemo(() => {
    if (!state.error) return
    return formatServerError(state.error, language.t, language.t("common.requestFailed"))
  })

  const logError = createMemo(() => {
    if (!logs.error) return
    return formatServerError(logs.error, language.t, language.t("common.requestFailed"))
  })

  const voiceItems = createMemo(() => state.latest?.items.filter((item) => item.group === "voice") ?? [])
  const codeItems = createMemo(() => mergeRuntimeDisplayItems(state.latest?.items ?? [], language))
  const itemMap = createMemo(() => new Map((state.latest?.items ?? []).map((item) => [item.id, item])))

  const runAction = async (item: RuntimeManageItem, action: "install" | "repair" | "update") => {
    if (runningID()) return
    setRunningID(`${action}:${item.id}`)
    try {
      const result =
        action === "install"
          ? await globalSDK.client.global.runtime.install({ id: item.id })
          : action === "repair"
            ? await globalSDK.client.global.runtime.repair({ id: item.id })
            : await globalSDK.client.global.runtime.update({ id: item.id })
      const next = result.data as { message?: string; state?: RuntimeManageState }
      showToast({
        variant: "success",
        title: language.t(
          action === "install"
            ? "settings.runtimes.toast.install.title"
            : action === "repair"
              ? "settings.runtimes.toast.repair.title"
              : "settings.runtimes.toast.update.title",
        ),
        description: next.message ?? language.t("settings.runtimes.toast.success.description"),
      })
      if (next.state) {
        mutate(next.state)
        await refetchLogs()
        return
      }
      await refetch()
      await refetchLogs()
    } catch (error) {
      await refetchLogs()
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
      setRunningID(undefined)
    }
  }

  const runActivate = async (item: RuntimeManageItem, target: string) => {
    if (runningID()) return
    setRunningID(`activate:${item.id}:${target}`)
    try {
      const result = await globalSDK.client.global.runtime.activate({ id: item.id, target })
      const next = result.data as { message?: string; state?: RuntimeManageState }
      showToast({
        variant: "success",
        title: language.t("settings.runtimes.toast.activate.title"),
        description: next.message ?? language.t("settings.runtimes.toast.success.description"),
      })
      if (next.state) {
        mutate(next.state)
        await refetchLogs()
        return
      }
      await refetch()
      await refetchLogs()
    } catch (error) {
      await refetchLogs()
      showToast({
        variant: "error",
        title: language.t("settings.runtimes.toast.activate.failed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setRunningID(undefined)
    }
  }

  const refresh = async () => {
    try {
      await refetch()
      await refetchLogs()
    } catch {}
  }

  const focusLogs = async (id?: RuntimeManageItemID) => {
    setSelectedLogID(id)
    await refetchLogs()
  }

  return (
    <div class={props.embedded ? "flex flex-col gap-4" : "no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10"}>
      <Show when={!props.embedded}>
        <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
        <div class="flex max-w-[980px] items-start justify-between gap-4 pb-6 pt-6">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.runtimes")}</h2>
            <p class="text-14-regular text-text-weak">{language.t("settings.runtimes.description")}</p>
          </div>
          <Button size="large" variant="secondary" disabled={state.loading} onClick={() => void refresh()}>
            {state.loading ? language.t("common.loading") : language.t("settings.runtimes.action.refresh")}
          </Button>
        </div>
        </div>
      </Show>

      <div class={props.embedded ? "flex flex-col gap-8" : "max-w-[980px]"}>
        <Show when={loadError()}>
          {(message) => <SettingsMessage>{message()}</SettingsMessage>}
        </Show>

        <div class="flex flex-col gap-8">
          <SettingsSection
            title={language.t("settings.runtimes.logs.title")}
            description={language.t("settings.runtimes.logs.description")}
            action={
              <div class="flex items-center gap-2">
                <Show when={selectedLogID()}>
                  {(value) => (
                    <Button size="small" variant="ghost" onClick={() => void focusLogs(undefined)}>
                      {language.t("settings.runtimes.logs.filter.clear", { title: itemMap().get(value())?.title ?? value() })}
                    </Button>
                  )}
                </Show>
                <Button size="small" variant="secondary" disabled={logs.loading} onClick={() => void refetchLogs()}>
                  {logs.loading ? language.t("common.loading") : language.t("settings.runtimes.logs.refresh")}
                </Button>
              </div>
            }
          >
            <Show when={logError()}>
              {(message) => <SettingsMessage>{message()}</SettingsMessage>}
            </Show>
            <Show when={logs.latest?.entries.length}>
              <div class="flex flex-col gap-3 rounded-lg border border-border-weak-base bg-surface-elevated p-4">
                <For each={logs.latest?.entries ?? []}>
                  {(entry) => (
                    <div class="rounded-lg border border-border-weak-base bg-surface-base p-3">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-13-medium text-text-strong">{entry.title}</div>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {itemMap().get(entry.id)?.title ?? entry.id} · {language.t(`settings.runtimes.logs.action.${entry.action}`)} ·{" "}
                            {formatLogTime(entry.timestamp)}
                          </div>
                        </div>
                        <Badge tone={entry.status === "success" ? "success" : "warning"}>
                          {language.t(`settings.runtimes.logs.status.${entry.status}`)}
                        </Badge>
                      </div>
                      <div class="pt-2 text-12-regular text-text-weak">{entry.message}</div>
                      <Show when={entry.sourceLabel}>
                        {(value) => (
                          <div class="pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-subtle">
                            {language.t("settings.runtimes.logs.source", { source: value() })}
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={!logs.loading && !logs.latest?.entries.length}>
              <SettingsMessage>{language.t("settings.runtimes.logs.empty")}</SettingsMessage>
            </Show>
          </SettingsSection>

          <SettingsSection
            title={language.t("settings.runtimes.group.voice.title")}
            description={language.t("settings.runtimes.group.voice.description")}
          >
            <div class="grid gap-4 xl:grid-cols-2">
              <For each={voiceItems()}>
                {(item) => (
                  <RuntimeCard
                    item={item}
                    busy={runningID()}
                    language={language}
                    platform={platform}
                    selectedLogID={selectedLogID()}
                    onAction={(action) => void runAction(item, action)}
                    onActivate={(target) => void runActivate(item, target)}
                    onViewLogs={() => void focusLogs(item.id)}
                  />
                )}
              </For>
            </div>
          </SettingsSection>

          <SettingsSection
            title={language.t("settings.runtimes.group.code.title")}
            description={language.t("settings.runtimes.group.code.description")}
          >
            <div class="grid gap-4 xl:grid-cols-2">
              <For each={codeItems()}>
                {(item) => (
                  <RuntimeCard
                    item={item}
                    busy={runningID()}
                    language={language}
                    platform={platform}
                    selectedLogID={selectedLogID()}
                    onAction={(action) => void runAction(item, action)}
                    onActivate={(target) => void runActivate(item, target)}
                    onViewLogs={() => void focusLogs(item.id)}
                  />
                )}
              </For>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

function mergeRuntimeDisplayItems(
  items: RuntimeManageItem[],
  language: ReturnType<typeof useLanguage>,
) {
  const pythonBase = items.find((item) => item.id === PYTHON_BASE_ID)
  const pythonManaged = items.find((item) => item.id === PYTHON_MANAGED_ID)
  const mergedPython = mergePythonRuntimeCard(pythonBase, pythonManaged, language)
  return items
    .filter((item) => item.group === "code")
    .filter((item) => item.id !== PYTHON_BASE_ID && item.id !== PYTHON_MANAGED_ID)
    .toSpliced(0, 0, ...(mergedPython ? [mergedPython] : []))
}

function mergePythonRuntimeCard(
  pythonBase: RuntimeManageItem | undefined,
  pythonManaged: RuntimeManageItem | undefined,
  language: ReturnType<typeof useLanguage>,
) {
  const primary = pythonManaged ?? pythonBase
  if (!primary) return
  const managedInstalled = !!pythonManaged?.installed
  const baseInstalled = !!pythonBase?.installed
  const source = managedInstalled ? "managed" : (pythonBase?.source ?? pythonManaged?.source ?? "missing")
  const path = managedInstalled ? pythonManaged?.path : (pythonBase?.path ?? pythonManaged?.path)
  const version = managedInstalled ? pythonManaged?.version : (pythonBase?.version ?? pythonManaged?.version)
  return {
    ...primary,
    id: PYTHON_MANAGED_ID,
    title: language.t("settings.runtimes.python.title"),
    description: language.t("settings.runtimes.python.description"),
    installed: managedInstalled || baseInstalled,
    source,
    scope: "required",
    usedBy: ["python tool", "pip tool"],
    version,
    path,
    detail: renderPythonDetail(pythonBase, pythonManaged, language),
    actions: {
      install: pythonManaged?.actions.install ?? false,
      repair: pythonManaged?.actions.repair ?? false,
      update: false,
      activate: false,
      openPath: !!path,
      viewLogs: pythonManaged?.actions.viewLogs ?? true,
    },
  } satisfies RuntimeManageItem
}

function renderPythonDetail(
  pythonBase: RuntimeManageItem | undefined,
  pythonManaged: RuntimeManageItem | undefined,
  language: ReturnType<typeof useLanguage>,
) {
  const managedDetail = pythonManaged?.detail?.trim()
  if (pythonManaged?.installed) {
    const summary = !pythonBase?.installed
      ? language.t("settings.runtimes.python.detail.managedNoBootstrap")
      : language.t("settings.runtimes.python.detail.managedWithBootstrap", {
          source: language.t(`settings.runtimes.source.${pythonBase.source}`),
        })
    return managedDetail ? `${summary} ${managedDetail}` : summary
  }
  if (pythonBase?.installed) {
    const summary = language.t("settings.runtimes.python.detail.bootstrapOnly", {
      source: language.t(`settings.runtimes.source.${pythonBase.source}`),
    })
    return managedDetail ? `${summary} ${managedDetail}` : summary
  }
  return (
    pythonManaged?.detail ??
    pythonBase?.detail ??
    language.t("settings.runtimes.python.detail.missing")
  )
}

const RuntimeCard: Component<{
  item: RuntimeManageItem
  busy?: string
  language: ReturnType<typeof useLanguage>
  platform: ReturnType<typeof usePlatform>
  selectedLogID?: string
  onAction: (action: "install" | "repair" | "update") => void
  onActivate: (target: string) => void
  onViewLogs: () => void
}> = (props) => {
  const installing = () => props.busy === `install:${props.item.id}`
  const repairing = () => props.busy === `repair:${props.item.id}`
  const updating = () => props.busy === `update:${props.item.id}`
  const activatingTarget = () =>
    props.item.targets.find((target) => props.busy === `activate:${props.item.id}:${target.id}`)?.id
  const statusLabel = () => {
    if (!props.item.installed) return props.language.t("settings.runtimes.status.missing")
    if (props.item.source === "managed") return props.language.t("settings.runtimes.status.installedManaged")
    if (props.item.source === "bundled") return props.language.t("settings.runtimes.status.installedBundled")
    return props.language.t("settings.runtimes.status.installedSystem")
  }
  const installLabel = () => {
    if (props.item.installed && props.item.source !== "managed") {
      return props.language.t("settings.runtimes.action.installManaged")
    }
    return props.language.t("settings.runtimes.action.install")
  }
  const inactiveTargets = () => props.item.targets.filter((target) => !target.active)
  const activeTarget = () => props.item.targets.find((target) => target.active)

  return (
    <div class="flex flex-col gap-4 rounded-lg border border-border-weak-base bg-surface-elevated p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-14-medium text-text-strong">{props.item.title}</div>
          <div class="pt-1 text-12-regular text-text-weak">{props.item.description}</div>
        </div>
        <div
          class={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            props.item.installed ? "bg-status-success/10 text-status-success" : "bg-status-warning/10 text-status-warning"
          }`}
        >
          {statusLabel()}
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Badge>{props.language.t(`settings.runtimes.source.${props.item.source}`)}</Badge>
        <Badge>{props.language.t(`settings.runtimes.scope.${props.item.scope}`)}</Badge>
      </div>

      <SettingsList>
        <SettingsRow title={props.language.t("settings.runtimes.usedBy")} description={props.item.usedBy.join(" · ")} />
        <Show when={props.item.version}>
          {(value) => <SettingsRow title={props.language.t("settings.runtimes.version")} description={value()} />}
        </Show>
        <Show when={props.item.path}>
          {(value) => <SettingsRow title={props.language.t("settings.runtimes.path")} description={value()} mono />}
        </Show>
        <Show when={props.item.detail}>
          {(value) => <SettingsRow title={props.language.t("settings.runtimes.detail")} description={value()} />}
        </Show>
        <Show when={activeTarget()}>
          {(value) => <SettingsRow title={props.language.t("settings.runtimes.activeTarget")} description={value().label} />}
        </Show>
      </SettingsList>

      <div class="flex flex-wrap gap-3">
        <Show when={props.item.actions.install}>
          <Button size="small" variant="secondary" disabled={!!props.busy} onClick={() => props.onAction("install")}>
            {installing() ? props.language.t("common.loading") : installLabel()}
          </Button>
        </Show>
        <Show when={props.item.actions.repair}>
          <Button size="small" variant="secondary" disabled={!!props.busy} onClick={() => props.onAction("repair")}>
            {repairing() ? props.language.t("common.loading") : props.language.t("settings.runtimes.action.repair")}
          </Button>
        </Show>
        <Show when={props.item.actions.update}>
          <Button size="small" variant="secondary" disabled={!!props.busy} onClick={() => props.onAction("update")}>
            {updating() ? props.language.t("common.loading") : props.language.t("settings.runtimes.action.update")}
          </Button>
        </Show>
        <Show when={props.item.actions.activate}>
          <For each={inactiveTargets()}>
            {(target) => (
              <Button size="small" variant="ghost" disabled={!!props.busy} onClick={() => props.onActivate(target.id)}>
                {activatingTarget() === target.id
                  ? props.language.t("common.loading")
                  : props.language.t("settings.runtimes.action.useTarget", { target: target.label })}
              </Button>
            )}
          </For>
        </Show>
        <Show when={props.item.actions.openPath && props.item.path}>
          {(value) => (
            <Button
              size="small"
              variant="ghost"
              disabled={!props.platform.openPath}
              onClick={() => void props.platform.openPath?.(value())}
            >
              {props.language.t("settings.runtimes.action.openPath")}
            </Button>
          )}
        </Show>
        <Show when={props.item.actions.viewLogs}>
          <Button
            size="small"
            variant={props.selectedLogID === props.item.id ? "secondary" : "ghost"}
            onClick={props.onViewLogs}
          >
            {props.language.t("settings.runtimes.action.viewLogs")}
          </Button>
        </Show>
      </div>
    </div>
  )
}

const SettingsMessage: Component<{ children: JSX.Element }> = (props) => {
  return (
    <div class="mb-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-4 text-14-regular text-status-warning">
      {props.children}
    </div>
  )
}

const SettingsSection: Component<{
  title: string
  description?: string | JSX.Element
  action?: JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong">{props.title}</h3>
          <Show when={props.description}>
            {(value) => <div class="text-12-regular text-text-weak">{value()}</div>}
          </Show>
        </div>
        <Show when={props.action}>{(value) => value()}</Show>
      </div>
      {props.children}
    </div>
  )
}

const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">{props.children}</div>
}

const SettingsRow: Component<{ title: string; description: string | JSX.Element; mono?: boolean }> = (props) => {
  return (
    <div class="flex flex-col gap-1 border-b border-border-weak-base pb-2 last:border-none last:pb-0">
      <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-text-subtle">{props.title}</div>
      <div class={props.mono ? "break-all font-mono text-[11px] text-text-weak" : "text-12-regular text-text-weak"}>{props.description}</div>
    </div>
  )
}

const Badge: Component<{ children: JSX.Element; tone?: "default" | "success" | "warning" }> = (props) => {
  return (
    <span
      class={
        props.tone === "success"
          ? "rounded-full bg-status-success/10 px-2.5 py-1 text-[11px] font-medium text-status-success"
          : props.tone === "warning"
            ? "rounded-full bg-status-warning/10 px-2.5 py-1 text-[11px] font-medium text-status-warning"
            : "rounded-full bg-surface-base px-2.5 py-1 text-[11px] font-medium text-text-weak"
      }
    >
      {props.children}
    </span>
  )
}

function formatLogTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}
