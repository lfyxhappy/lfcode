import { createMemo, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useMotionEnabled, usePageVisible } from "./motion-presence"

export function shouldRunTextShimmer(active: boolean, motion: boolean, visible: boolean) {
  return active && motion && visible
}

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
}) => {
  const text = createMemo(() => props.text ?? "")
  const active = createMemo(() => props.active ?? true)
  const offset = createMemo(() => props.offset ?? 0)
  const enabled = useMotionEnabled()
  const visible = usePageVisible()
  const run = createMemo(() => shouldRunTextShimmer(active(), enabled(), visible()))

  return (
    <Dynamic
      component={props.as ?? "span"}
      data-component="text-shimmer"
      data-active={active() ? "true" : "false"}
      data-running={run() ? "true" : "false"}
      data-motion={enabled() ? "enabled" : "off"}
      class={props.class}
      aria-label={text()}
      style={{
        "--text-shimmer-index": `${offset()}`,
      }}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {text()}
        </span>
        <span data-slot="text-shimmer-char-shimmer" aria-hidden="true">
          {text()}
        </span>
      </span>
    </Dynamic>
  )
}
