import { PlanExitTool } from "./plan"
import { Session } from "../session"
import { QuestionTool } from "./question"
import { BashTool, ShellTool } from "./bash"
import { EditTool } from "./edit"
import { HistoryTool } from "./history"
import { MemoryTool } from "./memory"
import { ReadTool } from "./read"
import { ActorTool } from "./actor"
import { TaskTool } from "./task"
import { CreateGoalTool } from "./create_goal"
import { GetGoalTool } from "./get_goal"
import { UpdateGoalTool } from "./update_goal"
import { WebFetchTool } from "./webfetch"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { SkillManageTool } from "./skill_manage"
import { HookManageTool } from "./hook_manage"
import { McpManageTool } from "./mcp_manage"
import { ProviderManageTool } from "./provider_manage"
import { CredentialManageTool } from "./credential_manage"
import { ContextBrokerTool } from "./context_broker"
import { CapabilityManageTool } from "./capability_manage"
import * as Tool from "./tool"
import { Config } from "../config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@lfcode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "../provider"
import * as ProviderTransform from "../provider/transform"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ChangeDirectoryTool } from "./change-directory"
import { Glob } from "@lfcode-ai/shared/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { Goal } from "../session/goal"
import { LSP } from "../lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { ActorRegistry } from "@/actor/registry"
import { ActorWaiter } from "@/actor/waiter"
import { Team } from "@/team"
import { Memory } from "@/memory"
import { History } from "@/history"
import { SessionCheckpoint } from "@/session/checkpoint"
import { TaskRegistry } from "@/task/registry"
import { Auth } from "@/auth"
import { shellWrap } from "./shell-wrap"
import * as BashInteractive from "./bash-interactive"
import { resolveInvocationStyle } from "./invocation-style"
import { FileInfoTool } from "./file_info"
import { TreeTool } from "./tree"
import { SearchTool } from "./search"
import { ArchiveInspectTool } from "./archive_inspect"
import { EditHistoryTool } from "./edit_history"
import { AppGetStateTool } from "./app_get_state"
import { AppEditorActionTool } from "./app_editor_action"
import { AppEditorQueryTool } from "./app_editor_query"
import { AppFiletabQueryTool } from "./app_filetab_query"
import { AppUiActionTool } from "./app_ui_action"
import { AppUiQueryTool } from "./app_ui_query"
import { AppDomTool } from "./app_dom"
import { AppListWindowsTool } from "./app_list_windows"
import { AppGetEventsTool } from "./app_get_events"
import { AppGetAutomationStatusTool } from "./app_get_automation_status"
import { AppWaitForEventTool } from "./app_wait_for_event"
import { AppGetConsoleTool } from "./app_get_console"
import { AppGetNetworkTool } from "./app_get_network"
import { AppCaptureWindowTool } from "./app_capture_window"
import { AppCaptureDiagnosticsBundleTool } from "./app_capture_diagnostics_bundle"
import { AppOpenBrowserTool } from "./app_open_browser"
import { AppOpenRouteTool } from "./app_open_route"
import { AppOpenSessionTool } from "./app_open_session"
import { AppOpenSideChatTool } from "./app_open_side_chat"
import { AppFocusSideChatTool } from "./app_focus_side_chat"
import { AppCloseSideChatTool } from "./app_close_side_chat"
import { AppFiletabActionTool } from "./app_filetab_action"
import { AppReadBrowserPageTool } from "./app_read_browser_page"
import { AppBrowserSnapshotTool } from "./app_browser_snapshot"
import { AppBrowserScreenshotTool } from "./app_browser_screenshot"
import { AppBrowserExtractResourceTool } from "./app_browser_extract_resource"
import { AppBrowserListCachedResourcesTool } from "./app_browser_list_cached_resources"
import { AppBrowserDownloadResourceTool } from "./app_browser_download_resource"
import { AppFocusBrowserTabTool } from "./app_focus_browser_tab"
import { AppBrowserClickTool } from "./app_browser_click"
import { AppBrowserScrollTool } from "./app_browser_scroll"
import { AppBrowserTypeTool } from "./app_browser_type"
import { AppBrowserWaitTool } from "./app_browser_wait"
import { AppSetInputTool } from "./app_set_input"
import { AppAppendInputTool } from "./app_append_input"
import { AppSendTool } from "./app_send"
import { AppWaitForStateTool } from "./app_wait_for_state"
import { AppCloseBrowserTabTool } from "./app_close_browser_tab"
import { BrowserTool } from "./browser"
import { AppControlTool, AppControlToolID } from "./app_control"
import { CppTool } from "./cpp"
import { File } from "@/file"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { PipTool } from "./pip"
import { PythonTool } from "./python"
import { RuntimeManageTool } from "./runtime_manage"
import { ShellProcessTool } from "./background_job"
import { OfficeTool } from "./office"
import { ToolOutputTool } from "./tool_output"
import { PluginAuthorTool } from "./plugin_author"
import { PluginManageTool } from "./plugin_manage"
import { appControlPermissionRank } from "@/app-control/client"

const log = Log.create({ service: "tool.registry" })

const browserToolIDs = new Set<string>([
  AppGetConsoleTool.id,
  AppGetNetworkTool.id,
  AppOpenBrowserTool.id,
  AppBrowserSnapshotTool.id,
  AppReadBrowserPageTool.id,
  AppBrowserScreenshotTool.id,
  AppBrowserListCachedResourcesTool.id,
  AppBrowserExtractResourceTool.id,
  AppBrowserDownloadResourceTool.id,
  AppFocusBrowserTabTool.id,
  AppBrowserClickTool.id,
  AppBrowserScrollTool.id,
  AppBrowserTypeTool.id,
  AppBrowserWaitTool.id,
  AppCloseBrowserTabTool.id,
])

const appReadToolIDs = new Set<string>([
  AppGetStateTool.id,
  AppEditorQueryTool.id,
  AppFiletabQueryTool.id,
  AppUiQueryTool.id,
  AppListWindowsTool.id,
  AppGetEventsTool.id,
  AppGetAutomationStatusTool.id,
  AppWaitForEventTool.id,
  AppCaptureWindowTool.id,
  AppCaptureDiagnosticsBundleTool.id,
  AppWaitForStateTool.id,
])

const appSessionToolIDs = new Set<string>([
  AppOpenRouteTool.id,
  AppOpenSessionTool.id,
  AppOpenSideChatTool.id,
  AppFocusSideChatTool.id,
  AppCloseSideChatTool.id,
  AppFiletabActionTool.id,
  AppUiActionTool.id,
  AppEditorActionTool.id,
  AppSetInputTool.id,
  AppAppendInputTool.id,
  AppSendTool.id,
])

const legacyAppToolIDs = new Set<string>([...appReadToolIDs, ...appSessionToolIDs, AppDomTool.id])

const managementToolIDs = new Set<string>([
  "plugin_author",
  "plugin_manage",
  "skill_manage",
  "hook_manage",
  "mcp_manage",
  "provider_manage",
  "credential_manage",
  "context_broker",
  "capability_manage",
])

const onDemandRuntimeToolIDs = new Set([
  PipTool.id,
  PythonTool.id,
  CppTool.id,
  RuntimeManageTool.id,
  OfficeTool.id,
])

const extensionSearchParameters = z.object({
  query: z.string().min(1).describe("A tool name or keyword to search for."),
  limit: z.coerce.number().int().min(1).max(20).optional().describe("Maximum number of matching tools to return."),
})

const extensionUseParameters = z.object({
  name: z.string().min(1).describe("Exact tool name returned by search_tool."),
  arguments: z.record(z.string(), z.unknown()).default({}).describe("Arguments for the selected extension tool."),
})

function extensionMatches(tools: Tool.Def[], query: string, limit = 10) {
  const needle = query.trim().toLowerCase()
  return tools
    .filter((tool) => !tool.activationSkill)
    .map((tool) => ({
      tool,
      score: `${tool.id} ${tool.description}`.toLowerCase().includes(needle) ? 0 : 1,
    }))
    .filter((item) => item.score === 0)
    .slice(0, limit)
    .map(({ tool }) => ({
      name: tool.id,
      description: tool.description,
      metadata: Tool.definitionMetadata(tool),
    }))
}

export function extensionToolIsActive(tool: Pick<Tool.Def, "activationSkill">, activeSkills: ReadonlySet<string>) {
  return !tool.activationSkill || activeSkills.has(tool.activationSkill)
}

const fallbackWarned = new Set<string>()
function warnShellFallbackOnce(id: string) {
  if (fallbackWarned.has(id)) return
  fallbackWarned.add(id)
  log.warn(`tool '${id}' configured with invocation_style='shell' but has no shell field; falling back to JSON`)
}

const toolSchemaCache = new WeakMap<z.ZodType, Map<string, JSONSchema7>>()

export function transformedToolSchema(model: Provider.Model, parameters: z.ZodType): JSONSchema7 {
  const key = `${model.providerID}\0${model.api.id}\0${model.api.npm}`
  const cached = toolSchemaCache.get(parameters)?.get(key)
  if (cached) return cached

  const transformed = ProviderTransform.schema(model, z.toJSONSchema(parameters))
  const perParameters = toolSchemaCache.get(parameters) ?? new Map<string, JSONSchema7>()
  perParameters.set(key, transformed)
  toolSchemaCache.set(parameters, perParameters)
  return transformed
}

type ActorDef = Tool.InferDef<typeof ActorTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  actor: ActorDef
  read: ReadDef
  cache: Map<string, { expires: number; tools: Tool.Def[] }>
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ actor: ActorDef; read: ReadDef }>
  readonly tools: (model: {
    providerID: ProviderID
    modelID: ModelID
    agent: Agent.Info
    capabilities?: { patch_editing?: boolean }
    activeSkills?: string[]
  }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/ToolRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const actor = yield* ActorTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const shell = yield* ShellTool
    const bash = yield* BashTool
    const pip = yield* PipTool
    const python = yield* PythonTool
    const cpp = yield* CppTool
    const runtimeManage = yield* RuntimeManageTool
    const shellProcess = yield* ShellProcessTool
    const office = yield* OfficeTool
    const toolOutput = yield* ToolOutputTool
    const pluginAuthor = yield* PluginAuthorTool
    const pluginManage = yield* PluginManageTool
    const skillManage = yield* SkillManageTool
    const hookManage = yield* HookManageTool
    const mcpManage = yield* McpManageTool
    const providerManage = yield* ProviderManageTool
    const credentialManage = yield* CredentialManageTool
    const contextBroker = yield* ContextBrokerTool
    const capabilityManage = yield* CapabilityManageTool
    const codesearch = yield* CodeSearchTool
    const fileInfoTool = yield* FileInfoTool
    const edit = yield* EditTool
    const changedirtool = yield* ChangeDirectoryTool
    const treeTool = yield* TreeTool
    const fileSearchTool = yield* SearchTool
    const archiveInspectTool = yield* ArchiveInspectTool
    const editHistoryTool = yield* EditHistoryTool
    const appGetStateTool = yield* AppGetStateTool
    const appEditorActionTool = yield* AppEditorActionTool
    const appEditorQueryTool = yield* AppEditorQueryTool
    const appFiletabQueryTool = yield* AppFiletabQueryTool
    const appUiActionTool = yield* AppUiActionTool
    const appUiQueryTool = yield* AppUiQueryTool
    const appDomTool = yield* AppDomTool
    const appListWindowsTool = yield* AppListWindowsTool
    const appGetEventsTool = yield* AppGetEventsTool
    const appGetAutomationStatusTool = yield* AppGetAutomationStatusTool
    const appWaitForEventTool = yield* AppWaitForEventTool
    const appGetConsoleTool = yield* AppGetConsoleTool
    const appGetNetworkTool = yield* AppGetNetworkTool
    const appCaptureWindowTool = yield* AppCaptureWindowTool
    const appCaptureDiagnosticsBundleTool = yield* AppCaptureDiagnosticsBundleTool
    const appOpenBrowserTool = yield* AppOpenBrowserTool
    const appOpenRouteTool = yield* AppOpenRouteTool
    const appOpenSessionTool = yield* AppOpenSessionTool
    const appOpenSideChatTool = yield* AppOpenSideChatTool
    const appFocusSideChatTool = yield* AppFocusSideChatTool
    const appCloseSideChatTool = yield* AppCloseSideChatTool
    const appFiletabActionTool = yield* AppFiletabActionTool
    const appReadBrowserPageTool = yield* AppReadBrowserPageTool
    const appBrowserSnapshotTool = yield* AppBrowserSnapshotTool
    const appBrowserScreenshotTool = yield* AppBrowserScreenshotTool
    const appBrowserExtractResourceTool = yield* AppBrowserExtractResourceTool
    const appBrowserListCachedResourcesTool = yield* AppBrowserListCachedResourcesTool
    const appBrowserDownloadResourceTool = yield* AppBrowserDownloadResourceTool
    const appFocusBrowserTabTool = yield* AppFocusBrowserTabTool
    const appBrowserClickTool = yield* AppBrowserClickTool
    const appBrowserScrollTool = yield* AppBrowserScrollTool
    const appBrowserTypeTool = yield* AppBrowserTypeTool
    const appBrowserWaitTool = yield* AppBrowserWaitTool
    const appSetInputTool = yield* AppSetInputTool
    const appAppendInputTool = yield* AppAppendInputTool
    const appSendTool = yield* AppSendTool
    const appWaitForStateTool = yield* AppWaitForStateTool
    const appCloseBrowserTabTool = yield* AppCloseBrowserTabTool
    const appControlTargets = yield* Effect.all({
      get_state: Tool.init(appGetStateTool),
      editor_action: Tool.init(appEditorActionTool),
      editor_query: Tool.init(appEditorQueryTool),
      filetab_query: Tool.init(appFiletabQueryTool),
      filetab_action: Tool.init(appFiletabActionTool),
      ui_action: Tool.init(appUiActionTool),
      ui_query: Tool.init(appUiQueryTool),
      dom: Tool.init(appDomTool),
      list_windows: Tool.init(appListWindowsTool),
      get_events: Tool.init(appGetEventsTool),
      get_automation_status: Tool.init(appGetAutomationStatusTool),
      wait_for_event: Tool.init(appWaitForEventTool),
      capture_window: Tool.init(appCaptureWindowTool),
      capture_diagnostics_bundle: Tool.init(appCaptureDiagnosticsBundleTool),
      open_route: Tool.init(appOpenRouteTool),
      open_session: Tool.init(appOpenSessionTool),
      open_side_chat: Tool.init(appOpenSideChatTool),
      focus_side_chat: Tool.init(appFocusSideChatTool),
      close_side_chat: Tool.init(appCloseSideChatTool),
      set_input: Tool.init(appSetInputTool),
      append_input: Tool.init(appAppendInputTool),
      send: Tool.init(appSendTool),
      wait_for_state: Tool.init(appWaitForStateTool),
    })
    const browserTool = yield* BrowserTool
    const appControl = yield* AppControlTool(appControlTargets)
    const skilltool = yield* SkillTool
    const historytool = yield* HistoryTool
    const memorytool = yield* MemoryTool
    const tasktool = yield* TaskTool
    const createGoalTool = yield* CreateGoalTool
    const getGoalTool = yield* GetGoalTool
    const updateGoalTool = yield* UpdateGoalTool
    const agent = yield* Agent.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          return {
          id,
          parameters: z.object(def.args),
          description: def.description,
          metadata: Tool.defaultMetadata(id),
          activationSkill: def.activationSkill,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? [] : (result.attachments ?? [])
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputRef: out.outputRef }),
                  },
                  attachments: attachments.map((attachment) => ({ type: "file" as const, ...attachment })),
                }
              }),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.LFCODE_CLIENT) || Flag.LFCODE_ENABLE_QUESTION_TOOL

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          bash: Tool.init(bash),
          pip: Tool.init(pip),
          python: Tool.init(python),
          cpp: Tool.init(cpp),
          runtimeManage: Tool.init(runtimeManage),
          shellProcess: Tool.init(shellProcess),
          office: Tool.init(office),
          toolOutput: Tool.init(toolOutput),
          pluginAuthor: Tool.init(pluginAuthor),
          pluginManage: Tool.init(pluginManage),
          skillManage: Tool.init(skillManage),
          hookManage: Tool.init(hookManage),
          mcpManage: Tool.init(mcpManage),
          providerManage: Tool.init(providerManage),
          credentialManage: Tool.init(credentialManage),
          contextBroker: Tool.init(contextBroker),
          capabilityManage: Tool.init(capabilityManage),
          read: Tool.init(read),
          fileInfo: Tool.init(fileInfoTool),
          tree: Tool.init(treeTool),
          fileSearch: Tool.init(fileSearchTool),
          archiveInspect: Tool.init(archiveInspectTool),
          editHistory: Tool.init(editHistoryTool),
          appGetState: Effect.succeed(appControlTargets.get_state),
          appEditorAction: Effect.succeed(appControlTargets.editor_action),
          appEditorQuery: Effect.succeed(appControlTargets.editor_query),
          appFiletabQuery: Effect.succeed(appControlTargets.filetab_query),
          appUiAction: Effect.succeed(appControlTargets.ui_action),
          appUiQuery: Effect.succeed(appControlTargets.ui_query),
          appDom: Effect.succeed(appControlTargets.dom),
          appListWindows: Effect.succeed(appControlTargets.list_windows),
          appGetEvents: Effect.succeed(appControlTargets.get_events),
          appGetAutomationStatus: Effect.succeed(appControlTargets.get_automation_status),
          appWaitForEvent: Effect.succeed(appControlTargets.wait_for_event),
          appGetConsole: Tool.init(appGetConsoleTool),
          appGetNetwork: Tool.init(appGetNetworkTool),
          appCaptureWindow: Effect.succeed(appControlTargets.capture_window),
          appCaptureDiagnosticsBundle: Effect.succeed(appControlTargets.capture_diagnostics_bundle),
          appOpenBrowser: Tool.init(appOpenBrowserTool),
          appOpenRoute: Effect.succeed(appControlTargets.open_route),
          appOpenSession: Effect.succeed(appControlTargets.open_session),
          appOpenSideChat: Effect.succeed(appControlTargets.open_side_chat),
          appFocusSideChat: Effect.succeed(appControlTargets.focus_side_chat),
          appCloseSideChat: Effect.succeed(appControlTargets.close_side_chat),
          appFiletabAction: Effect.succeed(appControlTargets.filetab_action),
          appReadBrowserPage: Tool.init(appReadBrowserPageTool),
          appBrowserSnapshot: Tool.init(appBrowserSnapshotTool),
          appBrowserScreenshot: Tool.init(appBrowserScreenshotTool),
          appBrowserExtractResource: Tool.init(appBrowserExtractResourceTool),
          appBrowserListCachedResources: Tool.init(appBrowserListCachedResourcesTool),
          appBrowserDownloadResource: Tool.init(appBrowserDownloadResourceTool),
          appFocusBrowserTab: Tool.init(appFocusBrowserTabTool),
          appBrowserClick: Tool.init(appBrowserClickTool),
          appBrowserScroll: Tool.init(appBrowserScrollTool),
          appBrowserType: Tool.init(appBrowserTypeTool),
          appBrowserWait: Tool.init(appBrowserWaitTool),
          appSetInput: Effect.succeed(appControlTargets.set_input),
          appAppendInput: Effect.succeed(appControlTargets.append_input),
          appSend: Effect.succeed(appControlTargets.send),
          appWaitForState: Effect.succeed(appControlTargets.wait_for_state),
          appCloseBrowserTab: Tool.init(appCloseBrowserTabTool),
          browser: Tool.init(browserTool),
          appControl: Tool.init(appControl),
          edit: Tool.init(edit),
          actor: Tool.init(actor),
          fetch: Tool.init(webfetch),
          search: Tool.init(websearch),
          code: Tool.init(codesearch),
          skill: Tool.init(skilltool),
          changedir: Tool.init(changedirtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          memory: Tool.init(memorytool),
          history: Tool.init(historytool),
          task: Tool.init(tasktool),
          createGoal: Tool.init(createGoalTool),
          getGoal: Tool.init(getGoalTool),
          updateGoal: Tool.init(updateGoalTool),
        })
        const extensionSearch: Tool.Def<typeof extensionSearchParameters> = {
          id: "search_tool",
          description:
            "Search installed extension tools by name or keyword. It never searches installed Skills, the web, core tools, or built-in tools; use the skill tool for installed Skill instruction bundles.",
          parameters: extensionSearchParameters,
          metadata: {
            kind: "search",
            namespace: "extensions",
            readOnly: true,
            recovery: "retry",
            latencyClass: "fast",
          },
          execute: (input) =>
            Effect.gen(function* () {
              const parsed = extensionSearchParameters.parse(input)
              const tools = extensionMatches(custom, parsed.query, parsed.limit)
              return {
                title: "Extension tools",
                output: JSON.stringify({ tools }, null, 2),
                metadata: { count: tools.length },
              }
            }).pipe(Effect.orDie),
        }
        const extensionUse: Tool.Def<typeof extensionUseParameters> = {
          id: "use_tool",
          description: "Run an exact extension tool returned by search_tool. Use only after discovering its name.",
          parameters: extensionUseParameters,
          metadata: {
            kind: "custom",
            namespace: "extensions",
            readOnly: false,
            recovery: "user",
            latencyClass: "io",
          },
          execute: (input, ctx) =>
            Effect.gen(function* () {
              const parsed = extensionUseParameters.parse(input)
              const target = custom.find((item) => item.id === parsed.name)
              if (!target) {
                return yield* Effect.fail(
                  new Error(
                    `Extension tool '${parsed.name}' was not found. Search extensions first and use an exact name.`,
                  ),
                )
              }
              if (target.activationSkill && !Skill.activeNames(ctx.messages).includes(target.activationSkill)) {
                return yield* Effect.fail(
                  new Error(`Extension tool '${parsed.name}' requires loading the '${target.activationSkill}' Skill first.`),
                )
              }
              const args = target.parameters.parse(parsed.arguments)
              return yield* target.execute(args, ctx)
            }).pipe(Effect.orDie),
        }

        return {
          custom,
          builtin: [
            tool.invalid,
            extensionSearch,
            extensionUse,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.pip,
            tool.python,
            tool.cpp,
            tool.runtimeManage,
            tool.shellProcess,
            tool.office,
            tool.toolOutput,
            tool.pluginAuthor,
            tool.pluginManage,
            tool.skillManage,
            tool.hookManage,
            tool.mcpManage,
            tool.providerManage,
            tool.credentialManage,
            tool.contextBroker,
            tool.capabilityManage,
            tool.read,
            tool.fileInfo,
            tool.fileSearch,
            tool.archiveInspect,
            tool.tree,
            tool.editHistory,
            tool.appControl,
            tool.appGetState,
            tool.appEditorAction,
            tool.appEditorQuery,
            tool.appFiletabQuery,
            tool.appUiAction,
            tool.appUiQuery,
            tool.appDom,
            tool.appListWindows,
            tool.appGetEvents,
            tool.appGetAutomationStatus,
            tool.appWaitForEvent,
            tool.appGetConsole,
            tool.appGetNetwork,
            tool.appCaptureWindow,
            tool.appCaptureDiagnosticsBundle,
            tool.appOpenBrowser,
            tool.appOpenRoute,
            tool.appOpenSession,
            tool.appOpenSideChat,
            tool.appFocusSideChat,
            tool.appCloseSideChat,
            tool.appFiletabAction,
            tool.appReadBrowserPage,
            tool.appBrowserSnapshot,
            tool.appBrowserScreenshot,
            tool.appBrowserExtractResource,
            tool.appBrowserListCachedResources,
            tool.appBrowserDownloadResource,
            tool.appFocusBrowserTab,
            tool.appBrowserClick,
            tool.appBrowserScroll,
            tool.appBrowserType,
            tool.appBrowserWait,
            tool.appSetInput,
            tool.appAppendInput,
            tool.appSend,
            tool.appWaitForState,
            tool.appCloseBrowserTab,
            tool.browser,
            tool.edit,
            tool.fetch,
            tool.search,
            tool.code,
            tool.skill,
            tool.changedir,
            tool.actor,
            ...(Flag.LFCODE_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
            tool.plan,
            tool.memory,
            tool.history,
            tool.task,
            tool.createGoal,
            tool.getGoal,
            tool.updateGoal,
          ],
          actor: tool.actor,
          read: tool.read,
          cache: new Map(),
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* () {
      return [
        "Search or load installed skills.",
        "Pass an exact skill name to load its full instructions and bundled resources.",
        "Pass keywords when you want the tool to return matching skill candidates first.",
        'Load results include a `<skill_content name="...">` block.',
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary" && !item.hidden)
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const cfg = yield* config.get()
      const globalCfg = yield* config.getGlobal()
      const cacheState = yield* InstanceState.get(state)
      const appControl = Config.resolveGlobalAppControlConfig(globalCfg)
      const browserControl = Config.resolveGlobalBrowserControlConfig(globalCfg)
      const key = JSON.stringify({
        providerID: input.providerID,
        modelID: input.modelID,
        agent: input.agent.name,
        allowlist: input.agent.toolAllowlist ?? [],
        permission: input.agent.permission ?? [],
        activeSkills: [...(input.activeSkills ?? [])].sort(),
        tool: cfg.tool ?? {},
        appControl: globalCfg.app_control ?? {},
        browserControl: globalCfg.browser_control ?? {},
        flags: {
          client: Flag.LFCODE_CLIENT,
          exa: Flag.LFCODE_ENABLE_EXA,
          lsp: Flag.LFCODE_EXPERIMENTAL_LSP_TOOL,
        },
      })
      const cached = cacheState.cache.get(key)
      if (cached && cached.expires > Date.now()) return cached.tools

      const extensionIDs = new Set(cacheState.custom.map((tool) => tool.id))
      const activeSkills = new Set(input.activeSkills ?? [])
      const activeExtensionIDs = new Set(
        cacheState.custom
          .filter((tool) => tool.activationSkill && extensionToolIsActive(tool, activeSkills))
          .map((tool) => tool.id),
      )
      let filtered = (yield* all()).filter((tool) => !extensionIDs.has(tool.id) || activeExtensionIDs.has(tool.id))
      filtered = filtered.filter((tool) => {
        const explicitlyAllowed = input.agent.toolAllowlist?.includes(tool.id) ?? false
        if (managementToolIDs.has(tool.id)) return explicitlyAllowed
        if (onDemandRuntimeToolIDs.has(tool.id)) return input.agent.toolAllowlist?.includes(tool.id) ?? false
        if (tool.id === CodeSearchTool.id || tool.id === WebSearchTool.id) {
          // Search availability belongs to execution, not schema discovery:
          // provider-native search may fail and the universal local tool then
          // follows the configured direct or browser discovery route. It must
          // remain visible for every model.
          if (tool.id === WebSearchTool.id) return true
          return input.providerID === ProviderID.lfcode || Flag.LFCODE_ENABLE_EXA
        }

        if (tool.id === ActorTool.id) return input.agent.mode === "primary" || explicitlyAllowed
        if (tool.id === AppControlToolID) return appControl.enabled
        if (tool.id === BrowserTool.id) return browserControl.enabled
        // Browser tools are a shared verification capability. Their visibility
        // is controlled by the browser switch; a child-agent allowlist must not
        // hide them and make read-only/browser diagnostics impossible.
        if (browserToolIDs.has(tool.id)) return browserControl.enabled
        if (legacyAppToolIDs.has(tool.id)) {
          if (!explicitlyAllowed || !appControl.enabled) return false
          if (appReadToolIDs.has(tool.id)) return true
          if (appSessionToolIDs.has(tool.id)) {
            return appControlPermissionRank(appControl.permission) >= appControlPermissionRank("session_control")
          }
          return appControlPermissionRank(appControl.permission) >= appControlPermissionRank("full_app_control")
        }

        return true
      })

      if (input.agent.toolAllowlist) {
        const allowed = new Set(input.agent.toolAllowlist)
        // Extension discovery is the safe public gateway to user-installed tools.
        // Keep it available even when an agent has a deliberately narrow allowlist;
        // `use_tool` still verifies both the discovered name and skill activation.
        filtered = filtered.filter(
          (tool) =>
            ["invalid", "search_tool", "use_tool"].includes(tool.id) ||
            tool.id === BrowserTool.id ||
            browserToolIDs.has(tool.id) ||
            allowed.has(tool.id),
        )
      }

      const resolveStyle = (toolId: string): "json" | "shell" => resolveInvocationStyle(cfg.tool, toolId)

      const result = yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const style = resolveStyle(tool.id)
          const useShell = style === "shell" && tool.shell !== undefined
          if (style === "shell" && !tool.shell) {
            warnShellFallbackOnce(tool.id)
          }
          const effective: Tool.Def = useShell ? shellWrap(tool) : tool
          const description = useShell ? tool.shell!.description : output.description
          return {
            id: tool.id,
            description: [
              description,
              tool.id === ActorTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill() : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: useShell ? effective.parameters : output.parameters,
            execute: effective.execute,
            metadata: Tool.definitionMetadata(effective),
            formatValidationError: effective.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
      cacheState.cache.set(key, { expires: Date.now() + 15_000, tools: result })
      return result
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { actor: s.actor, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer = Layer.suspend(() => {
  const coreDependencies = Layer.mergeAll(
    Config.defaultLayer,
    Plugin.defaultLayer,
    Question.defaultLayer,
    Todo.defaultLayer,
    Goal.defaultLayer,
    Skill.defaultLayer,
    Agent.defaultLayer,
    Session.defaultLayer,
    Provider.defaultLayer,
    LSP.defaultLayer,
    Instruction.defaultLayer,
    AppFileSystem.defaultLayer,
    Bus.layer,
    FetchHttpClient.layer,
    Format.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Layer.mergeAll(ActorRegistry.defaultLayer, ActorWaiter.defaultLayer),
    Team.defaultLayer,
  )
  const stateDependencies = Layer.mergeAll(
    File.defaultLayer,
    Memory.defaultLayer,
    History.defaultLayer,
    SessionCheckpoint.defaultLayer,
    TaskRegistry.defaultLayer,
    Auth.defaultLayer,
  )
  return layer.pipe(Layer.provide(coreDependencies), Layer.provide(stateDependencies))
})
