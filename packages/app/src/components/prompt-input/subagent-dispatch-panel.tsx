import { Button } from "@lfcode-ai/ui/button"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { showToast } from "@lfcode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { parseSubagentDeclaredFiles, subagentDispatchDescription } from "./subagent-dispatch-state"
import {
  agentManageResponse,
  actorDispatches,
  requestSubagentApi,
  subagentContextFromAgentPreset,
  type AgentManageItem,
  type SubagentApiConnection,
} from "../subagent-api"
import {
  SUBAGENT_PRESETS,
  subagentPreset,
  subagentPresetContext,
  subagentPresetExecution,
  type SubagentContext,
  type SubagentExecution,
} from "../subagent-presets"

export type SubagentDispatchModel = {
  providerID: string
  modelID: string
  label: string
}

export type SubagentDispatchInput = {
  agent: string
  task: string
  execution: SubagentExecution
  context: SubagentContext
  model?: { providerID: string; modelID: string }
  contextRefs: string[]
  declaredFiles: string[]
}

type DispatchAgent = {
  id: string
  title: string
  description: string
  execution: SubagentExecution
  context: SubagentContext
  toolAllowlist: string[]
}

const writeTools = new Set(["edit", "apply_patch", "bash", "write"])

function nativeAgent(preset: (typeof SUBAGENT_PRESETS)[number]): DispatchAgent {
  return {
    id: preset.id,
    title: preset.title,
    description: preset.description,
    execution: preset.execution,
    context: preset.context,
    toolAllowlist: preset.toolAllowlist,
  }
}

function dispatchAgents(entries: AgentManageItem[], customDescription = "Custom subagent") {
  const managed = new Map(entries.map((item) => [item.id, item]))
  const native = SUBAGENT_PRESETS.flatMap((preset) => {
    const item = managed.get(preset.id)
    if (item?.config.disable || item?.config.hidden || (item?.config.mode && item.config.mode !== "subagent")) return []
    return [
      {
        ...nativeAgent(preset),
        description: item?.config.description ?? item?.description ?? preset.description,
        execution: item?.config.default_execution ?? preset.execution,
        context: item?.config.default_context
          ? subagentContextFromAgentPreset(item.config.default_context)
          : preset.context,
        toolAllowlist: item?.config.tool_allowlist ?? preset.toolAllowlist,
      },
    ]
  })
  const custom = entries.flatMap((item): DispatchAgent[] => {
    if (subagentPreset(item.id)) return []
    if (item.config.disable || item.config.hidden || (item.config.mode && item.config.mode !== "subagent")) return []
    return [
      {
        id: item.id,
        title: item.name ?? item.id,
        description: item.config.description ?? item.description ?? customDescription,
        execution: item.config.default_execution ?? "background",
        context: subagentContextFromAgentPreset(item.config.default_context),
        toolAllowlist: item.config.tool_allowlist ?? ["read", "glob", "grep"],
      },
    ]
  })
  return [...native, ...custom]
}

function modelKey(model: { providerID: string; modelID: string }) {
  return `${model.providerID}\u0000${model.modelID}`
}

function modelFromKey(value: string) {
  const [providerID, modelID] = value.split("\u0000")
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

export const PromptSubagentDispatchPanel: Component<{
  sessionID: string
  connection: SubagentApiConnection
  primaryAgent?: string
  primaryModel?: { providerID: string; modelID: string }
  task?: string
  contextRefs: string[]
  declaredFiles: string[]
  models: SubagentDispatchModel[]
  onClose: VoidFunction
  onDispatched: VoidFunction
}> = (props) => {
  const language = useLanguage()
  const [saving, setSaving] = createSignal(false)
  const [draft, setDraft] = createStore({
    agent: "general",
    task: props.task?.trim() ?? "",
    execution: subagentPresetExecution("general"),
    context: subagentPresetContext("general") as SubagentContext,
    model: "",
    files: [...new Set([...props.contextRefs, ...props.declaredFiles])].join("\n"),
  })
  const [managed] = createResource(
    () => (props.connection.base ? `${props.connection.base}\n${props.connection.directory ?? ""}` : undefined),
    async () =>
      agentManageResponse(
        await requestSubagentApi<unknown>({
          connection: props.connection,
          path: "/agent/manage",
        }),
      ),
  )
  const agents = createMemo(() => dispatchAgents(managed.latest?.items ?? [], language.t("subagent.dispatch.custom")))
  const [dispatches] = createResource(
    () => (props.connection.base ? `${props.connection.base}\n${props.connection.directory ?? ""}\n${props.sessionID}` : undefined),
    async () =>
      actorDispatches(
        await requestSubagentApi<unknown>({
          connection: props.connection,
          path: "/actor-dispatch",
          query: { sessionID: props.sessionID },
        }),
      ),
  )
  const selectedAgent = createMemo(() => agents().find((item) => item.id === draft.agent) ?? agents()[0])
  const files = createMemo(() => parseSubagentDeclaredFiles(draft.files))
  const writeAccess = createMemo(() => selectedAgent()?.toolAllowlist.some((tool) => writeTools.has(tool)) ?? false)
  const queuedPosition = createMemo(
    () => (dispatches.latest ?? []).filter((dispatch) => dispatch.status === "queued").length + 1,
  )

  createEffect(() => {
    const available = agents()
    if (available.some((item) => item.id === draft.agent)) return
    const first = available[0]
    if (!first) return
    setDraft("agent", first.id)
    setDraft("execution", first.execution)
    setDraft("context", first.context)
  })

  const selectAgent = (id: string) => {
    const next = agents().find((item) => item.id === id)
    if (!next) return
    setDraft("agent", id)
    setDraft("execution", next.execution)
    setDraft("context", next.context)
  }

  const submit = async () => {
    const selected = selectedAgent()
    const task = draft.task.trim()
    if (!selected || !task || saving()) return
    setSaving(true)
    try {
      const override = modelFromKey(draft.model)
      const input: SubagentDispatchInput = {
        agent: selected.id,
        task,
        execution: draft.execution,
        context: draft.context,
        ...(override ? { model: override } : {}),
        contextRefs: draft.context === "none" ? [] : files(),
        declaredFiles: files(),
      }
      await requestSubagentApi<unknown>({
        connection: props.connection,
        path: `/session/${encodeURIComponent(props.sessionID)}/prompt_async`,
        method: "POST",
        body: {
          ...(props.primaryAgent ? { agent: props.primaryAgent } : {}),
          ...(props.primaryModel ? { model: props.primaryModel } : {}),
          parts: [
            {
              type: "subtask",
              prompt: input.task,
              description: subagentDispatchDescription(input.task),
              agent: input.agent,
              execution: input.execution,
              context: input.context,
              ...(input.model ? { model: input.model } : {}),
              contextRefs: input.contextRefs,
              declaredFiles: input.declaredFiles,
            },
          ],
        },
      })
      showToast({
        variant: "success",
        title: language.t("subagent.dispatch.toast.title"),
        description:
          input.execution === "background"
            ? language.t("subagent.dispatch.toast.background")
            : language.t("subagent.dispatch.toast.wait"),
      })
      props.onDispatched()
      props.onClose()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={language.t("subagent.dispatch.title")} class="w-[min(680px,calc(100vw-2rem))] max-w-none" fit>
      <div data-component="subagent-dispatch-panel" class="flex max-h-[min(720px,calc(100vh-8rem))] flex-col gap-4 overflow-y-auto px-6 pb-4">
        <label class="flex min-w-0 flex-col gap-1.5">
          <span class="text-13-medium text-text-base">{language.t("subagent.dispatch.role")}</span>
          <select
            class="h-9 rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base outline-none"
            aria-label={language.t("subagent.dispatch.role.select")}
            value={draft.agent}
            onChange={(event) => selectAgent(event.currentTarget.value)}
          >
            <For each={agents()}>
              {(agent) => <option value={agent.id}>{agent.title}</option>}
            </For>
          </select>
          <Show when={selectedAgent()}>
            {(agent) => <span class="text-12-regular text-text-weak">{agent().description}</span>}
          </Show>
        </label>

        <label class="flex min-w-0 flex-col gap-1.5">
          <span class="text-13-medium text-text-base">{language.t("subagent.dispatch.task")}</span>
          <textarea
            class="min-h-[132px] w-full resize-y rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-strong outline-none"
            value={draft.task}
            autofocus
            placeholder={language.t("subagent.dispatch.task.placeholder")}
            onInput={(event) => setDraft("task", event.currentTarget.value)}
          />
        </label>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class="text-13-medium text-text-base">{language.t("subagent.dispatch.execution")}</span>
            <select
              class="h-9 rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base outline-none"
              aria-label={language.t("subagent.dispatch.execution")}
              value={draft.execution}
              onChange={(event) => setDraft("execution", event.currentTarget.value as SubagentExecution)}
            >
              <option value="wait">{language.t("subagent.dispatch.execution.wait")}</option>
              <option value="background">{language.t("subagent.dispatch.execution.background")}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class="text-13-medium text-text-base">{language.t("subagent.dispatch.context")}</span>
            <select
              class="h-9 rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base outline-none"
              aria-label={language.t("subagent.dispatch.context")}
              value={draft.context}
              onChange={(event) => setDraft("context", event.currentTarget.value as SubagentContext)}
            >
              <option value="state">{language.t("subagent.dispatch.context.minimal")}</option>
              <option value="full">{language.t("subagent.dispatch.context.full")}</option>
              <option value="none">{language.t("subagent.dispatch.context.task")}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class="text-13-medium text-text-base">{language.t("subagent.dispatch.model")}</span>
            <select
              class="h-9 rounded-md border border-border-weak-base bg-background-base px-2 text-13-regular text-text-base outline-none"
              aria-label={language.t("subagent.dispatch.model.override")}
              value={draft.model}
              onChange={(event) => setDraft("model", event.currentTarget.value)}
            >
              <option value="">{language.t("subagent.dispatch.model.inherit")}</option>
              <For each={props.models}>{(model) => <option value={modelKey(model)}>{model.label}</option>}</For>
            </select>
          </label>
        </div>

        <label class="flex min-w-0 flex-col gap-1.5">
          <span class="text-13-medium text-text-base">{language.t("subagent.dispatch.files")}</span>
          <textarea
            class="min-h-[76px] w-full resize-y rounded-md border border-border-weak-base bg-background-base px-3 py-2 font-mono text-12-regular text-text-strong outline-none"
            value={draft.files}
            placeholder={language.t("subagent.dispatch.files.placeholder")}
            onInput={(event) => setDraft("files", event.currentTarget.value)}
          />
          <span class="text-12-regular text-text-weak">
            {draft.context === "none"
              ? language.t("subagent.dispatch.files.taskOnly")
              : language.t("subagent.dispatch.files.attached")}
          </span>
        </label>

        <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
          <Show when={draft.execution === "background"} fallback={<span>{language.t("subagent.dispatch.queue.wait")}</span>}>
            <span>{language.t("subagent.dispatch.queue.background", { position: queuedPosition() })}</span>
          </Show>
          <Show when={writeAccess()}>
            <span class="mt-1 block text-status-warning">{language.t("subagent.dispatch.queue.conflict")}</span>
          </Show>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="large" disabled={saving()} onClick={props.onClose}>
            {language.t("subagent.dispatch.action.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={!draft.task.trim() || !selectedAgent() || saving()} onClick={() => void submit()}>
            {saving() ? language.t("subagent.dispatch.action.submitting") : language.t("subagent.dispatch.action.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
