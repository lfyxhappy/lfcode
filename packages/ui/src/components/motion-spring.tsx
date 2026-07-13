import { attachSpring, motionValue } from "motion"
import type { SpringOptions } from "motion"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { useMotionEnabled } from "./motion-presence"

type Opt = Partial<Pick<SpringOptions, "visualDuration" | "bounce" | "stiffness" | "damping" | "mass" | "velocity">>
const eq = (a: Opt | undefined, b: Opt | undefined) =>
  a?.visualDuration === b?.visualDuration &&
  a?.bounce === b?.bounce &&
  a?.stiffness === b?.stiffness &&
  a?.damping === b?.damping &&
  a?.mass === b?.mass &&
  a?.velocity === b?.velocity

export function useSpring(target: () => number, options?: Opt | (() => Opt)) {
  const read = () => (typeof options === "function" ? options() : options)
  const [value, setValue] = createSignal(target())
  const enabled = useMotionEnabled()
  const source = motionValue(value())
  const spring = motionValue(value())
  let config = read()
  let stop = attachSpring(spring, source, config)
  let attached = true
  let off = spring.on("change", (next: number) => setValue(next))

  createEffect(() => {
    const next = target()
    if (!enabled()) {
      if (attached) {
        stop()
        attached = false
      }
      source.set(next)
      spring.set(next)
      setValue(next)
      return
    }
    if (!attached) {
      stop = attachSpring(spring, source, config)
      attached = true
    }
    source.set(next)
  })

  createEffect(() => {
    if (!options) return
    const next = read()
    if (eq(config, next)) return
    config = next
    if (!enabled()) return
    if (attached) stop()
    stop = attachSpring(spring, source, next)
    attached = true
    setValue(spring.get())
  })

  onCleanup(() => {
    off()
    stop()
    spring.destroy()
    source.destroy()
  })

  return value
}
