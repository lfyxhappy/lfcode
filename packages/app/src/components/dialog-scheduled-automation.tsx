import type {
  AutomationNotification,
  AutomationPermissionMode,
  AutomationSchedule,
  AutomationTarget,
  AutomationTaskCreate,
  AutomationTaskPatch,
} from "@lfcode-ai/sdk/v2/client"
import { Button } from "@lfcode-ai/ui/button"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { RadioGroup } from "@lfcode-ai/ui/radio-group"
import { Select } from "@lfcode-ai/ui/select"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { Match, Show, Switch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { ScheduledAutomationCreateRequest } from "@/automation/scheduled-task"
import {
  buildModel,
  defaultTimeZone,
  isValidTimeZone,
  localDateTimeInput,
  modelPatchValue,
  zonedDateTimeToTimestamp,
} from "@/automation/scheduled-task-form"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"

type ScheduleKind = AutomationSchedule["kind"]
type TargetKind = AutomationTarget["kind"]
type Translate = ReturnType<typeof useLanguage>["t"]

type ScheduleFormValues = {
  kind: ScheduleKind
  onceAt: string
  intervalMinutes: string
  intervalAnchorAt?: number
  hourlyMinute: string
  dailyHour: string
  dailyMinute: string
  weeklyDay: string
  weeklyHour: string
  weeklyMinute: string
  cron: string
}

export function DialogScheduledAutomation(props: ScheduledAutomationCreateRequest) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const target = props.task?.target ?? props.target ?? ({ kind: "global" } as const)
  const timezone = props.task?.timezone ?? defaultTimeZone()
  const schedule = scheduleFormValues(props.task?.schedule, timezone)
  const [form, setForm] = createStore({
    targetKind: target.kind,
    targetID: targetID(target),
    name: props.task?.name ?? props.name ?? "",
    message: props.task?.message ?? props.message ?? "",
    scheduleKind: schedule.kind,
    onceAt: schedule.onceAt,
    intervalMinutes: schedule.intervalMinutes,
    intervalAnchorAt: schedule.intervalAnchorAt,
    hourlyMinute: schedule.hourlyMinute,
    dailyHour: schedule.dailyHour,
    dailyMinute: schedule.dailyMinute,
    weeklyDay: schedule.weeklyDay,
    weeklyHour: schedule.weeklyHour,
    weeklyMinute: schedule.weeklyMinute,
    cron: schedule.cron,
    timezone,
    agent: props.task?.agent ?? "main",
    modelProviderID: props.task?.model?.providerID ?? "",
    modelID: props.task?.model?.modelID ?? "",
    permissionMode: props.task?.permissionMode ?? "full",
    notifications: props.task?.notifications ?? "all",
    saving: false,
    error: undefined as string | undefined,
  })

  const targetOptions = createMemo(() => [
    { value: "session" as const, label: language.t("settings.automation.dialog.target.session") },
    { value: "project" as const, label: language.t("settings.automation.dialog.target.project") },
    { value: "global" as const, label: language.t("settings.automation.dialog.target.global") },
  ])
  const scheduleOptions = createMemo(() => [
    { value: "once" as const, label: language.t("settings.automation.dialog.schedule.once") },
    { value: "hourly" as const, label: language.t("settings.automation.dialog.schedule.hourly") },
    { value: "daily" as const, label: language.t("settings.automation.dialog.schedule.daily") },
    { value: "weekly" as const, label: language.t("settings.automation.dialog.schedule.weekly") },
    { value: "interval" as const, label: language.t("settings.automation.dialog.schedule.interval") },
    { value: "cron" as const, label: language.t("settings.automation.dialog.schedule.cron") },
  ])
  const permissionOptions = createMemo(() => [
    { value: "full" as const, label: language.t("settings.automation.dialog.permission.full") },
    { value: "ask" as const, label: language.t("settings.automation.dialog.permission.ask") },
  ])
  const notificationOptions = createMemo(() => [
    { value: "all" as const, label: language.t("settings.automation.dialog.notifications.all") },
    { value: "failures" as const, label: language.t("settings.automation.dialog.notifications.failures") },
    { value: "none" as const, label: language.t("settings.automation.dialog.notifications.none") },
  ])
  const weekdayOptions = createMemo(() =>
    Array.from({ length: 7 }, (_, day) => ({
      value: String(day),
      label: new Intl.DateTimeFormat(language.intl(), { weekday: "long", timeZone: "UTC" }).format(
        new Date(Date.UTC(2024, 0, 7 + day)),
      ),
    })),
  )
  const editing = () => !!props.task
  const selectedTarget = createMemo(() => targetOptions().find((option) => option.value === form.targetKind))
  const selectedSchedule = createMemo(() => scheduleOptions().find((option) => option.value === form.scheduleKind))
  const selectedPermission = createMemo(() => permissionOptions().find((option) => option.value === form.permissionMode))
  const selectedNotifications = createMemo(() => notificationOptions().find((option) => option.value === form.notifications))
  const selectedWeekday = createMemo(() => weekdayOptions().find((option) => option.value === form.weeklyDay))

  const targetIDLabel = createMemo(() => {
    if (form.targetKind === "session") return language.t("settings.automation.dialog.target.session.id")
    if (form.targetKind === "project") return language.t("settings.automation.dialog.target.project.id")
    return ""
  })

  const schedulePreview = createMemo(() => {
    const timezone = form.timezone.trim() || defaultTimeZone()
    if (form.scheduleKind === "once") return oncePreview(form.onceAt, timezone, language.intl(), language.t)
    if (form.scheduleKind === "interval") {
      return language.t("settings.automation.dialog.preview.interval", { value: form.intervalMinutes || "-" })
    }
    if (form.scheduleKind === "hourly") {
      return language.t("settings.automation.dialog.preview.hourly", { value: form.hourlyMinute || "0" })
    }
    if (form.scheduleKind === "daily") {
      return language.t("settings.automation.dialog.preview.daily", {
        hour: padTime(form.dailyHour),
        minute: padTime(form.dailyMinute),
      })
    }
    if (form.scheduleKind === "weekly") {
      return language.t("settings.automation.dialog.preview.weekly", {
        day: selectedWeekday()?.label ?? "",
        hour: padTime(form.weeklyHour),
        minute: padTime(form.weeklyMinute),
      })
    }
    if (!form.cron.trim()) return language.t("settings.automation.dialog.preview.cron.empty")
    return language.t("settings.automation.dialog.preview.cron", { expression: form.cron.trim() })
  })

  const changeTarget = (next: TargetKind) => {
    setForm("targetKind", next)
    if (next === "global") {
      setForm("targetID", "")
      return
    }
    if (form.targetID) return
    if (next === "session" && props.sourceSessionID) setForm("targetID", props.sourceSessionID)
  }

  const save = async () => {
    if (form.saving) return
    const input = buildInput(form, props, language.t)
    if ("error" in input) {
      setForm("error", input.error)
      return
    }

    setForm("error", undefined)
    setForm("saving", true)
    try {
      if (props.task) {
        await globalSDK.client.global.automation.update({
          id: props.task.id,
          automationTaskPatch: input.patch,
        })
      } else {
        await globalSDK.client.global.automation.create({
          automationTaskCreate: input.create,
        })
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(props.task ? "settings.automation.dialog.toast.updated" : "settings.automation.dialog.toast.created"),
      })
      props.onSaved?.()
      dialog.close()
    } catch (error) {
      const message = formatServerError(error, language.t, language.t("common.requestFailed"))
      setForm("error", message)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setForm("saving", false)
    }
  }

  return (
    <Dialog
      title={
        <div class="text-16-medium text-text-strong">
          {language.t(editing() ? "settings.automation.dialog.edit.title" : "settings.automation.dialog.create.title")}
        </div>
      }
      description={<div class="text-13-regular text-text-weak">{language.t("settings.automation.dialog.description")}</div>}
      size="large"
      transition
    >
      <form
        class="flex max-h-[min(720px,calc(100vh-180px))] flex-col gap-5 overflow-y-auto px-1 pb-2"
        data-action="scheduled-automation-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        >
        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("settings.automation.target")}</label>
          <RadioGroup
            data-action="scheduled-automation-target"
            options={targetOptions()}
            current={selectedTarget()}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && changeTarget(option.value)}
            size="small"
            fill
          />
          <Show when={form.targetKind !== "global"}>
            <TextField
              label={targetIDLabel()}
              placeholder={
                form.targetKind === "session"
                  ? language.t("settings.automation.dialog.target.session.placeholder")
                  : language.t("settings.automation.dialog.target.project.placeholder")
              }
              value={form.targetID}
              onChange={(value) => setForm("targetID", value)}
              spellcheck={false}
              data-action="scheduled-automation-target-id"
            />
          </Show>
          <p class="text-12-regular text-text-weak">
            <Show when={form.targetKind === "session"}>{language.t("settings.automation.dialog.target.session.description")}</Show>
            <Show when={form.targetKind === "project"}>{language.t("settings.automation.dialog.target.project.description")}</Show>
            <Show when={form.targetKind === "global"}>{language.t("settings.automation.dialog.target.global.description")}</Show>
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <TextField
            autofocus
            label={language.t("settings.automation.dialog.name")}
            placeholder={language.t("settings.automation.dialog.name.placeholder")}
            value={form.name}
            onChange={(value) => setForm("name", value)}
            data-action="scheduled-automation-name"
          />
          <TextField
            label={language.t("settings.automation.dialog.timezone")}
            placeholder="Asia/Shanghai"
            value={form.timezone}
            onChange={(value) => setForm("timezone", value)}
            spellcheck={false}
            data-action="scheduled-automation-timezone"
          />
        </div>

        <TextField
          multiline
          label={language.t("settings.automation.dialog.message")}
          placeholder={language.t("settings.automation.dialog.message.placeholder")}
          value={form.message}
          onChange={(value) => setForm("message", value)}
          class="min-h-28 max-h-48 w-full overflow-y-auto"
          data-action="scheduled-automation-message"
        />

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("settings.automation.schedule")}</label>
          <Select
            data-action="scheduled-automation-schedule"
            options={scheduleOptions()}
            current={selectedSchedule()}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && setForm("scheduleKind", option.value)}
            variant="secondary"
            size="small"
          />
          <Switch>
            <Match when={form.scheduleKind === "once"}>
              <TextField
                type="datetime-local"
                label={language.t("settings.automation.dialog.once.at")}
                value={form.onceAt}
                onChange={(value) => setForm("onceAt", value)}
                data-action="scheduled-automation-once-at"
              />
            </Match>
            <Match when={form.scheduleKind === "interval"}>
              <TextField
                type="number"
                min="1"
                max={String(366 * 24 * 60)}
                inputMode="numeric"
                label={language.t("settings.automation.dialog.interval.minutes")}
                value={form.intervalMinutes}
                onChange={(value) => setForm("intervalMinutes", value)}
                data-action="scheduled-automation-interval-minutes"
              />
            </Match>
            <Match when={form.scheduleKind === "hourly"}>
              <TextField
                type="number"
                min="0"
                max="59"
                inputMode="numeric"
                label={language.t("settings.automation.dialog.hourly.minute")}
                value={form.hourlyMinute}
                onChange={(value) => setForm("hourlyMinute", value)}
                data-action="scheduled-automation-hourly-minute"
              />
            </Match>
            <Match when={form.scheduleKind === "daily"}>
              <div class="grid gap-4 sm:grid-cols-2">
                <TextField
                  type="number"
                  min="0"
                  max="23"
                  inputMode="numeric"
                  label={language.t("settings.automation.dialog.hour")}
                  value={form.dailyHour}
                  onChange={(value) => setForm("dailyHour", value)}
                  data-action="scheduled-automation-daily-hour"
                />
                <TextField
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  label={language.t("settings.automation.dialog.minute")}
                  value={form.dailyMinute}
                  onChange={(value) => setForm("dailyMinute", value)}
                  data-action="scheduled-automation-daily-minute"
                />
              </div>
            </Match>
            <Match when={form.scheduleKind === "weekly"}>
              <div class="grid gap-4 sm:grid-cols-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-12-medium text-text-weak">{language.t("settings.automation.dialog.weekday")}</label>
                  <Select
                    data-action="scheduled-automation-weekly-day"
                    options={weekdayOptions()}
                    current={selectedWeekday()}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) => option && setForm("weeklyDay", option.value)}
                    variant="secondary"
                    size="small"
                  />
                </div>
                <TextField
                  type="number"
                  min="0"
                  max="23"
                  inputMode="numeric"
                  label={language.t("settings.automation.dialog.hour")}
                  value={form.weeklyHour}
                  onChange={(value) => setForm("weeklyHour", value)}
                  data-action="scheduled-automation-weekly-hour"
                />
                <TextField
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  label={language.t("settings.automation.dialog.minute")}
                  value={form.weeklyMinute}
                  onChange={(value) => setForm("weeklyMinute", value)}
                  data-action="scheduled-automation-weekly-minute"
                />
              </div>
            </Match>
            <Match when={form.scheduleKind === "cron"}>
              <TextField
                label={language.t("settings.automation.dialog.cron")}
                placeholder="0 9 * * 1-5"
                value={form.cron}
                onChange={(value) => setForm("cron", value)}
                spellcheck={false}
                class="font-mono"
                data-action="scheduled-automation-cron"
              />
            </Match>
          </Switch>
          <p class="text-12-regular text-text-weak" data-action="scheduled-automation-preview">
            {schedulePreview()}
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <TextField
            label={language.t("settings.automation.dialog.agent")}
            placeholder="main"
            value={form.agent}
            onChange={(value) => setForm("agent", value)}
            spellcheck={false}
            data-action="scheduled-automation-agent"
          />
          <div class="flex flex-col gap-1.5">
            <label class="text-12-medium text-text-weak">{language.t("settings.automation.dialog.model")}</label>
            <span class="text-12-regular text-text-weak">{language.t("settings.automation.dialog.model.description")}</span>
          </div>
          <TextField
            label={language.t("settings.automation.dialog.provider")}
            placeholder="openai"
            value={form.modelProviderID}
            onChange={(value) => setForm("modelProviderID", value)}
            spellcheck={false}
            data-action="scheduled-automation-model-provider"
          />
          <TextField
            label={language.t("settings.automation.dialog.modelID")}
            placeholder="gpt-5.6"
            value={form.modelID}
            onChange={(value) => setForm("modelID", value)}
            spellcheck={false}
            data-action="scheduled-automation-model-id"
          />
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("settings.automation.dialog.permissions")}</label>
          <RadioGroup
            data-action="scheduled-automation-permission"
            options={permissionOptions()}
            current={selectedPermission()}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && setForm("permissionMode", option.value)}
            size="small"
            fill
          />
          <Show when={form.permissionMode === "full"}>
            <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-status-warning">
              {language.t("settings.automation.dialog.permission.warning")}
            </div>
          </Show>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("settings.automation.dialog.notifications")}</label>
          <RadioGroup
            data-action="scheduled-automation-notifications"
            options={notificationOptions()}
            current={selectedNotifications()}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && setForm("notifications", option.value)}
            size="small"
            fill
          />
        </div>

        <Show when={form.error}>{(error) => <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-status-warning">{error()}</div>}</Show>

        <div class="flex justify-end gap-2 border-t border-border-weak-base pt-4">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={form.saving} data-action="scheduled-automation-save">
            {form.saving
              ? language.t("common.saving")
              : language.t(editing() ? "settings.automation.dialog.save.edit" : "settings.automation.dialog.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function buildInput(
  form: {
    targetKind: TargetKind
    targetID: string
    name: string
    message: string
    scheduleKind: ScheduleKind
    onceAt: string
    intervalMinutes: string
    intervalAnchorAt?: number
    hourlyMinute: string
    dailyHour: string
    dailyMinute: string
    weeklyDay: string
    weeklyHour: string
    weeklyMinute: string
    cron: string
    timezone: string
    agent: string
    modelProviderID: string
    modelID: string
    permissionMode: AutomationPermissionMode
    notifications: AutomationNotification
  },
  props: ScheduledAutomationCreateRequest,
  t: Translate,
): { create: AutomationTaskCreate; patch: AutomationTaskPatch } | { error: string } {
  const message = form.message.trim()
  if (!message) return { error: t("settings.automation.dialog.error.message") }
  const name = form.name.trim()
  if (!name) return { error: t("settings.automation.dialog.error.name") }
  const timezone = form.timezone.trim()
  if (!isValidTimeZone(timezone)) return { error: t("settings.automation.dialog.error.timezone") }
  const target = buildTarget(form.targetKind, form.targetID)
  if (!target) {
    return { error: t(form.targetKind === "session" ? "settings.automation.dialog.error.sessionID" : "settings.automation.dialog.error.projectID") }
  }
  const schedule = buildSchedule(form, timezone)
  if (!schedule) return { error: scheduleError(form.scheduleKind, t) }
  const agent = form.agent.trim()
  if (!agent) return { error: t("settings.automation.dialog.error.agent") }
  const model = buildModel(form.modelProviderID, form.modelID)
  if (model === false) return { error: t("settings.automation.dialog.error.model") }
  const sourceSessionID = props.sourceSessionID ?? props.task?.sourceSessionID
  const common = {
    name,
    schedule,
    target,
    message,
    agent,
    permissionMode: form.permissionMode,
    timezone,
    notifications: form.notifications,
  }

  return {
    create: {
      ...common,
      ...(model ? { model } : {}),
      ...(sourceSessionID ? { sourceSessionID } : {}),
    },
    patch: {
      ...common,
      model: modelPatchValue(model),
      ...(sourceSessionID ? { sourceSessionID } : {}),
    },
  }
}

function buildTarget(kind: TargetKind, value: string): AutomationTarget | undefined {
  if (kind === "global") return { kind }
  const id = value.trim()
  if (!id) return
  if (kind === "session") return { kind, sessionID: id }
  return { kind, projectID: id }
}

export function buildSchedule(form: {
  scheduleKind: ScheduleKind
  onceAt: string
  intervalMinutes: string
  intervalAnchorAt?: number
  hourlyMinute: string
  dailyHour: string
  dailyMinute: string
  weeklyDay: string
  weeklyHour: string
  weeklyMinute: string
  cron: string
}, timezone: string): AutomationSchedule | undefined {
  if (form.scheduleKind === "once") {
    const at = zonedDateTimeToTimestamp(form.onceAt, timezone)
    if (at === undefined) return
    return { kind: "once", at }
  }
  if (form.scheduleKind === "interval") {
    const minutes = integerInRange(form.intervalMinutes, 1, 366 * 24 * 60)
    if (minutes === undefined) return
    return {
      kind: "interval",
      everyMs: minutes * 60_000,
      ...(form.intervalAnchorAt ? { anchorAt: form.intervalAnchorAt } : {}),
    }
  }
  if (form.scheduleKind === "hourly") {
    const minute = integerInRange(form.hourlyMinute, 0, 59)
    if (minute === undefined) return
    return { kind: "hourly", minute }
  }
  if (form.scheduleKind === "daily") {
    const hour = integerInRange(form.dailyHour, 0, 23)
    const minute = integerInRange(form.dailyMinute, 0, 59)
    if (hour === undefined || minute === undefined) return
    return { kind: "daily", hour, minute }
  }
  if (form.scheduleKind === "weekly") {
    const dayOfWeek = integerInRange(form.weeklyDay, 0, 6)
    const hour = integerInRange(form.weeklyHour, 0, 23)
    const minute = integerInRange(form.weeklyMinute, 0, 59)
    if (dayOfWeek === undefined || hour === undefined || minute === undefined) return
    return { kind: "weekly", dayOfWeek, hour, minute }
  }
  const expression = form.cron.trim()
  if (expression.split(/\s+/).length !== 5) return
  return { kind: "cron", expression }
}

function scheduleError(kind: ScheduleKind, t: Translate) {
  if (kind === "once") return t("settings.automation.dialog.error.schedule.once")
  if (kind === "interval") return t("settings.automation.dialog.error.schedule.interval")
  if (kind === "hourly") return t("settings.automation.dialog.error.schedule.hourly")
  if (kind === "daily") return t("settings.automation.dialog.error.schedule.daily")
  if (kind === "weekly") return t("settings.automation.dialog.error.schedule.weekly")
  return t("settings.automation.dialog.error.schedule.cron")
}

export function scheduleFormValues(schedule: AutomationSchedule | undefined, timezone = defaultTimeZone()): ScheduleFormValues {
  const defaults: ScheduleFormValues = {
    kind: "once",
    onceAt: localDateTimeInput(Date.now() + 60 * 60 * 1000, timezone),
    intervalMinutes: "60",
    hourlyMinute: "0",
    dailyHour: "9",
    dailyMinute: "0",
    weeklyDay: "1",
    weeklyHour: "9",
    weeklyMinute: "0",
    cron: "0 9 * * 1-5",
  }
  if (!schedule) return defaults
  if (schedule.kind === "once") return { ...defaults, kind: schedule.kind, onceAt: localDateTimeInput(schedule.at, timezone) }
  if (schedule.kind === "interval") {
    return {
      ...defaults,
      kind: schedule.kind,
      intervalMinutes: String(Math.max(1, Math.round(schedule.everyMs / 60_000))),
      intervalAnchorAt: schedule.anchorAt,
    }
  }
  if (schedule.kind === "hourly") return { ...defaults, kind: schedule.kind, hourlyMinute: String(schedule.minute ?? 0) }
  if (schedule.kind === "daily") {
    return {
      ...defaults,
      kind: schedule.kind,
      dailyHour: String(schedule.hour ?? 9),
      dailyMinute: String(schedule.minute ?? 0),
    }
  }
  if (schedule.kind === "weekly") {
    return {
      ...defaults,
      kind: schedule.kind,
      weeklyDay: String(schedule.dayOfWeek ?? 1),
      weeklyHour: String(schedule.hour ?? 9),
      weeklyMinute: String(schedule.minute ?? 0),
    }
  }
  return { ...defaults, kind: schedule.kind, cron: schedule.expression }
}

function targetID(target: AutomationTarget) {
  if (target.kind === "session") return target.sessionID
  if (target.kind === "project") return target.projectID
  return ""
}

function integerInRange(value: string, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return
  return parsed
}

function oncePreview(value: string, timezone: string, locale: string, t: Translate) {
  if (!isValidTimeZone(timezone)) return t("settings.automation.dialog.preview.timezone.invalid")
  const time = zonedDateTimeToTimestamp(value, timezone)
  if (time === undefined) return t("settings.automation.dialog.preview.once.invalid")
  return t("settings.automation.dialog.preview.once", {
    value: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(time),
  })
}

function padTime(value: string | number) {
  return String(value).padStart(2, "0")
}
