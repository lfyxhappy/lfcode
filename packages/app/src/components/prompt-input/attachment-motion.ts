import { motionEnabled } from "@lfcode-ai/ui/motion-presence"

export function removePromptAttachment(remove: () => void, setRemoving: (value: boolean) => void) {
  if (!motionEnabled() || typeof window === "undefined") {
    remove()
    return
  }

  setRemoving(true)
  window.setTimeout(remove, motionDuration() + 24)
}

function motionDuration() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--motion-content-ms").trim()
  const match = /^(\d+(?:\.\d+)?)m?s$/.exec(value)
  if (!match) return 240
  return value.endsWith("ms") ? Number(match[1]) : Number(match[1]) * 1_000
}
