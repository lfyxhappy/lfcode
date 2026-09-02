const TOKEN_UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
] as const

export function formatTokenCount(value: number) {
  if (!Number.isFinite(value)) return "—"
  const unit = TOKEN_UNITS.find((item) => Math.abs(value) >= item.threshold)
  if (!unit) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / unit.threshold)}${unit.suffix}`
}
