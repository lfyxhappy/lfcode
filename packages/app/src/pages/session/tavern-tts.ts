export type TavernSpeechSettings = {
  provider: "system" | "openai-compatible" | "mimo"
  enabled: boolean
  autoPlay: boolean
  voiceURI?: string
  rate: number
  pitch: number
  volume: number
}

export function defaultTavernSpeechSettings(): TavernSpeechSettings {
  return { provider: "system", enabled: true, autoPlay: false, rate: 1, pitch: 1, volume: 1 }
}

export function normalizeTavernSpeechSettings(input?: Partial<TavernSpeechSettings>): TavernSpeechSettings {
  const defaults = defaultTavernSpeechSettings()
  return {
    provider: input?.provider === "openai-compatible" || input?.provider === "mimo" ? input.provider : defaults.provider,
    enabled: input?.enabled ?? defaults.enabled,
    autoPlay: input?.autoPlay ?? defaults.autoPlay,
    voiceURI: typeof input?.voiceURI === "string" && input.voiceURI.trim() ? input.voiceURI : undefined,
    rate: bounded(input?.rate, 0.5, 2, defaults.rate),
    pitch: bounded(input?.pitch, 0, 2, defaults.pitch),
    volume: bounded(input?.volume, 0, 1, defaults.volume),
  }
}

export function tavernSpeechText(input: string) {
  return input
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/[`*_>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function tavernSpeechAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
}

export function speakTavernText(input: string, settings: TavernSpeechSettings) {
  const text = tavernSpeechText(input)
  if (!settings.enabled || !text || !tavernSpeechAvailable()) return false
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = settings.rate
  utterance.pitch = settings.pitch
  utterance.volume = settings.volume
  const voice = settings.voiceURI ? window.speechSynthesis.getVoices().find((item) => item.voiceURI === settings.voiceURI) : undefined
  if (voice) utterance.voice = voice
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}

export function stopTavernSpeech() {
  if (!tavernSpeechAvailable()) return
  window.speechSynthesis.cancel()
}

function bounded(input: unknown, min: number, max: number, fallback: number) {
  return typeof input === "number" && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback
}
