import { Markdown, sanitizeMarkdownHtml } from "@lfcode-ai/ui/markdown"
import { For, Show, createMemo } from "solid-js"

type Segment =
  | { type: "html"; value: string }
  | { type: "markdown"; value: string }

export function TavernRichText(props: { text: string; html: boolean; cacheKey: string; streaming?: boolean }) {
  const rawHtml = createMemo(() => props.html && /<\/?[a-z][^>]*>/i.test(props.text))
  const text = createMemo(() => props.html ? props.text : props.text.replace(/<[^>]*>/g, ""))
  const segments = createMemo<Segment[]>(() => {
    if (!rawHtml() || typeof document === "undefined") return [{ type: "markdown", value: text() }]
    const template = document.createElement("template")
    template.innerHTML = props.text
    return Array.from(template.content.childNodes).flatMap<Segment>((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) return { type: "html", value: sanitizeMarkdownHtml((node as Element).outerHTML) }
      if (!node.textContent) return []
      return { type: "markdown", value: node.textContent }
    })
  })

  return (
    <Show
      when={rawHtml()}
      fallback={<Markdown text={text()} cacheKey={props.cacheKey} streaming={props.streaming} class="tavern-message-markdown break-words" />}
    >
      <div class="tavern-html-message break-words">
        <For each={segments()}>{(segment, index) => <Show when={segment.type === "html"} fallback={<Markdown text={segment.value} cacheKey={`${props.cacheKey}:markdown:${index()}`} streaming={props.streaming} class="tavern-message-markdown break-words" />}><div innerHTML={segment.value} /></Show>}</For>
      </div>
    </Show>
  )
}
