const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  '[contenteditable]:not([contenteditable="false"])',
  "[data-editable-surface]",
  "[data-prevent-autofocus]",
  '[role="dialog"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="textbox"]',
  '[role="button"]',
  '[role="link"]',
  '[role="combobox"]',
  "webview",
  "iframe",
].join(",")

const FOCUS_OVERLAY_SELECTOR = '[data-focus-overlay]:not([data-closed]):not([aria-hidden="true"])'

const COMPOSER_POINTER_INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  '[contenteditable]:not([contenteditable="false"])',
  "[data-prevent-autofocus]",
  "[data-focus-overlay]",
  '[role="button"]',
  '[role="link"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="dialog"]',
].join(",")

export function shouldRoutePrintableKeyToComposer(input: {
  event: KeyboardEvent
  activeElement?: HTMLElement
  dialogActive: boolean
}) {
  if (input.dialogActive || input.event.defaultPrevented || input.event.isComposing || input.event.keyCode === 229)
    return false
  if (input.event.ctrlKey || input.event.metaKey || input.event.altKey) return false
  if (input.event.key === "Unidentified" || input.event.key.length !== 1) return false

  if (eventBelongsToEditableSurface(input.event, input.activeElement)) return false
  if (document.querySelector(FOCUS_OVERLAY_SELECTOR)) return false

  const active = input.activeElement
  if (!active || active === document.body) return true
  return active.matches("[data-session-canvas]")
}

export function eventBelongsToEditableSurface(event: Event, activeElement?: HTMLElement) {
  if (event.composedPath().some((item) => item instanceof HTMLElement && item.closest(EDITABLE_SELECTOR))) return true
  return !!activeElement?.closest(EDITABLE_SELECTOR)
}

export function shouldFocusComposerFromPointer(input: { target: EventTarget | null; composer: HTMLElement }) {
  if (!(input.target instanceof Element) || !input.composer.contains(input.target)) return false
  const interactive = input.target.closest(COMPOSER_POINTER_INTERACTIVE_SELECTOR)
  return !interactive || interactive === input.composer
}

export function deepActiveElement() {
  let current: Element | null = document.activeElement
  while (current instanceof HTMLElement && current.shadowRoot?.activeElement) current = current.shadowRoot.activeElement
  return current instanceof HTMLElement ? current : undefined
}
