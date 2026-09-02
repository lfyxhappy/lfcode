import type { AutomationRun, AutomationSchedule, AutomationTask } from "@lfcode-ai/sdk/v2/client"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { showToast } from "@lfcode-ai/ui/toast"
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { UiAutomationRegistry } from "@/automation/registry"
import { requestScheduledAutomation } from "@/automation/scheduled-task"
import {
  automationSettingsUiDriverTokens,
  isAutomationSettingsUiDriverToken,
  resolveAutomationSettingsUiDriverElement,
  snapshotUiDriverElement,
} from "@/automation/ui-driver"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { SettingsPageShell, SettingsSection } from "./settings-page-shell"

type AutomationTaskListItem = AutomationTask & { latestRun?: AutomationRun }

export function SettingsAutomation() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [selectedTaskID, setSelectedTaskID] = createSignal<string>()
  const [busy, setBusy] = createSignal<string>()
  const [settings, settingsActions] = createResource(async () => {
    const response = await globalSDK.client.global.automation.settings.get()
    return response.data
  })
  const [tasks, taskActions] = createResource(async () => {
    const response = await globalSDK.client.global.automation.list()
    const items = (response.data?.items ?? []) as AutomationTaskListItem[]
    return items.map((task) => ({ task, latestRun: task.latestRun }))
  })
  const [history, historyActions] = createResource(selectedTaskID, async (taskID) => {
    if (!taskID) return []
    const response = await globalSDK.client.global.automation.runs({ id: taskID, limit: 50 })
    return response.data?.items ?? []
  })

  const refresh = () => {
    void taskActions.refetch()
    void settingsActions.refetch()
    if (selectedTaskID()) void historyActions.refetch()
  }

  const notifyError = (error: unknown) => {
    showToast({
      variant: "error",
      title: language.t("settings.automation.toast.failed"),
      description: formatServerError(error, language.t, language.t("common.requestFailed")),
    })
  }

  const perform = async (key: string, operation: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(key)
    try {
      await operation()
      await Promise.all([taskActions.refetch(), settingsActions.refetch()])
      if (selectedTaskID()) await historyActions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.automation.toast.success"),
      })
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(undefined)
    }
  }

  const toggle = (task: AutomationTask) => {
    if (task.status !== "active" && task.status !== "paused") return
    const active = task.status === "active" && task.enabled
    void perform(`toggle:${task.id}`, () =>
      active
        ? globalSDK.client.global.automation.pause({ id: task.id })
        : globalSDK.client.global.automation.resume({ id: task.id }),
    )
  }

  const runNow = (task: AutomationTask) => {
    void perform(`run:${task.id}`, () => globalSDK.client.global.automation.run({ id: task.id }))
  }

  const remove = (task: AutomationTask) => {
    if (typeof window !== "undefined" && !window.confirm(language.t("settings.automation.confirmDelete"))) return
    void perform(`delete:${task.id}`, () => globalSDK.client.global.automation.delete({ id: task.id }))
  }

  const cancelRun = (task: AutomationTask, run: AutomationRun) => {
    void perform(`cancel:${run.id}`, () => globalSDK.client.global.automation.run2.cancel({ id: task.id, runID: run.id }))
  }

  const openSession = (sessionID: string) => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("lfcode:automation-open-session", { detail: { sessionID } }))
  }

  const createTask = () => {
    requestScheduledAutomation({ target: { kind: "global" }, onSaved: refresh })
  }

  const editTask = (task: AutomationTask) => {
    requestScheduledAutomation({ task, onSaved: refresh })
  }

  const setConcurrency = (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 8) return
    void perform("concurrency", () =>
      globalSDK.client.global.automation.settings.update({ automationSettings: { concurrency: value } }),
    )
  }

  onMount(() => {
    const snapshot = (token: Parameters<typeof snapshotUiDriverElement>[0]) =>
      snapshotUiDriverElement(
        token,
        isAutomationSettingsUiDriverToken(token) ? resolveAutomationSettingsUiDriverElement(token) : undefined,
      )
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const unregister = UiAutomationRegistry.register({
      id: "settings.automation",
      tokens: automationSettingsUiDriverTokens,
      query: (input) => snapshot(input.token),
      click: async (input) => {
        if (!isAutomationSettingsUiDriverToken(input.token)) throw new Error(`UI token was not found: ${input.token}`)
        const node = resolveAutomationSettingsUiDriverElement(input.token)
        if (!node) throw new Error(`UI token was not found: ${input.token}`)
        const target = node.matches("button, a, input, [role=button]")
          ? node
          : node.querySelector("button, a, input, [role=button]")
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
    <SettingsPageShell title={language.t("settings.automation.title")}>
      <div class="flex flex-col gap-8" data-action="settings-automation" data-automation-id="settings-automation">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-14-regular text-text-weak">{language.t("settings.automation.description")}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button
              size="small"
              variant="secondary"
              icon="reset"
              data-action="settings-automation-refresh"
              onClick={refresh}
              disabled={tasks.loading}
            >
              {language.t("settings.automation.refresh")}
            </Button>
            <Button size="small" variant="primary" icon="plus-small" data-action="settings-automation-create" onClick={createTask}>
              {language.t("settings.automation.create")}
            </Button>
          </div>
        </div>

        <Show when={tasks.error}>
          <div class="rounded-lg border border-border-weak-base bg-surface-base px-4 py-3 text-13-regular text-status-warning" data-action="settings-automation-error">
            {formatServerError(tasks.error, language.t, language.t("common.requestFailed"))}
          </div>
        </Show>

        <Show when={settings.error}>
          <div class="rounded-lg border border-border-weak-base bg-surface-base px-4 py-3 text-13-regular text-status-warning" data-action="settings-automation-settings-error">
            {formatServerError(settings.error, language.t, language.t("common.requestFailed"))}
          </div>
        </Show>

        <SettingsSection
          title={language.t("settings.automation.capacity.title")}
          description={language.t("settings.automation.capacity.description")}
        >
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base px-4 py-3">
            <div>
              <div class="text-13-medium text-text-strong">{language.t("settings.automation.concurrency")}</div>
              <div class="mt-1 text-12-regular text-text-weak">{language.t("settings.automation.concurrency.description")}</div>
            </div>
            <select
              class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
              aria-label={language.t("settings.automation.concurrency")}
              data-action="settings-automation-concurrency"
              disabled={settings.loading || busy() === "concurrency"}
              value={Math.min(8, Math.max(1, settings.latest?.concurrency ?? 4))}
              onChange={(event) => setConcurrency(Number(event.currentTarget.value))}
            >
              <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>{(value) => <option value={value}>{value}</option>}</For>
            </select>
          </div>
        </SettingsSection>

        <SettingsSection
          title={language.t("settings.automation.list.title")}
          description={language.t("settings.automation.list.description")}
        >
          <Show when={!tasks.loading} fallback={<div class="rounded-lg border border-dashed border-border-weak-base px-4 py-8 text-13-regular text-text-weak">{language.t("settings.automation.loading")}</div>}>
            <Show
              when={(tasks.latest?.length ?? 0) > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-border-weak-base px-4 py-8 text-center" data-action="settings-automation-empty">
                  <div class="text-14-medium text-text-strong">{language.t("settings.automation.empty")}</div>
                  <div class="mt-1 text-12-regular text-text-weak">{language.t("settings.automation.empty.description")}</div>
                </div>
              }
            >
              <div class="overflow-hidden rounded-lg border border-border-weak-base bg-surface-base" data-action="settings-automation-list">
                <For each={tasks.latest}>
                  {(entry) => {
                    const task = () => entry.task
                    const selected = () => selectedTaskID() === task().id
                    return (
                      <div class="border-b border-border-weak-base px-4 py-4 last:border-none" data-action={`settings-automation-task-${task().id}`}>
                        <div class="flex flex-wrap items-start justify-between gap-4">
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                              <span class={`size-2 shrink-0 rounded-full ${task().status === "active" && task().enabled ? "bg-status-success" : "bg-icon-weak-base"}`} />
                              <span class="truncate text-14-medium text-text-strong">{task().name}</span>
                              <span class="shrink-0 text-11-regular text-text-weak">{taskStatusLabel(task(), language.t)}</span>
                            </div>
                            <div class="mt-2 grid gap-x-5 gap-y-1 text-12-regular text-text-weak sm:grid-cols-2">
                              <span>
                                <span class="text-text-weaker">{language.t("settings.automation.schedule")}:</span>
                                {scheduleLabel(task().schedule, language.t, language.intl(), task().timezone)}
                              </span>
                              <span>
                                <span class="text-text-weaker">{language.t("settings.automation.target")}:</span>
                                {targetLabel(task(), language.t)}
                              </span>
                              <span>
                                <span class="text-text-weaker">{language.t("settings.automation.nextRun")}:</span>
                                {formatTime(task().nextRunAt, language.intl(), task().timezone) ?? language.t("settings.automation.none")}
                                <span class="ml-1 text-11-regular text-text-weaker">
                                  {language.t("settings.automation.timezone", { value: task().timezone })}
                                </span>
                              </span>
                              <span>
                                <span class="text-text-weaker">{language.t("settings.automation.agent")}：</span>
                                {task().agent || language.t("settings.automation.defaultAgent")}
                              </span>
                            </div>
                            <div class="mt-2 line-clamp-2 whitespace-pre-wrap text-13-regular text-text-base">{task().message}</div>
                            <Show when={entry.latestRun}>
                              {(run) => (
                                <div class="mt-2 rounded-md bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak" data-action={`settings-automation-result-${task().id}`}>
                                  <span class="text-text-weaker">{language.t("settings.automation.result")}:</span>
                                  <span class="line-clamp-2">{run().result || run().error || runStatusLabel(run(), language.t)}</span>
                                </div>
                              )}
                            </Show>
                          </div>
                          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
                            <Button
                              size="small"
                              variant="ghost"
                              icon="edit"
                              data-action={`settings-automation-edit-${task().id}`}
                              onClick={() => editTask(task())}
                            >
                              {language.t("settings.automation.action.edit")}
                            </Button>
                            <Show when={task().status === "active" || task().status === "paused"}>
                              <Button
                                size="small"
                                variant="ghost"
                                icon={task().status === "active" && task().enabled ? "stop" : "arrow-right"}
                                data-action={`settings-automation-toggle-${task().id}`}
                                disabled={busy() === `toggle:${task().id}`}
                                onClick={() => toggle(task())}
                              >
                                {task().status === "active" && task().enabled
                                  ? language.t("settings.automation.action.pause")
                                  : language.t("settings.automation.action.resume")}
                              </Button>
                            </Show>
                            <Button
                              size="small"
                              variant="ghost"
                              icon="arrow-right"
                              data-action={`settings-automation-run-${task().id}`}
                              disabled={busy() === `run:${task().id}` || task().status === "deleted"}
                              onClick={() => runNow(task())}
                            >
                              {language.t("settings.automation.action.run")}
                            </Button>
                            <Button
                              size="small"
                              variant="ghost"
                              icon="status"
                              data-action={`settings-automation-history-${task().id}`}
                              aria-pressed={selected()}
                              onClick={() => setSelectedTaskID((current) => (current === task().id ? undefined : task().id))}
                            >
                              {language.t("settings.automation.action.history")}
                            </Button>
                            <Button
                              size="small"
                              variant="ghost"
                              icon="trash"
                              data-action={`settings-automation-delete-${task().id}`}
                              disabled={busy() === `delete:${task().id}`}
                              onClick={() => remove(task())}
                            >
                              {language.t("settings.automation.action.delete")}
                            </Button>
                          </div>
                        </div>

                        <Show when={selected()}>
                          <div class="mt-4 border-t border-border-weak-base pt-3" data-action="settings-automation-history">
                            <div class="mb-2 flex items-center justify-between gap-3">
                              <h4 class="text-13-medium text-text-strong">{language.t("settings.automation.history.title")}</h4>
                              <Show when={history.loading}>
                                <span class="text-11-regular text-text-weak">{language.t("settings.automation.history.loading")}</span>
                              </Show>
                            </div>
                            <Show
                              when={(history.latest?.length ?? 0) > 0}
                              fallback={<div class="rounded-md border border-dashed border-border-weak-base px-3 py-4 text-12-regular text-text-weak">{language.t("settings.automation.history.empty")}</div>}
                            >
                              <div class="overflow-hidden rounded-md border border-border-weak-base">
                                <For each={history.latest}>
                                  {(run) => (
                                    <div class="border-b border-border-weak-base px-3 py-2.5 last:border-none" data-action={`settings-automation-run-${run.id}`}>
                                      <div class="flex flex-wrap items-center justify-between gap-2">
                                        <div class="flex items-center gap-2 text-12-medium text-text-strong">
                                          <Icon name="status" size="small" />
                                          {runStatusLabel(run, language.t)}
                                          <Show when={run.late}>
                                            <span class="text-11-regular text-status-warning">{language.t("settings.automation.late")}</span>
                                          </Show>
                                        </div>
                                        <span class="text-11-regular text-text-weak">{formatTime(run.createdAt, language.intl(), task().timezone)}</span>
                                      </div>
                                      <Show when={run.result || run.error}>
                                        {(summary) => <div class="mt-1 line-clamp-2 whitespace-pre-wrap text-12-regular text-text-weak">{summary()}</div>}
                                      </Show>
                                      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-11-regular text-text-weaker">
                                        <span>{language.t("settings.automation.run.trigger", { value: run.trigger })}</span>
                                        <span>{language.t("settings.automation.run.attempt", { value: run.attempt })}</span>
                                        <Show when={run.sessionID}>
                                          {(sessionID) => (
                                            <Button size="small" variant="ghost" icon="open-file" data-action={`settings-automation-open-session-${run.id}`} onClick={() => openSession(sessionID())}>
                                              {language.t("settings.automation.action.open")}
                                            </Button>
                                          )}
                                        </Show>
                                        <Show when={run.status === "queued" || run.status === "waiting_for_session"}>
                                          <Button size="small" variant="ghost" icon="circle-x" data-action={`settings-automation-cancel-${run.id}`} disabled={busy() === `cancel:${run.id}`} onClick={() => cancelRun(task(), run)}>
                                            {language.t("settings.automation.action.cancel")}
                                          </Button>
                                        </Show>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </SettingsSection>
      </div>
    </SettingsPageShell>
  )
}

function formatTime(value: number | undefined, locale: string, timezone?: string) {
  if (value === undefined) return
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(value)
}

function scheduleLabel(schedule: AutomationSchedule, t: ReturnType<typeof useLanguage>["t"], locale: string, timezone?: string) {
  switch (schedule.kind) {
    case "once":
      return t("settings.automation.schedule.once", { time: formatTime(schedule.at, locale, timezone) ?? "" })
    case "interval":
      return t("settings.automation.schedule.interval", { value: formatDuration(schedule.everyMs, t) })
    case "hourly":
      return t("settings.automation.schedule.hourly", { minute: schedule.minute ?? 0 })
    case "daily":
      return t("settings.automation.schedule.daily", { hour: schedule.hour ?? 0, minute: schedule.minute ?? 0 })
    case "weekly":
      return t("settings.automation.schedule.weekly", {
        day: schedule.dayOfWeek ?? 0,
        hour: schedule.hour ?? 0,
        minute: schedule.minute ?? 0,
      })
    case "cron":
      return t("settings.automation.schedule.cron", { expression: schedule.expression })
  }
}

function formatDuration(value: number, t: ReturnType<typeof useLanguage>["t"]) {
  const minutes = Math.max(1, Math.round(value / 60_000))
  if (minutes % 1440 === 0) return t("settings.automation.duration.days", { value: minutes / 1440 })
  if (minutes % 60 === 0) return t("settings.automation.duration.hours", { value: minutes / 60 })
  return t("settings.automation.duration.minutes", { value: minutes })
}

function targetLabel(task: AutomationTask, t: ReturnType<typeof useLanguage>["t"]) {
  switch (task.target.kind) {
    case "session":
      return t("settings.automation.target.session", { id: task.target.sessionID })
    case "project":
      return t("settings.automation.target.project", { id: task.target.projectID })
    case "global":
      return t("settings.automation.target.global")
  }
}

function taskStatusLabel(task: AutomationTask, t: ReturnType<typeof useLanguage>["t"]) {
  if (!task.enabled && task.status === "active") return t("settings.automation.status.paused")
  return t(`settings.automation.status.${task.status}` as "settings.automation.status.active")
}

function runStatusLabel(run: AutomationRun, t: ReturnType<typeof useLanguage>["t"]) {
  return t(`settings.automation.status.run.${run.status}` as "settings.automation.status.run.queued")
}
