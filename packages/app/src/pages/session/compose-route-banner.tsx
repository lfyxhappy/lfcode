import type { Session } from "@lfcode-ai/sdk/v2/client"
import { For, Show, type ParentProps } from "solid-js"

type ComposeRoute = NonNullable<Session["composeRoute"]>

export function composeStrategyLabel(strategy: ComposeRoute["strategy"]) {
  switch (strategy) {
    case "direct-execute":
      return "直接执行"
    case "research-then-execute":
      return "轻量调查后执行"
    case "design-then-execute":
      return "设计后执行"
    case "full-orchestration":
      return "完整编排"
  }
}

export function composeDifficultyLabel(difficulty: ComposeRoute["difficulty"]) {
  switch (difficulty) {
    case "simple":
      return "简单"
    case "moderate":
      return "中等"
    case "complex":
      return "复杂"
    case "very-complex":
      return "很复杂"
  }
}

export function composeTaskTypeLabel(taskType: ComposeRoute["taskType"]) {
  switch (taskType) {
    case "bug-fix":
      return "缺陷修复"
    case "small-feature":
      return "小功能"
    case "refactor":
      return "重构"
    case "investigation":
      return "调查"
    case "design":
      return "设计"
    case "migration":
      return "迁移"
    case "large-project":
      return "大项目"
  }
}

export function composeRuntimeSummary(route: ComposeRoute) {
  switch (route.strategy) {
    case "direct-execute":
      return "当前是本地化直做路径，不要求 workflow、并行子代理或任务板。"
    case "research-then-execute":
      return "当前是轻量调查优先路径，先补足关键事实，再继续聚焦执行。"
    case "design-then-execute":
      return "当前是设计优先路径，先把边界和方案收敛，再做更大范围实现。"
    case "full-orchestration":
      return "当前是完整编排路径，可使用 workflow、任务板和并行子代理。"
  }
}

export function composeRequirementLabels(route: ComposeRoute) {
  const labels: string[] = []
  if (route.requiresTaskBoard) labels.push("任务板")
  if (route.requiresPlan) labels.push("计划")
  if (route.requiresReview) labels.push("审查")
  if (route.requiresVerify) labels.push("验证")
  return labels
}

export function composeRouteStatusLabel(route: ComposeRoute) {
  return `${composeStrategyLabel(route.strategy)} · ${composeDifficultyLabel(route.difficulty)}`
}

function RoutePill(props: ParentProps) {
  return (
    <span class="rounded-full border border-border-weak bg-background-strong px-2 py-0.5 text-[11px] font-medium text-text">
      {props.children}
    </span>
  )
}

export function ComposeRouteBanner(props: { route: ComposeRoute }) {
  const requirements = () => composeRequirementLabels(props.route)

  return (
    <div class="border-b border-border bg-background-base/80 px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-text">Compose 路由</span>
        <RoutePill>{composeStrategyLabel(props.route.strategy)}</RoutePill>
        <RoutePill>{composeDifficultyLabel(props.route.difficulty)}</RoutePill>
        <RoutePill>{composeTaskTypeLabel(props.route.taskType)}</RoutePill>
      </div>
      <p class="mt-2 text-xs text-text">{composeRuntimeSummary(props.route)}</p>
      <Show when={props.route.reason}>
        <p class="mt-2 text-xs text-text-dim">{props.route.reason}</p>
      </Show>
      <Show when={requirements().length > 0}>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span class="text-[11px] text-text-dim">结束前需要补齐</span>
          <For each={requirements()}>{(label) => <RoutePill>{label}</RoutePill>}</For>
        </div>
      </Show>
    </div>
  )
}

export function ComposeRouteStatusBadge(props: { route: ComposeRoute }) {
  const detail = () =>
    [
      composeStrategyLabel(props.route.strategy),
      composeDifficultyLabel(props.route.difficulty),
      composeTaskTypeLabel(props.route.taskType),
      composeRuntimeSummary(props.route),
      props.route.reason,
    ]
      .filter(Boolean)
      .join(" | ")

  return (
    <span
      class="shrink-0 inline-flex max-w-full items-center rounded-full border border-border-weak bg-background-strong px-2 py-0.5 text-[11px] font-medium text-text-dim"
      title={detail()}
    >
      {composeRouteStatusLabel(props.route)}
    </span>
  )
}
