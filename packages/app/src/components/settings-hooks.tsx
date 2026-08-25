import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { SettingsList } from "./settings-list"

type Hook = { id: string; name: string; description: string; enabled: boolean; scope: "global" | "project" | "session"; events: string[]; matcher: string; handler: { type: "command"; command: string; timeoutMs?: number; blockOnNonZero?: boolean } | { type: "prompt"; prompt: string }; lifetime: "permanent" | "temporary"; expiry?: { kind: string; maxRuns?: number; expiresAt?: number }; remainingRuns: number | null; expiredAt: number | null }
type HookRun = { id: string; status: string; summary: string; durationMs: number; timeCreated: number }

export const SettingsHooks: Component = () => {
  const globalSDK = useGlobalSDK()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const sdk = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const [revision, setRevision] = createSignal(0)
  const [scope, setScope] = createSignal<"all" | Hook["scope"]>("all")
  const [lifetime, setLifetime] = createSignal<"all" | Hook["lifetime"]>("all")
  const [form, setForm] = createSignal(false)
  const [editing, setEditing] = createSignal<string>()
  const [name, setName] = createSignal("")
  const [event, setEvent] = createSignal("PreToolUse")
  const [matcher, setMatcher] = createSignal("*")
  const [command, setCommand] = createSignal("")
  const [handlerType, setHandlerType] = createSignal<"command" | "prompt">("command")
  const [busy, setBusy] = createSignal<string>()
  const [selected, setSelected] = createSignal<string>()
  const [runs, setRuns] = createSignal<HookRun[]>([])
  const [hooks, hooksActions] = createResource(() => [revision(), directory()] as const, async () => (await sdk().hooks.list({ includeExpired: true })).data as Hook[] ?? [])
  const filtered = createMemo(() => (hooks() ?? []).filter((hook) => (scope() === "all" || hook.scope === scope()) && (lifetime() === "all" || hook.lifetime === lifetime())))
  const refresh = async () => { setRevision((value) => value + 1); await hooksActions.refetch() }
  const fail = (error: unknown) => showToast({ title: "Hook 操作失败", description: formatServerError(error, (key) => key, "请求失败") })
  const openCreate = () => {
    setEditing(undefined)
    setName("")
    setEvent("PreToolUse")
    setMatcher("*")
    setHandlerType("command")
    setCommand("")
    setForm(true)
  }
  const openEdit = (hook: Hook) => {
    setEditing(hook.id)
    setName(hook.name)
    setEvent(hook.events[0] ?? "PreToolUse")
    setMatcher(hook.matcher || "*")
    setHandlerType(hook.handler.type)
    setCommand(hook.handler.type === "command" ? hook.handler.command : hook.handler.prompt)
    setForm(true)
  }
  const save = async () => {
    if (!name().trim() || !command().trim()) return
    const current = editing()
    setBusy(current ?? "create")
    try {
      const handler = handlerType() === "command" ? { type: "command" as const, command: command().trim(), shell: "auto" as const, timeoutMs: 30_000, blockOnNonZero: false } : { type: "prompt" as const, prompt: command().trim(), timeoutMs: 30_000 }
      if (current) {
        await sdk().hooks.update({ hookID: current, name: name().trim(), events: [event() as never], matcher: matcher().trim() || "*", handler })
      } else {
        await sdk().hooks.create({ name: name().trim(), description: "", scope: "global", events: [event() as never], matcher: matcher().trim() || "*", handler, lifetime: "permanent", source: "user" })
      }
      setForm(false); setEditing(undefined); setName(""); setCommand(""); await refresh()
    } catch (error) { fail(error) } finally { setBusy(undefined) }
  }
  const toggle = async (hook: Hook, enabled: boolean) => { setBusy(hook.id); try { await sdk().hooks.enabled({ hookID: hook.id, enabled }); await refresh() } catch (error) { fail(error) } finally { setBusy(undefined) } }
  const remove = async (hook: Hook) => { if (!globalThis.confirm(`删除 Hook “${hook.name}”？`)) return; setBusy(hook.id); try { await sdk().hooks.delete({ hookID: hook.id }); if (selected() === hook.id) { setSelected(undefined); setRuns([]) }; await refresh() } catch (error) { fail(error) } finally { setBusy(undefined) } }
  const inspect = async (hook: Hook) => { setSelected(hook.id); try { setRuns(((await sdk().hooks.runs.list({ hookID: hook.id, limit: 20 })).data as HookRun[] | undefined) ?? []) } catch (error) { fail(error) } }
  const test = async (hook: Hook) => { setBusy(hook.id); try { await sdk().hooks.test({ hookID: hook.id, event: hook.events[0] as never, tool: hook.matcher === "*" ? "shell" : hook.matcher }); await inspect(hook); await refresh() } catch (error) { fail(error) } finally { setBusy(undefined) } }
  return <div class="flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-6">
    <div class="sticky top-0 z-10 bg-background-base py-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="text-16-medium text-text-strong">Hook</h2><p class="mt-1 text-12-regular text-text-weak">管理全局、项目与对话自动化规则。命令 Hook 按当前会话权限运行，完整脱敏记录保留在此处。</p></div>
        <div class="flex gap-2"><Button size="large" variant="secondary" onClick={() => void refresh()}><Icon name="reset" />刷新</Button><Button size="large" variant="primary" onClick={() => form() ? setForm(false) : openCreate()}><Icon name="plus-small" />{editing() ? "关闭编辑" : "新建 Hook"}</Button></div>
      </div>
      <Show when={form()}><div class="mt-4 grid gap-2 rounded-lg bg-surface-base p-3 lg:grid-cols-4"><TextField value={name()} onChange={setName} placeholder="名称" /><TextField value={event()} onChange={setEvent} placeholder="事件，例如 PreToolUse" /><TextField value={matcher()} onChange={setMatcher} placeholder="匹配规则，例如 shell,*" /><Select options={[{ value: "command", label: "命令" }, { value: "prompt", label: "提示词判断" }]} value={(item) => item.value} label={(item) => item.label} current={{ value: handlerType(), label: handlerType() === "command" ? "命令" : "提示词判断" }} onSelect={(item) => setHandlerType((item?.value ?? "command") as "command" | "prompt")} size="small" triggerVariant="settings" /><div class="lg:col-span-4"><TextField value={command()} onChange={setCommand} placeholder={handlerType() === "command" ? "PowerShell 或 shell 命令" : "判断规则提示词，要求模型返回 allow/block"} /></div><div class="lg:col-span-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => { setForm(false); setEditing(undefined) }}>取消</Button><Button variant="primary" disabled={busy() === (editing() ?? "create") || !name().trim() || !command().trim()} onClick={() => void save()}>{editing() ? "保存编辑" : "保存"}</Button></div></div></Show>
      <div class="mt-4 flex flex-wrap gap-2"><Select options={[{ value: "all", label: "全部作用域" }, { value: "global", label: "全局" }, { value: "project", label: "项目" }, { value: "session", label: "对话" }]} value={(item) => item.value} label={(item) => item.label} current={{ value: scope(), label: scope() === "all" ? "全部作用域" : scope() }} onSelect={(item) => setScope((item?.value ?? "all") as typeof scope extends () => infer V ? V : never)} size="small" triggerVariant="settings" /><Select options={[{ value: "all", label: "全部生命周期" }, { value: "permanent", label: "永久" }, { value: "temporary", label: "临时" }]} value={(item) => item.value} label={(item) => item.label} current={{ value: lifetime(), label: lifetime() === "all" ? "全部生命周期" : lifetime() }} onSelect={(item) => setLifetime((item?.value ?? "all") as typeof lifetime extends () => infer V ? V : never)} size="small" triggerVariant="settings" /></div>
    </div>
    <SettingsList><Show when={!hooks.loading} fallback={<div class="py-12 text-center text-text-weak">正在加载 Hook...</div>}><Show when={filtered().length > 0} fallback={<div class="py-12 text-center text-text-weak">还没有匹配的 Hook</div>}><For each={filtered()}>{(hook) => <div class="flex flex-col gap-3 border-b border-border-weak-base py-4 last:border-none"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><div class="flex items-center gap-2"><span class="truncate text-14-medium text-text-strong">{hook.name}</span><span class="text-11-regular text-text-weak">{hook.scope} · {hook.lifetime}</span><Show when={hook.expiredAt}><span class="text-11-regular text-status-warning">已过期</span></Show></div><div class="truncate text-12-regular text-text-weak">{hook.events.join(", ")} · {hook.matcher} · {hook.handler.type}</div><Show when={hook.remainingRuns !== null}><div class="text-11-regular text-text-weaker">剩余 {hook.remainingRuns} 次</div></Show></div><div class="flex items-center gap-2"><Button size="small" variant="secondary" disabled={busy() === hook.id} onClick={() => void test(hook)}>测试</Button><Button size="small" variant="ghost" onClick={() => void inspect(hook)}>记录</Button><Button size="small" variant="ghost" onClick={() => openEdit(hook)}>编辑</Button><Switch checked={hook.enabled} onChange={(enabled) => void toggle(hook, enabled)} hideLabel>启用</Switch><Button size="small" variant="ghost" disabled={busy() === hook.id} onClick={() => void remove(hook)}>删除</Button></div></div><Show when={selected() === hook.id}><div class="bg-background-base px-3 py-2 text-12-regular text-text-weak"><For each={runs()}>{(run) => <div class="flex justify-between gap-3 py-1"><span>{run.status} · {run.durationMs}ms</span><span class="truncate">{run.summary}</span></div>}</For></div></Show></div>}</For></Show></Show></SettingsList>
  </div>
}
