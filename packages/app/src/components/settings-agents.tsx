import { Button } from "@lfcode-ai/ui/button"
import { Switch } from "@lfcode-ai/ui/switch"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { SubagentAvatar } from "./session/subagent-card"
import {
  agentPresetContextFromSubagent,
  agentManageResponse,
  requestSubagentApi,
  subagentContextFromAgentPreset,
  type AgentManageConfig,
  type AgentManageItem,
  type AgentManageLayer,
} from "./subagent-api"
import {
  SUBAGENT_PRESETS,
  subagentPreset,
  subagentPresetContext,
  subagentPresetExecution,
  subagentPresetTitle,
  type SubagentContext,
  type SubagentExecution,
} from "./subagent-presets"
import { SettingsPageShell, SettingsSection } from "./settings-page-shell"

type Scope = "global" | "project"

export type AgentPermissionAction = "allow" | "ask" | "deny"
export type AgentPermissionRule = AgentPermissionAction | Record<string, AgentPermissionAction>
export type AgentPermissionConfig = Record<string, AgentPermissionRule>

export const DEFAULT_CUSTOM_AGENT_PERMISSION: AgentPermissionConfig = {
  "*": "deny",
  read: "allow",
  glob: "allow",
  grep: "allow",
  actor: "deny",
}

const permissionProfiles = [
  {
    id: "read-only",
    label: "subagent.settings.profile.readOnly",
    permission: DEFAULT_CUSTOM_AGENT_PERMISSION,
    tools: ["read", "glob", "grep"],
  },
  {
    id: "confirmed-write",
    label: "subagent.settings.profile.confirmedWrite",
    permission: {
      ...DEFAULT_CUSTOM_AGENT_PERMISSION,
      edit: "ask",
      shell: "ask",
    } satisfies AgentPermissionConfig,
    tools: ["read", "glob", "grep", "edit", "write", "apply_patch", "shell"],
  },
  {
    id: "research",
    label: "subagent.settings.profile.research",
    permission: {
      ...DEFAULT_CUSTOM_AGENT_PERMISSION,
      webfetch: "allow",
      websearch: "allow",
    } satisfies AgentPermissionConfig,
    tools: ["read", "glob", "grep", "webfetch", "websearch"],
  },
] as const

type AgentDraft = {
  id: string
  description: string
  prompt: string
  model: string
  disabled: boolean
  steps: string
  execution: SubagentExecution
  context: SubagentContext
  toolAllowlist: string
  delegationAllowlist: string
  permission: string
  native: boolean
}

type DispatchConfig = { backgroundConcurrency?: number }

const agentID = /^[a-z][a-z0-9_-]*$/

function record(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function permissionAction(input: unknown): input is AgentPermissionAction {
  return input === "allow" || input === "ask" || input === "deny"
}

function permissionRule(input: unknown): input is AgentPermissionRule {
  if (permissionAction(input)) return true
  const value = record(input)
  return !!value && Object.values(value).every(permissionAction)
}

function permissionFromRuleset(input: unknown[]) {
  return input.reduce<AgentPermissionConfig>((result, value) => {
    const rule = record(value)
    const permission = typeof rule?.permission === "string" ? rule.permission : undefined
    const pattern = typeof rule?.pattern === "string" ? rule.pattern : undefined
    const action = rule?.action
    if (!permission || !pattern || !permissionAction(action)) return result

    const current = result[permission]
    if (pattern === "*") {
      result[permission] = typeof current === "object" ? { ...current, "*": action } : action
      return result
    }

    result[permission] = {
      ...(typeof current === "object" ? current : permissionAction(current) ? { "*": current } : {}),
      [pattern]: action,
    }
    return result
  }, {})
}

export function agentPermissionConfig(input: unknown): AgentPermissionConfig | undefined {
  if (permissionAction(input)) return { "*": input }
  if (Array.isArray(input)) return permissionFromRuleset(input)
  const value = record(input)
  if (!value || !Object.values(value).every(permissionRule)) return
  return value as AgentPermissionConfig
}

export function agentPermissionText(input: unknown) {
  return JSON.stringify(agentPermissionConfig(input) ?? {}, null, 2)
}

export function parseAgentPermission(text: string) {
  const value = text.trim()
  if (!value) return {} satisfies AgentPermissionConfig
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return
    return agentPermissionConfig(parsed)
  } catch {
    return
  }
}

function defaultEntry(id: string): AgentManageItem {
  const preset = subagentPreset(id)
  return {
    id,
    name: id,
    description: preset?.description,
    native: !!preset,
    source: "native",
    config: {
      mode: "subagent",
      description: preset?.description,
      default_execution: subagentPresetExecution(id),
      default_context: agentPresetContextFromSubagent(subagentPresetContext(id)),
      tool_allowlist: preset?.toolAllowlist ?? [],
    },
  }
}

function mergeEntries(items: AgentManageItem[]) {
  const managed = new Map(items.map((item) => [item.id, item]))
  const builtIn = SUBAGENT_PRESETS.map((preset) => ({ ...defaultEntry(preset.id), ...managed.get(preset.id) }))
  const custom = items.filter((item) => !subagentPreset(item.id))
  return [...builtIn, ...custom]
}

export function agentLayerForScope(entry: AgentManageItem, scope: Scope, copy = false) {
  if (copy) return entry.effective ?? entry.nativeLayer
  if (scope === "global") return entry.global ?? entry.nativeLayer
  return entry.project ?? entry.global ?? entry.nativeLayer
}

export function agentDraftLayer(entry: AgentManageItem, scope: Scope, copy = false) {
  if (copy) return entry.effective ?? entry.nativeLayer
  const layers = (scope === "global"
    ? [entry.nativeLayer, entry.global]
    : [entry.nativeLayer, entry.global, entry.project]
  ).filter((layer): layer is AgentManageLayer => !!layer)
  if (layers.length === 0) return
  return {
    config: Object.assign({}, ...layers.map((layer) => layer.config)),
    prompt: layers[layers.length - 1].prompt,
  }
}

function draftFrom(entry: AgentManageItem, scope: Scope, copy = false): AgentDraft {
  const preset = subagentPreset(entry.id)
  const layer = agentDraftLayer(entry, scope, copy)
  const config = layer?.config ?? (entry.native && !entry.global && !entry.project ? entry.config : { mode: "subagent" })
  return {
    id: copy ? `${entry.id}-copy` : entry.id,
    description: config.description ?? entry.description ?? preset?.description ?? "",
    prompt: layer?.prompt ?? (entry.native && !entry.global && !entry.project ? entry.prompt ?? "" : ""),
    model: config.model ?? "",
    disabled: config.disable ?? false,
    steps: config.steps ? String(config.steps) : "",
    execution: config.default_execution ?? subagentPresetExecution(entry.id),
    context: subagentContextFromAgentPreset(config.default_context ?? agentPresetContextFromSubagent(subagentPresetContext(entry.id))),
    toolAllowlist: (config.tool_allowlist ?? preset?.toolAllowlist ?? []).join(", "),
    delegationAllowlist: (config.delegation_allowlist ?? []).join(", "),
    permission: agentPermissionText(config.permission),
    native: copy ? false : (entry.native ?? !!preset),
  }
}

function configFrom(draft: AgentDraft, permission: AgentPermissionConfig): AgentManageConfig {
  const steps = Number(draft.steps)
  return {
    mode: "subagent",
    description: draft.description.trim() || undefined,
    disable: draft.disabled,
    model: draft.model.trim() || undefined,
    steps: Number.isInteger(steps) && steps > 0 ? steps : undefined,
    default_execution: draft.execution,
    default_context: agentPresetContextFromSubagent(draft.context),
    tool_allowlist: draft.toolAllowlist
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    delegation_allowlist: draft.delegationAllowlist
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    permission: Object.keys(permission).length ? permission : undefined,
  }
}

function sourceLabel(item: AgentManageItem) {
  if (item.origins?.includes("project") || item.source === "project") return "subagent.settings.scope.project"
  if (item.origins?.includes("global") || item.source === "global") return "subagent.settings.scope.global"
  if (item.native) return "subagent.settings.native"
  return "subagent.settings.custom"
}

function originLabel(origin: string) {
  if (origin === "project") return "subagent.settings.scope.project"
  if (origin === "global") return "subagent.settings.scope.global"
  return "subagent.settings.native"
}

export function SettingsAgents() {
  const language = useLanguage()
  const server = useServer()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const connection = createMemo(() => ({
    base: server.current?.http.url,
    directory: directory() || undefined,
    username: server.current?.http.username,
    password: server.current?.http.password,
  }))
  const [scope, setScope] = createSignal<Scope>(directory() ? "project" : "global")
  const [revision, setRevision] = createSignal(0)
  const [selectedID, setSelectedID] = createSignal("general")
  const [draft, setDraft] = createSignal<AgentDraft>()
  const [busy, setBusy] = createSignal<"save" | "delete" | "concurrency">()

  createEffect(() => {
    if (directory()) return
    setScope("global")
  })

  const [managed, managedActions] = createResource(
    () => [connection().base, connection().directory, revision()] as const,
    async () =>
      agentManageResponse(
        await requestSubagentApi<unknown>({
          connection: connection(),
          path: "/agent/manage",
        }),
      ),
  )
  const [dispatchConfig, dispatchConfigActions] = createResource(
    () => [connection().base, connection().directory, revision()] as const,
    async () =>
      requestSubagentApi<DispatchConfig>({
        connection: connection(),
        path: "/actor-dispatch/config",
      }),
  )

  const entries = createMemo(() => mergeEntries(managed.latest?.items ?? []))
  const selected = createMemo(() => entries().find((item) => item.id === selectedID()))
  const selectedOrigins = createMemo(() => selected()?.origins ?? [])
  const selectedScopeLayer = createMemo(() => (scope() === "global" ? selected()?.global : selected()?.project))
  const concurrency = createMemo(() => Math.min(8, Math.max(1, dispatchConfig.latest?.backgroundConcurrency ?? 4)))

  createEffect(() => {
    const entry = selected()
    if (!entry || draft()) return
    setDraft(draftFrom(entry, scope()))
  })

  const fail = (error: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(error, language.t, language.t("common.requestFailed")),
    })

  const refresh = async () => {
    setRevision((value) => value + 1)
    await Promise.all([managedActions.refetch(), dispatchConfigActions.refetch()])
  }

  const select = (entry: AgentManageItem, copy = false) => {
    setSelectedID(copy ? "" : entry.id)
    setDraft(draftFrom(entry, scope(), copy))
  }

  const selectScope = (value: Scope) => {
    if (value === scope()) return
    setScope(value)
    const entry = selected()
    if (entry) setDraft(draftFrom(entry, value))
  }

  const create = () => {
    setSelectedID("")
    setDraft({
      id: "custom-agent",
      description: "",
      prompt: "",
      model: "",
      disabled: false,
      steps: "",
      execution: "background",
      context: "state",
      toolAllowlist: "read, glob, grep",
      delegationAllowlist: "",
      permission: agentPermissionText(DEFAULT_CUSTOM_AGENT_PERMISSION),
      native: false,
    })
  }

  const save = async () => {
    const value = draft()
    if (!value || busy()) return
    if (!agentID.test(value.id)) {
      showToast({ title: language.t("common.requestFailed"), description: language.t("subagent.settings.invalidId") })
      return
    }
    const permission = parseAgentPermission(value.permission)
    if (!permission) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("subagent.settings.invalidPermission"),
      })
      return
    }
    setBusy("save")
    try {
      await requestSubagentApi<unknown>({
        connection: connection(),
        path: `/agent/manage/${encodeURIComponent(value.id)}`,
        method: "PUT",
        body: {
          scope: scope(),
          config: configFrom(value, permission),
          prompt: value.prompt.trim() || undefined,
        },
      })
      setSelectedID(value.id)
      setDraft(undefined)
      await refresh()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (entry: AgentManageItem) => {
    if (busy()) return
    setBusy("delete")
    try {
      await requestSubagentApi<unknown>({
        connection: connection(),
        path: `/agent/manage/${encodeURIComponent(entry.id)}`,
        method: "DELETE",
        query: { scope: scope() },
      })
      setSelectedID("general")
      setDraft(undefined)
      await refresh()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(undefined)
    }
  }

  const setConcurrency = async (value: number) => {
    if (busy()) return
    setBusy("concurrency")
    try {
      await requestSubagentApi<unknown>({
        connection: connection(),
        path: "/actor-dispatch/config",
        method: "PUT",
        body: { backgroundConcurrency: value },
      })
      await dispatchConfigActions.refetch()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <SettingsPageShell title={language.t("subagent.settings.title")}>
      <SettingsSection
        title={language.t("subagent.settings.capacity.title")}
        description={language.t("subagent.settings.capacity.description")}
      >
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base px-4 py-3">
          <div>
            <div class="text-13-medium text-text-strong">{language.t("subagent.settings.concurrency")}</div>
            <div class="mt-1 text-12-regular text-text-weak">{language.t("subagent.settings.concurrency.description")}</div>
          </div>
          <select
            class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
            aria-label={language.t("subagent.settings.concurrency")}
            disabled={busy() === "concurrency"}
            value={concurrency()}
            onChange={(event) => void setConcurrency(Number(event.currentTarget.value))}
          >
            <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>{(value) => <option value={value}>{value}</option>}</For>
          </select>
        </div>
      </SettingsSection>

      <SettingsSection
        title={language.t("subagent.settings.library.title")}
        description={language.t("subagent.settings.library.description")}
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="inline-flex rounded-md border border-border-weak-base bg-surface-base p-0.5" role="group" aria-label={language.t("subagent.settings.scope")}>
            <button
              type="button"
              class={`rounded px-2 py-1 text-12-medium ${scope() === "global" ? "bg-surface-raised-stronger-non-alpha text-text-strong" : "text-text-weak hover:text-text-base"}`}
              aria-pressed={scope() === "global"}
              onClick={() => selectScope("global")}
            >
              {language.t("subagent.settings.scope.global")}
            </button>
            <button
              type="button"
              class={`rounded px-2 py-1 text-12-medium ${scope() === "project" ? "bg-surface-raised-stronger-non-alpha text-text-strong" : "text-text-weak hover:text-text-base"}`}
              aria-pressed={scope() === "project"}
              disabled={!directory()}
              onClick={() => selectScope("project")}
            >
              {language.t("subagent.settings.scope.project")}
            </button>
          </div>
          <div class="flex items-center gap-2">
            <Button size="small" variant="secondary" onClick={() => void refresh()} disabled={managed.loading}>
              {language.t("subagent.settings.refresh")}
            </Button>
            <Button size="small" variant="primary" icon="plus-small" onClick={create}>
              {language.t("subagent.settings.create")}
            </Button>
          </div>
        </div>

        <div class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
          <div class="overflow-hidden rounded-lg border border-border-weak-base bg-surface-base">
            <Show when={!managed.loading} fallback={<div class="px-4 py-8 text-13-regular text-text-weak">{language.t("subagent.settings.loading")}</div>}>
              <For each={entries()}>
                {(entry) => {
                  const preset = () => subagentPreset(entry.id)
                  return (
                    <button
                      type="button"
                      class={`flex w-full items-center gap-3 border-b border-border-weak-base px-3 py-3 text-left last:border-none hover:bg-surface-raised-base-hover ${selectedID() === entry.id ? "bg-surface-raised-base-hover" : ""}`}
                      onClick={() => select(entry)}
                    >
                      <SubagentAvatar sessionID="preset-library" actorID={entry.id} agent={entry.id} size="medium" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-13-medium text-text-strong">{preset()?.title ?? entry.name ?? entry.id}</span>
                        <span class="mt-0.5 block truncate text-12-regular text-text-weak">{entry.config.description ?? entry.description ?? preset()?.description}</span>
                        <span class="mt-1 block text-11-regular text-text-weaker">
                          {language.t(sourceLabel(entry))} · {language.t(
                            (entry.config.default_execution ?? subagentPresetExecution(entry.id)) === "wait"
                              ? "subagent.execution.wait"
                              : "subagent.execution.background",
                          )}
                        </span>
                      </span>
                      <span class={`size-2 shrink-0 rounded-full ${entry.config.disable ? "bg-icon-weak-base" : "bg-icon-interactive-base"}`} />
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>

          <Show
            when={draft()}
            fallback={<div class="rounded-lg border border-dashed border-border-weak-base px-4 py-8 text-13-regular text-text-weak">{language.t("subagent.settings.select")}</div>}
          >
            {(value) => (
              <form
                class="rounded-lg border border-border-weak-base bg-surface-base p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-14-medium text-text-strong">{value().native ? subagentPresetTitle(value().id) : language.t("subagent.settings.custom")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">{language.t("subagent.settings.minimum")}</div>
                    <Show when={selectedOrigins().length > 0 ? selectedOrigins() : undefined}>
                      {(origins) => (
                        <div class="mt-1 text-11-regular text-text-weaker">
                          {language.t("subagent.settings.inheritance", {
                            origins: origins().map(originLabel).map((origin) => language.t(origin)).join(" → "),
                          })}
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class={`text-11-medium ${value().disabled ? "text-status-warning" : "text-status-success"}`}>
                      {value().disabled ? language.t("subagent.settings.disabled") : language.t("subagent.settings.enabled")}
                    </div>
                    <Switch
                      data-action="settings-agent-disable"
                      checked={value().disabled}
                      onChange={(checked) => setDraft({ ...value(), disabled: checked })}
                      hideLabel
                    >
                      {language.t("subagent.settings.disable")}
                    </Switch>
                  </div>
                </div>

                <div class="mt-2 text-11-regular text-text-weaker">{language.t("subagent.settings.disable.description")}</div>

                <label class="mt-4 block text-12-medium text-text-weak">
                  {language.t("subagent.settings.id")}
                  <input
                    class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base disabled:opacity-60"
                    value={value().id}
                    disabled={value().native}
                    onInput={(event) => setDraft({ ...value(), id: event.currentTarget.value.toLowerCase() })}
                  />
                </label>

                <label class="mt-3 block text-12-medium text-text-weak">
                  {language.t("subagent.settings.description")}
                  <input
                    class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                    value={value().description}
                    onInput={(event) => setDraft({ ...value(), description: event.currentTarget.value })}
                  />
                </label>

                <label class="mt-3 block text-12-medium text-text-weak">
                  {language.t("subagent.settings.prompt")}
                  <textarea
                    class="mt-1 min-h-24 w-full resize-y rounded-md border border-border-weak-base bg-background-base px-2 py-2 text-13-regular text-text-base"
                    value={value().prompt}
                    onInput={(event) => setDraft({ ...value(), prompt: event.currentTarget.value })}
                  />
                </label>

                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                  <label class="text-12-medium text-text-weak">
                    {language.t("subagent.settings.execution")}
                    <select
                      class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                      value={value().execution}
                      onChange={(event) => setDraft({ ...value(), execution: event.currentTarget.value as SubagentExecution })}
                    >
                      <option value="wait">{language.t("subagent.settings.execution.wait")}</option>
                      <option value="background">{language.t("subagent.settings.execution.background")}</option>
                    </select>
                  </label>
                  <label class="text-12-medium text-text-weak">
                    {language.t("subagent.settings.context")}
                    <select
                      class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                      value={value().context}
                      onChange={(event) => setDraft({ ...value(), context: event.currentTarget.value as SubagentContext })}
                    >
                      <option value="state">{language.t("subagent.settings.context.minimal")}</option>
                      <option value="full">{language.t("subagent.settings.context.full")}</option>
                      <option value="none">{language.t("subagent.settings.context.task")}</option>
                    </select>
                  </label>
                </div>

                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                  <label class="text-12-medium text-text-weak">
                    {language.t("subagent.settings.model")}
                    <input
                      class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                      placeholder={language.t("subagent.settings.model.placeholder")}
                      value={value().model}
                      onInput={(event) => setDraft({ ...value(), model: event.currentTarget.value })}
                    />
                  </label>
                  <label class="text-12-medium text-text-weak">
                    {language.t("subagent.settings.steps")}
                    <input
                      inputMode="numeric"
                      class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                      placeholder={language.t("subagent.settings.steps.placeholder")}
                      value={value().steps}
                      onInput={(event) => setDraft({ ...value(), steps: event.currentTarget.value.replace(/[^0-9]/g, "") })}
                    />
                  </label>
                </div>

                <label class="mt-3 block text-12-medium text-text-weak">
                  {language.t("subagent.settings.tools")}
                  <input
                    class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                    value={value().toolAllowlist}
                    onInput={(event) => setDraft({ ...value(), toolAllowlist: event.currentTarget.value })}
                  />
                  <span class="mt-1 block text-11-regular text-text-weaker">{language.t("subagent.settings.tools.description")}</span>
                </label>

                <label class="mt-3 block text-12-medium text-text-weak">
                  {language.t("subagent.settings.delegation")}
                  <input
                    class="mt-1 h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base"
                    placeholder={language.t("subagent.settings.delegation.placeholder")}
                    value={value().delegationAllowlist}
                    onInput={(event) => setDraft({ ...value(), delegationAllowlist: event.currentTarget.value })}
                  />
                  <span class="mt-1 block text-11-regular text-text-weaker">{language.t("subagent.settings.delegation.description")}</span>
                </label>

                <fieldset class="mt-3 min-w-0" data-action="settings-agent-permission">
                  <legend class="text-12-medium text-text-weak">{language.t("subagent.settings.permissions")}</legend>
                  <div class="mt-1 text-11-regular text-text-weaker">{language.t("subagent.settings.permissions.description")}</div>
                  <div class="mt-2 flex flex-wrap gap-2" aria-label={language.t("subagent.settings.permissionProfiles")}>
                    <For each={permissionProfiles}>
                      {(profile) => (
                        <Button
                          size="small"
                          variant="secondary"
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...value(),
                              permission: agentPermissionText(profile.permission),
                              toolAllowlist: profile.tools.join(", "),
                            })
                          }
                        >
                          {profile.label}
                        </Button>
                      )}
                    </For>
                  </div>
                  <textarea
                    aria-label={language.t("subagent.settings.permissionJson")}
                    class="mt-2 min-h-32 w-full resize-y rounded-md border border-border-weak-base bg-background-base px-2 py-2 font-mono text-12-regular text-text-base"
                    spellcheck={false}
                    value={value().permission}
                    onInput={(event) => setDraft({ ...value(), permission: event.currentTarget.value })}
                  />
                  <span class="mt-1 block text-11-regular text-text-weaker">
                    {language.t("subagent.settings.permissionExample", {
                      example: `{"*":"deny","read":"allow","edit":"ask","actor":"deny"}`,
                      pathExample: `{"edit":{"*.md":"allow"}}`,
                    })}
                  </span>
                </fieldset>

                <div class="mt-4 flex flex-wrap justify-between gap-2">
                  <div class="flex gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      type="button"
                      disabled={!selected()}
                      onClick={() => {
                        const entry = selected()
                        if (entry) select(entry, true)
                      }}
                    >
                      {language.t("subagent.settings.copy")}
                    </Button>
                    <Show when={selectedScopeLayer()}>
                      <Button size="small" variant="secondary" type="button" disabled={busy() === "delete"} onClick={() => void remove(selected() ?? defaultEntry(value().id))}>
                        {value().native ? language.t("subagent.settings.restore") : language.t("subagent.settings.delete")}
                      </Button>
                    </Show>
                  </div>
                  <div class="flex gap-2">
                    <Button size="small" variant="secondary" type="button" onClick={() => setDraft(undefined)}>
                      {language.t("subagent.settings.cancel")}
                    </Button>
                    <Button size="small" variant="primary" type="submit" disabled={busy() === "save"}>
                      {busy() === "save" ? language.t("subagent.settings.saving") : language.t("subagent.settings.save")}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </Show>
        </div>
      </SettingsSection>
    </SettingsPageShell>
  )
}
