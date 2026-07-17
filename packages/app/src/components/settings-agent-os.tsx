import { Button } from "@lfcode-ai/ui/button"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { SettingsPageShell, SettingsSection } from "./settings-page-shell"

type Capability = {
  id: string
  title: string
  description?: string
  kind: "tool" | "skill" | "plugin" | "mcp" | "runtime"
  source: string
  risk: string
  health: "ready" | "disabled" | "degraded" | "missing"
  authentication: "not_required" | "available" | "required" | "unknown"
  dependencies: string[]
}

type Grant = {
  id: string
  capability: string
  scope: string
  source: string
  expiresAt?: number
  remainingBudget?: number
  revoked?: boolean
}

type Audit = {
  id: string
  caller: string
  capability: string
  operation: string
  decision: string
  result?: string
  target?: string
  createdAt: number
}

export function SettingsAgentOS() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const params = useParams()
  const directory = createMemo(() => decode64(params.dir))
  const sdk = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const [revision, setRevision] = createSignal(0)
  const [revoking, setRevoking] = createSignal<string>()
  const [stopping, setStopping] = createSignal(false)
  const [data, { refetch }] = createResource(
    () => [directory(), revision()] as const,
    async ([currentDirectory]) => {
      if (!currentDirectory) return { capabilities: [] as Capability[], grants: [] as Grant[], audit: [] as Audit[] }
      const [capabilities, grants, audit] = await Promise.all([
        sdk().capability.list(),
        sdk().capability.grant.list(),
        sdk().capability.audit.list({ limit: 30 }),
      ])
      return {
        capabilities: (capabilities.data ?? []) as Capability[],
        grants: (grants.data ?? []) as Grant[],
        audit: (audit.data ?? []) as Audit[],
      }
    },
  )

  const refresh = () => {
    setRevision((value) => value + 1)
    void refetch()
  }

  const revoke = async (grantID: string) => {
    if (revoking()) return
    setRevoking(grantID)
    try {
      await sdk().capability.grant.revoke({ grantID })
      refresh()
    } finally {
      setRevoking(undefined)
    }
  }

  const stopAll = async () => {
    if (stopping()) return
    setStopping(true)
    try {
      await sdk().capability.stop({
        scope: "global",
        caller: "settings:agent-os",
        reason: "User requested global Agent OS stop",
      })
      refresh()
    } finally {
      setStopping(false)
    }
  }

  return (
    <SettingsPageShell title="Agent OS">
      <div class="flex flex-wrap items-start justify-between gap-4 rounded-[20px] bg-surface-base p-4">
        <div>
          <div class="text-14-medium text-text-strong">统一能力与分级自治</div>
          <p class="mt-1 text-12-regular text-text-weak">
            可信且已预览、可回滚的安装可自动执行；删除、凭据、导出与发布必须确认。所有管理操作都会写入脱敏审计。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button size="small" variant="secondary" onClick={() => void stopAll()} disabled={stopping()}>{stopping() ? "停止中" : "停止全部任务"}</Button>
          <Button size="small" variant="secondary" onClick={refresh} disabled={data.loading}>刷新</Button>
        </div>
      </div>

      <Show when={data.error}>
        <div class="rounded-lg border border-border-weak-base bg-surface-base px-4 py-3 text-13-regular text-status-warning">
          {formatServerError(data.error, language.t, language.t("common.requestFailed"))}
        </div>
      </Show>

      <Show when={data.latest}>
        {(value) => (
          <>
            <SettingsSection title={`能力目录（${value().capabilities.length}）`} description="工具、Skill、插件、MCP 与受管运行时均以统一能力形式登记。">
              <div class="overflow-hidden rounded-[18px] bg-surface-base">
                <For each={value().capabilities} fallback={<div class="px-4 py-5 text-13-regular text-text-weak">暂无已发现能力。</div>}>
                  {(capability) => (
                    <div class="border-b border-border-weak-base px-4 py-3 last:border-none">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-13-medium text-text-strong">{capability.title}</div>
                          <div class="mt-1 truncate font-mono text-11-regular text-text-weaker">{capability.id}</div>
                          <Show when={capability.description}>{(description) => <div class="mt-1 text-12-regular text-text-weak">{description()}</div>}</Show>
                        </div>
                        <div class="shrink-0 text-right text-11-regular text-text-weak">
                          <div>{capability.kind} · {capability.source}</div>
                          <div class={capability.health === "ready" ? "text-status-success" : "text-status-warning"}>{capability.health} · {capability.risk} · {capability.authentication}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </SettingsSection>

            <SettingsSection title="授权范围" description="Grant 可以限制自动化能力的有效期和预算；撤销后下一次策略判断立即拒绝。">
              <div class="overflow-hidden rounded-[18px] bg-surface-base">
                <For each={value().grants} fallback={<div class="px-4 py-5 text-13-regular text-text-weak">尚未设置额外授权范围。</div>}>
                  {(grant) => (
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3 last:border-none">
                      <div class="min-w-0">
                        <div class="text-13-medium text-text-strong">{grant.capability}</div>
                        <div class="mt-1 text-11-regular text-text-weak">{grant.scope} · {grant.source}{grant.remainingBudget !== undefined ? ` · 预算 ${grant.remainingBudget}` : ""}{grant.revoked ? " · 已撤销" : ""}</div>
                      </div>
                      <Button size="small" variant="secondary" disabled={grant.revoked || revoking() === grant.id} onClick={() => void revoke(grant.id)}>
                        {revoking() === grant.id ? "撤销中" : grant.revoked ? "已撤销" : "撤销"}
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </SettingsSection>

            <SettingsSection title="最近审计" description="审计内容会脱敏处理，不保存 API Key、Token、Cookie 或凭据原文。">
              <div class="overflow-hidden rounded-[18px] bg-surface-base">
                <For each={value().audit} fallback={<div class="px-4 py-5 text-13-regular text-text-weak">尚无能力操作记录。</div>}>
                  {(audit) => (
                    <div class="border-b border-border-weak-base px-4 py-3 last:border-none">
                      <div class="flex items-center justify-between gap-3 text-13-medium text-text-strong">
                        <span>{audit.capability} · {audit.operation}</span>
                        <span class="text-11-regular text-text-weak">{new Date(audit.createdAt).toLocaleString()}</span>
                      </div>
                      <div class="mt-1 text-12-regular text-text-weak">{audit.caller} · 决策 {audit.decision}{audit.result ? ` · ${audit.result}` : ""}</div>
                      <Show when={audit.target}>{(target) => <div class="mt-1 truncate font-mono text-11-regular text-text-weaker">{target()}</div>}</Show>
                    </div>
                  )}
                </For>
              </div>
            </SettingsSection>
          </>
        )}
      </Show>
    </SettingsPageShell>
  )
}
