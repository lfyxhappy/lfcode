/** Redacts credential-shaped values before they reach persisted conversation text. */
export function redactSensitiveText(text: string) {
  return text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret|cookie)\b(\s*(?:=|:|\s)\s*)([^\s,;"'`]{8,})/gi,
      "$1$2[REDACTED]",
    )
}
