import { Show, type JSX } from "solid-js"
import atlas from "@/assets/subagents/atlas.svg"
import alien from "@/assets/subagents/alien.svg"
import arcade from "@/assets/subagents/arcade.svg"
import banana from "@/assets/subagents/banana.svg"
import bee from "@/assets/subagents/bee.svg"
import book from "@/assets/subagents/book.svg"
import cactus from "@/assets/subagents/cactus.svg"
import cassette from "@/assets/subagents/cassette.svg"
import comet from "@/assets/subagents/comet.svg"
import crystal from "@/assets/subagents/crystal.svg"
import dice from "@/assets/subagents/dice.svg"
import donut from "@/assets/subagents/donut.svg"
import ember from "@/assets/subagents/ember.svg"
import ghost from "@/assets/subagents/ghost.svg"
import moss from "@/assets/subagents/moss.svg"
import potion from "@/assets/subagents/potion.svg"
import satellite from "@/assets/subagents/satellite.svg"
import snail from "@/assets/subagents/snail.svg"
import teacup from "@/assets/subagents/teacup.svg"
import treasure from "@/assets/subagents/treasure.svg"
import { useLanguage } from "@/context/language"
import { subagentPreset } from "../subagent-presets"

export type VisibleSubagent = {
  actorID: string
  description: string
  status: string
  agent?: string
  execution?: "wait" | "background"
  unread?: boolean
}

const avatars = [
  atlas,
  comet,
  ember,
  moss,
  potion,
  crystal,
  cassette,
  arcade,
  alien,
  banana,
  bee,
  book,
  cactus,
  dice,
  donut,
  ghost,
  satellite,
  snail,
  teacup,
  treasure,
]

export function SubagentAvatar(props: { sessionID: string; actorID: string; agent?: string; size?: "small" | "medium" }) {
  const index = subagentPreset(props.agent)?.avatar ?? stableHash(`${props.sessionID}:${props.actorID}`) % avatars.length
  return (
    <img
      class={props.size === "medium" ? "size-8 shrink-0 rounded-sm image-rendering-pixelated" : "size-5 shrink-0 rounded-sm image-rendering-pixelated"}
      style={{ "image-rendering": "pixelated" }}
      src={avatars[index]}
      alt=""
      aria-hidden="true"
    />
  )
}

export function SubagentCard(props: {
  sessionID: string
  actor: VisibleSubagent
  onClick?: () => void
  compact?: boolean
  actions?: JSX.Element
  statusLabel?: string
}) {
  const language = useLanguage()
  const clickable = () => props.onClick !== undefined
  return (
    <div class="rounded-lg px-1 py-1 transition-colors hover:bg-surface-raised-base-hover" data-component="subagent-card">
      <button
        type="button"
        class={`flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left ${clickable() ? "" : "cursor-default"}`}
        disabled={!clickable()}
        onClick={props.onClick}
      >
        <SubagentAvatar
          sessionID={props.sessionID}
          actorID={props.actor.actorID}
          agent={props.actor.agent}
          size={props.compact ? "small" : "medium"}
        />
        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-12-medium text-text-base">{props.actor.description}</span>
            <Show when={props.actor.unread}>
              <span class="size-1.5 shrink-0 rounded-full bg-icon-info-base" aria-label={language.t("subagent.rail.unread")} />
            </Show>
          </span>
          <Show when={!props.compact}>
            <span class="mt-0.5 block truncate text-11-regular text-text-weak">
              {props.actor.agent ?? language.t("subagent.title")}
              <Show when={props.actor.execution}>
                {(execution) =>
                  ` · ${language.t(execution() === "wait" ? "subagent.execution.wait" : "subagent.execution.background")}`}
              </Show>
            </span>
          </Show>
        </span>
        <span class={`size-2 shrink-0 rounded-full ${statusTone(props.actor.status)}`} title={props.statusLabel ?? props.actor.status} />
      </button>
      <Show when={props.actions}>
        <div class="ml-10 mt-1 flex flex-wrap gap-1">{props.actions}</div>
      </Show>
    </div>
  )
}

function stableHash(value: string) {
  return [...value].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
}

function statusTone(status: string) {
  if (status === "running" || status === "pending" || status === "queued") return "bg-icon-warning-base"
  if (status === "idle" || status === "completed") return "bg-icon-interactive-base"
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "bg-icon-critical-base"
  return "bg-icon-weak-base"
}
