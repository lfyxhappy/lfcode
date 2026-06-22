import { ipcRenderer } from "electron"
import type { BrowserAutofillMatch, BrowserPasswordCapturePayload } from "@lfcode-ai/shared/desktop-browser-management"

function editableInput(input: Element): input is HTMLInputElement {
  return input instanceof HTMLInputElement && !input.disabled && !input.readOnly
}

function passwordField() {
  return Array.from(document.querySelectorAll("input")).find((input) => editableInput(input) && input.type === "password")
}

function usernameField(currentPassword: HTMLInputElement) {
  const inputs = Array.from(document.querySelectorAll("input")).filter(editableInput)
  const currentIndex = inputs.indexOf(currentPassword)
  const before = currentIndex === -1 ? inputs : inputs.slice(0, currentIndex).reverse()
  return before.find((input) => {
    if (input === currentPassword) return false
    const type = input.type || "text"
    if (["email", "text", "search", "tel", "url"].includes(type)) return true
    const autocomplete = input.autocomplete?.toLowerCase() ?? ""
    return ["username", "email", "current-username"].some((value) => autocomplete.includes(value))
  })
}

function setInputValue(input: HTMLInputElement | undefined, value: string) {
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

async function autofill() {
  if (location.origin === "null") return
  const match = await ipcRenderer.invoke("browser-request-autofill", location.origin).catch(() => null as BrowserAutofillMatch | null)
  if (!match) return
  const password = passwordField()
  if (!password) return
  setInputValue(usernameField(password), match.username)
  setInputValue(password, match.password)
}

function bindPasswordCapture() {
  document.addEventListener(
    "submit",
    (event) => {
      if (!(event.target instanceof HTMLFormElement)) return
      const password = passwordField()
      if (!password || !event.target.contains(password)) return
      if (!password.value) return
      const payload = {
        origin: location.origin,
        username: usernameField(password)?.value?.trim() ?? "",
        password: password.value,
      } satisfies BrowserPasswordCapturePayload
      ipcRenderer.send("browser-password-capture", payload)
    },
    true,
  )
}

function start() {
  void autofill()
  bindPasswordCapture()
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", start, { once: true })
} else {
  start()
}
