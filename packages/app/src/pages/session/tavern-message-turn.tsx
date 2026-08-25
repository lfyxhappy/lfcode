import type { AssistantMessage, Part, TextPart, UserMessage } from "@lfcode-ai/sdk/v2"
import { Markdown } from "@lfcode-ai/ui/markdown"
import { For, Show, createMemo } from "solid-js"
import type { TimelineTurn } from "./message-timeline-turns"

type TavernMessageTurnProps = {
  turn: TimelineTurn | undefined
  parts: Record<string, Part[] | undefined>
  html: boolean
}

/**
 * Tavern turns deliberately stay inside the normal virtual timeline. Only the
 * visible turn gets its narrative presentation, so long conversations do not
 * pay a full-history HTML parsing cost.
 */
export function TavernMessageTurn(props: TavernMessageTurnProps) {
  const user = createMemo(() => props.turn?.message)
  const assistant = createMemo(() => props.turn?.assistantMessages ?? [])

  return (
    <div class="w-full px-4 py-3 md:px-5">
      <Show when={user()}>{(message) => <TavernBubble role="user" message={message()} parts={props.parts[message().id] ?? []} html={props.html} />}</Show>
      <For each={assistant()}>{(message) => <TavernBubble role="assistant" message={message} parts={props.parts[message.id] ?? []} html={props.html} />}</For>
    </div>
  )
}

function TavernBubble(props: { role: "user" | "assistant"; message: UserMessage | AssistantMessage; parts: Part[]; html: boolean }) {
  const text = createMemo(() =>
    props.parts
      .filter((part): part is TextPart => part.type === "text" && !part.synthetic)
      .map((part) => part.text)
      .join("\n\n"),
  )
  const rendered = createMemo(() => props.html ? text() : text().replace(/<[^>]*>/g, ""))

  return (
    <Show when={text()}>
      <article class="mb-3 flex w-full" classList={{ "justify-end": props.role === "user", "justify-start": props.role === "assistant" }}>
        <div
          class="max-w-[88%] rounded-2xl px-4 py-3 text-14-regular leading-6 shadow-sm md:max-w-[78%]"
          classList={{
            "bg-icon-info-base text-white": props.role === "user",
            "border border-border-base bg-surface-raised-base text-text-strong": props.role === "assistant",
          }}
        >
          <Show when={props.role === "assistant"}>
            <div class="mb-1 text-11-medium text-text-weak">酒馆角色</div>
          </Show>
          <Markdown
            text={rendered()}
            cacheKey={`tavern:${props.message.id}:${props.html ? "html" : "text"}`}
            streaming={props.message.role === "assistant" && typeof props.message.time.completed !== "number"}
            class="tavern-message-markdown break-words"
          />
        </div>
      </article>
    </Show>
  )
}
