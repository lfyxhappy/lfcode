import { type Component, type JSX, For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@lfcode-ai/ui/button"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { showToast } from "@lfcode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { formatServerError } from "@/utils/server-errors"
import { UiAutomationRegistry } from "@/automation/registry"
import {
  appControlUiDriverTokens,
  isAppControlUiDriverToken,
  resolveAppControlUiDriverElement,
  snapshotUiDriverElement,
} from "@/automation/ui-driver"
import { SettingsList } from "./settings-list"
import {
  appControlDirty,
  appControlDiagnosticsFilename,
  appControlEventScopeOptions,
  appControlMessages,
  appControlSaveDisabled,
  createAppControlDraft,
  filterAppControlEvents,
  normalizeAppControlTargets,
  normalizeAppControlEvents,
  summarizeAppControlRequestLogs,
  type AppControlEventKindFilter,
  type AppControlEventScopeFilter,
  type AppControlPermission,
  type BrowserControlPermission,
  type AppControlDraft,
  type AppControlEvent,
  type AppControlState,
  type AppControlTarget,
} from "./settings-app-control-helpers"

export const SettingsAppControl: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const platform = usePlatform()
  const [saved, setSaved] = createSignal<AppControlDraft>()
  const [draft, setDraft] = createSignal<AppControlDraft>({
    enabled: true,
    permission: "full_app_control",
    browser: { enabled: true, permission: "interactive" },
  })
  const [saveError, setSaveError] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const [selectedTarget, setSelectedTarget] = createSignal<AppControlTarget>("app")
  const [events, setEvents] = createSignal<AppControlEvent[]>([])
  const [eventsLoading, setEventsLoading] = createSignal(false)
  const [eventsError, setEventsError] = createSignal<string>()
  const [eventScopeFilter, setEventScopeFilter] = createSignal<AppControlEventScopeFilter>("all")
  const [eventKindFilter, setEventKindFilter] = createSignal<AppControlEventKindFilter>("all")
  const [diagnosticsLoading, setDiagnosticsLoading] = createSignal(false)
  const [diagnosticsError, setDiagnosticsError] = createSignal<string>()
  const [diagnosticsPath, setDiagnosticsPath] = createSignal<string>()
  const [diagnosticsCapturePath, setDiagnosticsCapturePath] = createSignal<string>()
  const [diagnosticsJson, setDiagnosticsJson] = createSignal("")

  const [state] = createResource(async () => {
    const result = await globalSDK.client.global.appControl.get()
    return result.data as AppControlState
  })

  createEffect(() => {
    const next = state.latest
    if (!next) return
    const normalized = createAppControlDraft(next)
    setSaved(normalized)
    setDraft(normalized)
    setSelectedTarget(normalizeAppControlTargets(next).selected)
    setSaveError(undefined)
  })

  const loadError = createMemo(() => {
    if (!state.error) return
    return formatServerError(state.error, language.t, language.t("common.requestFailed"))
  })
  const dirty = createMemo(() => appControlDirty(saved(), draft()))
  const messages = createMemo(() => appControlMessages(loadError(), saveError()))
  const saveDisabled = createMemo(() =>
    appControlSaveDisabled({
      saved: saved(),
      draft: draft(),
      loading: state.loading,
      saving: saving(),
      loadError: loadError(),
    }),
  )
  const permissionOptions = createMemo<{ value: AppControlPermission; label: string }[]>(() => [
    { value: "read_only", label: language.t("settings.appControl.permission.readOnly") },
    { value: "session_control", label: language.t("settings.appControl.permission.sessionControl") },
    { value: "full_app_control", label: language.t("settings.appControl.permission.fullAppControl") },
  ])
  const browserPermissionOptions = createMemo<{ value: BrowserControlPermission; label: string }[]>(() => [
    { value: "read_only", label: language.t("settings.appControl.browser.permission.readOnly") },
    { value: "interactive", label: language.t("settings.appControl.browser.permission.interactive") },
  ])
  const targets = createMemo(() => normalizeAppControlTargets(state.latest).targets)
  const service = createMemo(() => state.latest?.service)
  const eventScopeOptions = createMemo(() => appControlEventScopeOptions(events()))
  const eventKindOptions = createMemo<AppControlEventKindFilter[]>(() => ["all", "requests", "errors"])
  const requestLogs = createMemo(() => summarizeAppControlRequestLogs(events()).slice(0, 8))
  const filteredEvents = createMemo(() =>
    filterAppControlEvents(events(), {
      scope: eventScopeFilter(),
      kind: eventKindFilter(),
    }),
  )
  const targetMeta = createMemo<
    Record<
      AppControlTarget,
      {
        title: string
        description: string
      }
    >
  >(() => ({
    app: {
      title: language.t("settings.appControl.target.app.title"),
      description: language.t("settings.appControl.target.app.description"),
    },
  }))

  const save = async () => {
    if (!dirty() || saving()) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await globalSDK.client.global.appControl.save({
        globalAppControlSave: {
          enabled: draft().enabled,
          permission: draft().permission,
          browser: draft().browser,
        },
      })
      const next = result.data as AppControlState
      const normalized = createAppControlDraft(next)
      setSaved(normalized)
      setDraft(normalized)
      showToast({
        variant: "success",
        title: language.t("settings.appControl.toast.saved.title"),
        description: language.t("settings.appControl.toast.saved.description"),
      })
    } catch (error) {
      setSaveError(formatServerError(error, language.t, language.t("common.requestFailed")))
    } finally {
      setSaving(false)
    }
  }

  const refreshEvents = async () => {
    if (!service()?.detected || eventsLoading()) return
    setEventsLoading(true)
    setEventsError(undefined)
    try {
      const result = await globalSDK.client.global.appControl.events({ limit: 20 })
      setEvents(normalizeAppControlEvents(result.data))
    } catch (error) {
      setEventsError(formatServerError(error, language.t, language.t("common.requestFailed")))
    } finally {
      setEventsLoading(false)
    }
  }

  createEffect(() => {
    if (selectedTarget() !== "app") return
    if (!service()?.detected) return
    void refreshEvents()
  })

  const captureDiagnostics = async () => {
    if (!service()?.detected || diagnosticsLoading()) return
    setDiagnosticsLoading(true)
    setDiagnosticsError(undefined)
    try {
      const savePath = await platform.saveFilePickerDialog?.({
        title: language.t("settings.appControl.diagnostics.exportDialog.title"),
        defaultPath: appControlDiagnosticsFilename(),
      })
      if (savePath) {
        const result = await globalSDK.client.global.appControl.exportDiagnosticsBundle({
          path: savePath,
          eventLimit: 50,
          label: "app-control-settings",
        })
        const data = result.data as { path?: string; capturePath?: string } | undefined
        setDiagnosticsPath(data?.path)
        setDiagnosticsCapturePath(data?.capturePath)
        setDiagnosticsJson("")
        showToast({
          variant: "success",
          title: language.t("settings.appControl.diagnostics.exported.title"),
          description: data?.path ?? language.t("settings.appControl.diagnostics.exported.description"),
        })
        return
      }

      const result = await globalSDK.client.global.appControl.diagnosticsBundle({
        eventLimit: 50,
        label: "app-control-settings",
      })
      setDiagnosticsPath(undefined)
      const preview = JSON.stringify(result.data, null, 2)
      setDiagnosticsJson(preview)
      const capture = result.data as { capture?: { path?: string } } | undefined
      setDiagnosticsCapturePath(capture?.capture?.path)
      showToast({
        variant: "success",
        title: language.t("settings.appControl.diagnostics.captured.title"),
        description: language.t("settings.appControl.diagnostics.captured.description"),
      })
    } catch (error) {
      setDiagnosticsError(formatServerError(error, language.t, language.t("common.requestFailed")))
    } finally {
      setDiagnosticsLoading(false)
    }
  }

  const copyDiagnosticsJson = async () => {
    const value = diagnosticsJson()
    if (!value) return
    await navigator.clipboard.writeText(value)
    showToast({
      variant: "success",
      title: language.t("settings.appControl.diagnostics.copied.title"),
      description: language.t("settings.appControl.diagnostics.copied.description"),
    })
  }

  const eventDetail = (event: AppControlEvent) => {
    if (typeof event.data?.path === "string") return event.data.path
    if (typeof event.data?.route === "string") return event.data.route
    if (typeof event.data?.requestID === "string") return event.data.requestID
    return ""
  }

  const eventMeta = (event: AppControlEvent) => {
    const parts = []
    if (typeof event.data?.status === "number") parts.push(`HTTP ${event.data.status}`)
    if (typeof event.data?.durationMs === "number") parts.push(`${event.data.durationMs}ms`)
    return parts.join(" · ")
  }

  const eventScopeLabel = (value: AppControlEventScopeFilter) => {
    if (value === "all") return language.t("settings.appControl.diagnostics.events.filter.all")
    if (value === "main") return language.t("settings.appControl.diagnostics.events.filter.scope.main")
    if (value === "renderer") return language.t("settings.appControl.diagnostics.events.filter.scope.renderer")
    return language.t("settings.appControl.diagnostics.events.filter.scope.server")
  }

  const eventKindLabel = (value: AppControlEventKindFilter) => {
    if (value === "all") return language.t("settings.appControl.diagnostics.events.filter.all")
    if (value === "requests") return language.t("settings.appControl.diagnostics.events.filter.kind.requests")
    return language.t("settings.appControl.diagnostics.events.filter.kind.errors")
  }

  onMount(() => {
    const snapshot = (token: Parameters<LfcodeUiAutomationDriver["query"]>[0]["token"]) =>
      snapshotUiDriverElement(token, isAppControlUiDriverToken(token) ? resolveAppControlUiDriverElement(token) : undefined)
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const unregister = UiAutomationRegistry.register({
      id: "settings.app-control",
      tokens: appControlUiDriverTokens,
      query: (input) => snapshot(input.token),
      click: async (input) => {
        if (!isAppControlUiDriverToken(input.token)) throw new Error(`UI token was not found: ${input.token}`)
        const node = resolveAppControlUiDriverElement(input.token)
        if (!node) throw new Error(`UI token was not found: ${input.token}`)
        const target = node.matches('button, a, input, [role="button"]')
          ? node
          : node.querySelector('button, a, input, [role="button"]')
        ;(target instanceof HTMLElement ? target : node).click()
        await nextFrame()
        return snapshot(input.token)
      },
      readText: (input) => snapshot(input.token).text ?? "",
      wait: async (input) => {
        const timeoutMs = input.timeoutMs ?? 10_000
        const intervalMs = input.intervalMs ?? 120
        const startedAt = Date.now()
        while (Date.now() - startedAt <= timeoutMs) {
          const current = snapshot(input.token)
          if (current.found && (input.visible === undefined || current.visible === input.visible)) return current
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
        }
        return snapshot(input.token)
      },
    })
    onCleanup(unregister)
  })

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
        <div class="flex max-w-[980px] items-start justify-between gap-4 pb-4 pt-4">
          <div class="min-w-0 flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.appControl")}</h2>
            <p class="text-14-regular text-text-weak">{language.t("settings.appControl.description")}</p>
          </div>
          <Button
            size="large"
            variant="secondary"
            class="shrink-0"
            data-action="settings-app-control-save"
            disabled={saveDisabled()}
            onClick={() => void save()}
          >
            {saving() ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </div>

      <div class="max-w-[980px]">
        <Show when={messages().length > 0}>
          <div class="mb-4 flex flex-col gap-3">
            {messages().map((message) => (
              <SettingsMessage>{message}</SettingsMessage>
            ))}
          </div>
        </Show>

        <div class="flex flex-col gap-6">
          <SettingsSection
            title={language.t("settings.appControl.section.targets.title")}
            description={language.t("settings.appControl.section.targets.description")}
          >
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <For each={targets()}>
                {(target) => (
                  <button
                    type="button"
                    data-action={`settings-app-control-target-${target}`}
                    class={`flex min-h-[132px] min-w-0 flex-col rounded-lg border px-4 py-4 text-left transition-colors ${
                      selectedTarget() === target
                        ? "border-border-strong bg-surface-base shadow-[0_0_0_1px_var(--border-strong)]"
                        : "border-border-weak-base bg-surface-elevated hover:bg-surface-base"
                    }`}
                    onClick={() => setSelectedTarget(target)}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="flex flex-col gap-1">
                        <span class="text-14-medium text-text-strong">{targetMeta()[target].title}</span>
                        <span class="text-12-regular text-text-weak">{targetMeta()[target].description}</span>
                      </div>
                      <div class="flex max-w-[48%] shrink-0 flex-wrap items-center justify-end gap-1.5">
                        <span
                          class={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            selectedTarget() === target
                              ? "bg-text/8 text-text-strong"
                              : "bg-surface-base text-text-weak"
                          }`}
                        >
                          {selectedTarget() === target
                            ? language.t("settings.appControl.target.badge.current")
                            : language.t("settings.appControl.target.badge.available")}
                        </span>
                        <Show when={target === "app"}>
                          <span
                            class={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                              service()?.detected
                                ? "bg-status-success/10 text-status-success"
                                : "bg-status-warning/10 text-status-warning"
                            }`}
                          >
                            {service()?.detected
                              ? language.t("settings.appControl.status.badge.connected")
                              : language.t("settings.appControl.status.badge.waiting")}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </SettingsSection>

          <Show when={selectedTarget() === "app"}>
            <>
              <SettingsSection
                title={language.t("settings.appControl.section.access.title")}
                description={language.t("settings.appControl.section.access.description")}
              >
                <SettingsList>
                  <SettingsRow
                    title={language.t("settings.appControl.enabled.title")}
                    description={language.t("settings.appControl.enabled.description")}
                  >
                    <div data-action="settings-app-control-enabled">
                      <Switch
                        checked={draft().enabled}
                        onChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            enabled: checked,
                          }))
                        }
                      />
                    </div>
                  </SettingsRow>

                  <SettingsRow
                    title={language.t("settings.appControl.permission.title")}
                    description={language.t("settings.appControl.permission.description")}
                  >
                    <Select
                      data-action="settings-app-control-permission"
                      options={permissionOptions()}
                      current={permissionOptions().find((item) => item.value === draft().permission)}
                      value={(item) => item.value}
                      label={(item) => item.label}
                      onSelect={(item) =>
                        item &&
                        setDraft((current) => ({
                          ...current,
                          permission: item.value,
                        }))
                      }
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </SettingsRow>
                </SettingsList>
              </SettingsSection>

              <SettingsSection
                title={language.t("settings.appControl.browser.title")}
                description={language.t("settings.appControl.browser.description")}
              >
                <SettingsList>
                  <SettingsRow
                    title={language.t("settings.appControl.browser.enabled.title")}
                    description={language.t("settings.appControl.browser.enabled.description")}
                  >
                    <div data-action="settings-browser-control-enabled">
                      <Switch
                        checked={draft().browser.enabled}
                        onChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            browser: { ...current.browser, enabled: checked },
                          }))
                        }
                      />
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    title={language.t("settings.appControl.browser.permission.title")}
                    description={language.t("settings.appControl.browser.permission.description")}
                  >
                    <Select
                      data-action="settings-browser-control-permission"
                      options={browserPermissionOptions()}
                      current={browserPermissionOptions().find((item) => item.value === draft().browser.permission)}
                      value={(item) => item.value}
                      label={(item) => item.label}
                      onSelect={(item) =>
                        item &&
                        setDraft((current) => ({
                          ...current,
                          browser: { ...current.browser, permission: item.value },
                        }))
                      }
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </SettingsRow>
                </SettingsList>
              </SettingsSection>

              <div
                data-action="settings-app-control-metadata"
                data-service-detected={service()?.detected ? "true" : "false"}
                data-service-host={service()?.host}
                data-service-port={service()?.port}
                data-service-version={service()?.version}
                data-service-protocol-version={service()?.protocolVersion}
                data-service-instance-id={service()?.instanceID}
              >
                <SettingsSection
                  title={language.t("settings.appControl.section.status.title")}
                  description={language.t("settings.appControl.section.status.description")}
                >
                  <SettingsList>
                    <SettingsRow
                      title={language.t("settings.appControl.status.connection.title")}
                      description={
                        service()?.detected
                          ? language.t("settings.appControl.status.connection.detected")
                          : language.t("settings.appControl.status.connection.missing")
                      }
                    >
                      <div
                        class={`rounded-full px-3 py-1 text-12-medium ${
                          service()?.detected
                            ? "bg-status-success/10 text-status-success"
                            : "bg-status-warning/10 text-status-warning"
                        }`}
                      >
                        {service()?.detected
                          ? language.t("settings.appControl.status.badge.connected")
                          : language.t("settings.appControl.status.badge.waiting")}
                      </div>
                    </SettingsRow>

                    <SettingsRow
                      title={language.t("settings.appControl.status.discoveryFile.title")}
                      description={language.t("settings.appControl.status.discoveryFile.description")}
                    >
                      <span class="max-w-[460px] break-all font-mono text-[11px] text-text-subtle">
                        {service()?.discoveryFile ?? ""}
                      </span>
                    </SettingsRow>

                    <Show when={service()?.detected}>
                      <SettingsRow
                        title={language.t("settings.appControl.status.endpoint.title")}
                        description={language.t("settings.appControl.status.endpoint.description")}
                      >
                        <span class="font-mono text-[11px] text-text-subtle">
                          {service()?.host}:{service()?.port}
                        </span>
                      </SettingsRow>
                      <SettingsRow
                        title={language.t("settings.appControl.status.process.title")}
                        description={language.t("settings.appControl.status.process.description")}
                      >
                        <span class="font-mono text-[11px] text-text-subtle">
                          PID {service()?.pid ?? "-"} · {service()?.version ?? "-"}
                        </span>
                      </SettingsRow>
                      <Show when={service()?.startedAt}>
                        {(value) => (
                          <SettingsRow
                            title={language.t("settings.appControl.status.startedAt.title")}
                            description={language.t("settings.appControl.status.startedAt.description")}
                          >
                            <span class="text-12-regular text-text-weak">{new Date(value()).toLocaleString()}</span>
                          </SettingsRow>
                        )}
                      </Show>
                    </Show>
                  </SettingsList>
                </SettingsSection>
              </div>

              <SettingsSection
                title={language.t("settings.appControl.section.diagnostics.title")}
                description={language.t("settings.appControl.section.diagnostics.description")}
              >
                <div
                  class="flex flex-col gap-4"
                  data-action="settings-app-control-diagnostics"
                  data-diagnostics-loading={diagnosticsLoading() ? "true" : "false"}
                  data-diagnostics-path={diagnosticsPath()}
                  data-diagnostics-capture-path={diagnosticsCapturePath()}
                >
                  <div
                    class="flex flex-wrap items-center justify-between gap-3"
                    data-action="settings-app-control-events"
                    data-event-count={events().length}
                    data-events-loading={eventsLoading() ? "true" : "false"}
                    data-events-error={eventsError()}
                  >
                    <div class="min-w-0">
                      <div class="text-14-medium text-text-strong">
                        {language.t("settings.appControl.diagnostics.events.title")}
                      </div>
                      <div class="text-12-regular text-text-weak">
                        {language.t("settings.appControl.diagnostics.events.description")}
                      </div>
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      data-action="settings-app-control-refresh-events"
                      disabled={!service()?.detected || eventsLoading()}
                      onClick={() => void refreshEvents()}
                    >
                      {eventsLoading()
                        ? language.t("settings.appControl.diagnostics.events.loading")
                        : language.t("settings.appControl.diagnostics.events.refresh")}
                    </Button>
                  </div>

                  <Show when={eventsError()}>
                    {(message) => <SettingsMessage>{message()}</SettingsMessage>}
                  </Show>

                  <div class="flex flex-col gap-3 border-b border-border-weak-base pb-4">
                    <div>
                      <div class="text-12-medium text-text-strong">
                        {language.t("settings.appControl.diagnostics.requests.title")}
                      </div>
                      <div class="pt-0.5 text-[11px] text-text-weak">
                        {language.t("settings.appControl.diagnostics.requests.description")}
                      </div>
                    </div>
                    <Show
                      when={requestLogs().length > 0}
                      fallback={
                        <div class="rounded-lg border border-border-weak-base bg-surface-elevated px-3 py-2 text-[11px] text-text-weak">
                          {language.t("settings.appControl.diagnostics.requests.empty")}
                        </div>
                      }
                    >
                  <div class="max-h-64 overflow-y-auto rounded-lg border border-border-weak-base bg-surface-elevated">
                        <For each={requestLogs()}>
                          {(item) => (
                            <div class="flex flex-wrap items-start gap-3 border-b border-border-weak-base px-3 py-2 text-[11px] last:border-none">
                              <div class="w-18 shrink-0 text-text-weak">{new Date(item.timestamp).toLocaleTimeString()}</div>
                              <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                  <span class="font-medium text-text-strong">{item.method ?? "REQUEST"}</span>
                                  <span class="truncate font-mono text-text-weak">{item.path ?? item.requestID}</span>
                                  <span
                                    class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      item.failed
                                        ? "bg-status-warning/10 text-status-warning"
                                        : "bg-status-success/10 text-status-success"
                                    }`}
                                  >
                                    {item.failed
                                      ? language.t("settings.appControl.diagnostics.requests.failed")
                                      : language.t("settings.appControl.diagnostics.requests.succeeded")}
                                  </span>
                                </div>
                                <div class="pt-1 text-text-subtle">
                                  {[
                                    item.scope.toUpperCase(),
                                    typeof item.status === "number" ? `HTTP ${item.status}` : undefined,
                                    typeof item.durationMs === "number" ? `${item.durationMs}ms` : undefined,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <div class="flex flex-col gap-3 border-b border-border-weak-base pb-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-text-subtle">
                        {language.t("settings.appControl.diagnostics.events.filter.scope.title")}
                      </span>
                      <For each={eventScopeOptions()}>
                        {(option) => (
                          <button
                            type="button"
                            class={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                              eventScopeFilter() === option
                                ? "border-border-strong bg-surface-elevated text-text-strong"
                                : "border-border-weak-base bg-transparent text-text-weak hover:bg-surface-elevated"
                            }`}
                            onClick={() => setEventScopeFilter(option)}
                          >
                            {eventScopeLabel(option)}
                          </button>
                        )}
                      </For>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-text-subtle">
                        {language.t("settings.appControl.diagnostics.events.filter.kind.title")}
                      </span>
                      <For each={eventKindOptions()}>
                        {(option) => (
                          <button
                            type="button"
                            class={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                              eventKindFilter() === option
                                ? "border-border-strong bg-surface-elevated text-text-strong"
                                : "border-border-weak-base bg-transparent text-text-weak hover:bg-surface-elevated"
                            }`}
                            onClick={() => setEventKindFilter(option)}
                          >
                            {eventKindLabel(option)}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  <Show
                    when={filteredEvents().length > 0}
                    fallback={
                      <div class="rounded-md border border-border-weak-base bg-surface-base px-4 py-3 text-12-regular text-text-weak">
                        {!service()?.detected
                          ? language.t("settings.appControl.status.connection.missing")
                          : events().length === 0
                            ? language.t("settings.appControl.diagnostics.events.empty")
                            : language.t("settings.appControl.diagnostics.events.filteredEmpty")}
                      </div>
                    }
                  >
                    <div class="max-h-80 overflow-y-auto rounded-md border border-border-weak-base bg-surface-base">
                      <For each={filteredEvents()}>
                        {(event) => (
                          <div class="flex flex-wrap items-start gap-3 border-b border-border-weak-base px-4 py-3 text-12-regular last:border-none">
                            <div class="w-20 shrink-0 text-text-weak">{new Date(event.timestamp).toLocaleTimeString()}</div>
                            <div class="w-18 shrink-0 text-text-weak uppercase">{event.scope}</div>
                            <div class="min-w-0 flex-1">
                              <div class="text-text-strong">{event.type}</div>
                              <Show when={eventDetail(event)}>
                                {(detail) => <div class="truncate pt-0.5 font-mono text-[11px] text-text-weak">{detail()}</div>}
                              </Show>
                              <Show when={eventMeta(event)}>
                                {(detail) => <div class="truncate pt-0.5 text-[11px] text-text-subtle">{detail()}</div>}
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  <div class="flex flex-wrap items-center gap-3">
                    <Button
                      size="small"
                      variant="secondary"
                      data-action="settings-app-control-export-diagnostics"
                      disabled={!service()?.detected || diagnosticsLoading()}
                      onClick={() => void captureDiagnostics()}
                    >
                      {diagnosticsLoading()
                        ? language.t("settings.appControl.diagnostics.export.loading")
                        : language.t("settings.appControl.diagnostics.export.action")}
                    </Button>

                    <Show when={diagnosticsCapturePath()}>
                      {(path) => (
                        <Button size="small" variant="ghost" disabled={!platform.openPath} onClick={() => void platform.openPath?.(path())}>
                          {language.t("settings.appControl.diagnostics.openCapture")}
                        </Button>
                      )}
                    </Show>

                    <Show when={diagnosticsJson()}>
                      <Button
                        size="small"
                        variant="ghost"
                        data-action="settings-app-control-copy-diagnostics"
                        onClick={() => void copyDiagnosticsJson()}
                      >
                        {language.t("settings.appControl.diagnostics.copyJson")}
                      </Button>
                    </Show>
                  </div>

                  <Show when={diagnosticsError()}>
                    {(message) => <SettingsMessage>{message()}</SettingsMessage>}
                  </Show>

                  <Show when={diagnosticsPath()}>
                    {(path) => (
                      <div class="rounded-md border border-border-weak-base bg-surface-base px-4 py-3">
                        <div class="text-12-medium text-text-strong">{language.t("settings.appControl.diagnostics.exportedPath")}</div>
                        <div class="break-all pt-1 font-mono text-[11px] text-text-weak">{path()}</div>
                      </div>
                    )}
                  </Show>

                  <Show when={diagnosticsJson()}>
                    {(json) => (
                      <div class="rounded-md border border-border-weak-base bg-surface-base px-4 py-3">
                        <div class="pb-2 text-12-medium text-text-strong">{language.t("settings.appControl.diagnostics.preview")}</div>
                        <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-text-weak">
                          {json()}
                        </pre>
                      </div>
                    )}
                  </Show>
                </div>
              </SettingsSection>
            </>
          </Show>
        </div>
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

const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

const SettingsSection: Component<{
  title: string
  description?: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-col gap-1">
      <h3 class="pb-2 text-14-medium text-text-strong">{props.title}</h3>
      <Show when={props.description}>
        {(value) => <div class="pb-2 text-12-regular text-text-weak">{value()}</div>}
      </Show>
      {props.children}
    </div>
  )
}
