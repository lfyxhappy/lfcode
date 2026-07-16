import { createSignal } from "solid-js"
import { isCodeEditorLanguageSupported } from "@/components/code-editor/core/language"

const STORAGE_KEY = "lfcode.experimental.monaco-editor.v2"
const [storedEnabled, setStoredEnabled] = createSignal(readStoredCodeEditorPhase0Flag())

export function isCodeEditorPhase0Path(path?: string) {
  return isCodeEditorLanguageSupported(path)
}

export function isCodeEditorPhase0Enabled() {
  return true
}

export function setCodeEditorPhase0Enabled(enabled: boolean) {
  setStoredEnabled(enabled)
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false")
  } catch {}
}

function readStoredCodeEditorPhase0Flag() {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === "1" || raw === "true"
  } catch {
    return null
  }
}
