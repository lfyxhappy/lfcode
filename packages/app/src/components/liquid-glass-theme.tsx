import { createEffect, onCleanup } from "solid-js"
import { useTheme } from "@lfcode-ai/ui/theme/context"
import { liquidGlassDefaults, useSettings } from "@/context/settings"

const STYLE_ID = "lfcode-liquid-glass"

function ensureStyle() {
  const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (existing) return existing
  const style = document.createElement("style")
  style.id = STYLE_ID
  document.head.appendChild(style)
  return style
}

function removeStyle() {
  document.getElementById(STYLE_ID)?.remove()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function glassCss(input: {
  blur: number
  opacity: number
  highlight: number
  tint: number
  saturation: number
}) {
  const blur = clamp(input.blur, 0, 32)
  const opacity = clamp(input.opacity, 28, 96)
  const highlight = clamp(input.highlight, 0, 100)
  const tint = clamp(input.tint, 0, 100)
  const saturation = clamp(input.saturation, 80, 160)
  const alpha = (opacity / 100).toFixed(2)
  const borderAlpha = (0.08 + (highlight / 100) * 0.24).toFixed(3)
  const glowAlpha = (0.06 + (highlight / 100) * 0.18).toFixed(3)
  const tintRatio = tint / 100
  const tintPercent = Math.round(tintRatio * 100)
  const tintPanelPercent = Math.round(22 + tintRatio * 44)
  const tintRailPercent = Math.round(18 + tintRatio * 36)
  const sheenAlpha = 0.08 + (highlight / 100) * 0.24
  const edgeAlpha = (0.14 + (highlight / 100) * 0.22).toFixed(3)
  const shadowAlpha = (0.34 + (opacity / 100) * 0.18).toFixed(3)
  const ambientAlpha = (0.12 + (tint / 100) * 0.18).toFixed(3)
  const panelGlassAlpha = (0.12 + (opacity / 100) * 0.12).toFixed(3)
  const shellGlassAlpha = (0.08 + (opacity / 100) * 0.1).toFixed(3)
  const frostAlpha = (0.06 + (opacity / 100) * 0.06).toFixed(3)
  const streakAlpha = (0.03 + (highlight / 100) * 0.08).toFixed(3)
  const orbAlpha = (0.12 + (tint / 100) * 0.16).toFixed(3)
  const tintWashAlpha = (0.08 + (tint / 100) * 0.1).toFixed(3)
  const auraAlpha = (0.18 + (highlight / 100) * 0.16).toFixed(3)
  const causticAlpha = (0.1 + (highlight / 100) * 0.12).toFixed(3)
  const prismAlpha = (0.06 + (highlight / 100) * 0.14).toFixed(3)
  const depthAlpha = (0.18 + (opacity / 100) * 0.16).toFixed(3)
  const rimAlpha = (0.2 + (highlight / 100) * 0.18).toFixed(3)
  const coreAlpha = (0.08 + (highlight / 100) * 0.12).toFixed(3)
  const causticLineAlpha = (0.08 + (highlight / 100) * 0.1).toFixed(3)

  return `
html[data-theme="liquid-glass"] {
  --background-base: #0b1220 !important;
  --background-weak: #0f1828 !important;
  --background-strong: #111d2d !important;
  --background-stronger: #142132 !important;
  --surface-base: rgba(17, 27, 41, 0.72) !important;
  --surface-base-hover: rgba(22, 35, 52, 0.82) !important;
  --surface-base-active: rgba(25, 39, 58, 0.9) !important;
  --surface-raised-base: #182536 !important;
  --surface-raised-stronger-non-alpha: #1b2a3c !important;
  --surface-float-base: #1d2d40 !important;
  --surface-float-base-hover: #243549 !important;
  --surface-stronger-non-alpha: #172334 !important;
  --text-base: #c7d7ea !important;
  --text-weak: #96abc3 !important;
  --text-weaker: #6e8199 !important;
  --text-subtle: #8296af !important;
  --text-strong: #f5faff !important;
  --icon-base: #9bb0c7 !important;
  --icon-strong-base: #f1f7ff !important;
  --border-base: rgba(255, 255, 255, 0.14) !important;
  --border-weak-base: rgba(255, 255, 255, 0.1) !important;
  --border-weaker-base: rgba(255, 255, 255, 0.06) !important;
  --border-strong-base: rgba(255, 255, 255, 0.2) !important;
  --liquid-glass-blur: ${blur}px;
  --liquid-glass-opacity: ${alpha};
  --liquid-glass-highlight: ${highlight};
  --liquid-glass-tint: ${tint};
  --liquid-glass-saturation: ${saturation}%;
  --liquid-glass-border: rgba(255, 255, 255, ${borderAlpha});
  --liquid-glass-glow: rgba(255, 255, 255, ${glowAlpha});
  --liquid-glass-edge: rgba(255, 255, 255, ${edgeAlpha});
  --liquid-glass-shadow: rgba(6, 10, 18, ${shadowAlpha});
  --liquid-glass-ambient: rgba(110, 160, 255, ${ambientAlpha});
  --liquid-glass-tint-color: color-mix(in srgb, var(--surface-interactive-base) ${tintPercent}%, transparent);
  --liquid-glass-divider: rgba(255, 255, 255, 0.08);
  --liquid-glass-panel-alpha: rgba(13, 20, 31, ${panelGlassAlpha});
  --liquid-glass-shell-alpha: rgba(10, 16, 26, ${shellGlassAlpha});
  --liquid-glass-frost: rgba(255, 255, 255, ${frostAlpha});
  --liquid-glass-tint-wash: rgba(110, 160, 255, ${tintWashAlpha});
  --liquid-glass-caustic: rgba(255, 255, 255, ${causticAlpha});
  --liquid-glass-aura: rgba(159, 194, 255, ${auraAlpha});
  --liquid-glass-prism: rgba(150, 189, 255, ${prismAlpha});
  --liquid-glass-depth: rgba(8, 13, 22, ${depthAlpha});
  --liquid-glass-rim: rgba(255, 255, 255, ${rimAlpha});
  --liquid-glass-core: rgba(255, 255, 255, ${coreAlpha});
  --liquid-glass-caustic-line: rgba(255, 255, 255, ${causticLineAlpha});
  --liquid-glass-shell-bg:
    radial-gradient(circle at 12% 10%, color-mix(in srgb, var(--surface-interactive-base) 32%, transparent), transparent 34%),
    radial-gradient(circle at 82% 0%, rgba(255, 255, 255, ${sheenAlpha.toFixed(3)}), transparent 28%),
    linear-gradient(132deg, rgba(255, 255, 255, ${Number(prismAlpha) * 0.68}) 0%, transparent 22%, transparent 78%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.42}) 100%),
    linear-gradient(180deg, rgba(7, 12, 20, ${(Number(shellGlassAlpha) + 0.04).toFixed(3)}), rgba(9, 15, 24, ${(Number(shellGlassAlpha) + 0.12).toFixed(3)}));
  --liquid-glass-panel-bg:
    radial-gradient(circle at 8% 0%, rgba(255, 255, 255, ${sheenAlpha.toFixed(3)}), transparent 34%),
    radial-gradient(circle at 100% 12%, rgba(255, 255, 255, ${Number(coreAlpha) * 0.92}), transparent 20%),
    linear-gradient(138deg, color-mix(in srgb, var(--surface-interactive-base) ${tintPanelPercent}%, transparent), transparent 54%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.34}) 100%),
    linear-gradient(180deg, rgba(11, 18, 29, ${(Number(panelGlassAlpha) + 0.04).toFixed(3)}), rgba(15, 24, 37, ${(Number(panelGlassAlpha) + 0.12).toFixed(3)}));
}

html[data-theme="liquid-glass"] {
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--surface-interactive-base) 20%, transparent), transparent 26%),
    radial-gradient(circle at 100% 0%, rgba(255, 255, 255, 0.08), transparent 18%),
    linear-gradient(180deg, color-mix(in srgb, var(--background-stronger) 92%, #081018 8%), color-mix(in srgb, var(--background-base) 96%, #050910 4%));
}

html[data-theme="liquid-glass"] body {
  position: relative;
  background: transparent;
}

html[data-theme="liquid-glass"] body::before,
html[data-theme="liquid-glass"] body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

html[data-theme="liquid-glass"] body::before {
  background:
    radial-gradient(circle at 14% 8%, rgba(95, 141, 199, ${tintWashAlpha}), transparent 18%),
    radial-gradient(circle at 74% 16%, rgba(255, 255, 255, ${(Number(orbAlpha) * 0.58).toFixed(3)}), transparent 10%),
    radial-gradient(circle at 82% 82%, rgba(93, 128, 176, ${(Number(tintWashAlpha) * 0.8).toFixed(3)}), transparent 14%),
    radial-gradient(circle at 36% 70%, rgba(124, 156, 212, ${(Number(auraAlpha) * 0.72).toFixed(3)}), transparent 16%),
    radial-gradient(circle at 46% 24%, rgba(255, 255, 255, ${Number(coreAlpha) * 0.8}), transparent 12%);
  filter: blur(128px) saturate(calc(var(--liquid-glass-saturation) * 0.96));
  opacity: 0.34;
  transform: scale(1.04);
}

html[data-theme="liquid-glass"] body::after {
  background:
    linear-gradient(128deg, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.52).toFixed(3)}) 0%, transparent 26%, transparent 66%, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.34).toFixed(3)}) 100%),
    linear-gradient(180deg, rgba(255, 255, 255, ${Number(causticLineAlpha) * 0.46}) 0%, transparent 18%),
    radial-gradient(circle at 50% -10%, rgba(255, 255, 255, ${(Number(sheenAlpha) * 0.28).toFixed(3)}), transparent 24%);
  opacity: 0.28;
}

html[data-theme="liquid-glass"] [data-component="settings-shell"] {
  position: relative;
  isolation: isolate;
  background:
    linear-gradient(180deg, rgba(5, 9, 16, 0.18), rgba(5, 9, 16, 0.04)) !important;
}

html[data-theme="liquid-glass"] [data-component="settings-shell"]::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 16%, rgba(78, 115, 168, ${tintWashAlpha}), transparent 20%),
    radial-gradient(circle at 72% 10%, rgba(255, 255, 255, ${(Number(orbAlpha) * 0.48).toFixed(3)}), transparent 16%),
    radial-gradient(circle at 82% 78%, rgba(70, 104, 156, ${(Number(tintWashAlpha) * 0.76).toFixed(3)}), transparent 18%),
    radial-gradient(circle at 42% 52%, rgba(104, 144, 206, ${(Number(tintWashAlpha) * 0.72).toFixed(3)}), transparent 24%),
    linear-gradient(120deg, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.42).toFixed(3)}) 0%, transparent 24%, transparent 62%, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.28).toFixed(3)}) 100%);
  filter: blur(calc(var(--liquid-glass-blur) * 1.75)) saturate(calc(var(--liquid-glass-saturation) * 0.98));
  transform: scale(1.05);
  opacity: 0.5;
}

html[data-theme="liquid-glass"] [data-component="settings-shell"]::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255,255,255,${(Number(streakAlpha) * 0.46).toFixed(3)}) 0%, transparent 18%),
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, ${(Number(sheenAlpha) * 0.26).toFixed(3)}), transparent 26%),
    linear-gradient(140deg, transparent 10%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.4}) 36%, transparent 60%);
  opacity: 0.54;
}

html[data-theme="liquid-glass"] [data-component="settings-shell"] > * {
  position: relative;
  z-index: 1;
}

html[data-theme="liquid-glass"] [data-component="dialog"][data-size="x-large"] [data-slot="dialog-content"] {
  background: var(--liquid-glass-shell-bg) !important;
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 94%, transparent);
  box-shadow:
    inset 0 1px 0 0 var(--liquid-glass-rim),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.05),
    inset 14px 18px 34px -28px rgba(255, 255, 255, ${Number(coreAlpha) * 0.96}),
    inset -28px -24px 46px -40px var(--liquid-glass-depth),
    0 26px 80px -38px var(--liquid-glass-shadow),
    0 10px 28px -18px color-mix(in srgb, var(--liquid-glass-ambient) 54%, transparent) !important;
}

html[data-theme="liquid-glass"] [data-component="tabs"][data-variant="settings"][data-orientation="vertical"] [data-slot="tabs-list"] {
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, ${sheenAlpha.toFixed(3)}), transparent 34%),
    radial-gradient(circle at 20% 24%, color-mix(in srgb, var(--surface-interactive-base) ${tintRailPercent}%, transparent), transparent 28%),
    linear-gradient(180deg, rgba(9, 14, 22, ${(Number(panelGlassAlpha) - 0.02).toFixed(3)}), rgba(13, 20, 31, ${(Number(panelGlassAlpha) + 0.05).toFixed(3)})) !important;
  backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.05)) saturate(var(--liquid-glass-saturation));
  -webkit-backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.05)) saturate(var(--liquid-glass-saturation));
  border-right-color: color-mix(in srgb, var(--liquid-glass-border) 96%, transparent) !important;
}

html[data-theme="liquid-glass"] [data-component="tabs"][data-variant="settings"][data-orientation="vertical"] [data-slot="tabs-content"] {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background:
    radial-gradient(circle at 100% 0%, rgba(255, 255, 255, 0.06), transparent 18%),
    radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--surface-interactive-base) 22%, transparent), transparent 24%),
    linear-gradient(180deg, rgba(7, 11, 18, 0.12), rgba(7, 11, 18, 0.03)) !important;
}

html[data-theme="liquid-glass"] [data-component="tabs"][data-variant="settings"][data-orientation="vertical"] [data-slot="tabs-content"]::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 18%, rgba(255,255,255,${(Number(streakAlpha) * 0.46).toFixed(3)}), transparent 14%),
    radial-gradient(circle at 88% 8%, rgba(255,255,255,${(Number(sheenAlpha) * 0.3).toFixed(3)}), transparent 16%),
    radial-gradient(circle at 84% 82%, rgba(86, 123, 176, ${(Number(tintWashAlpha) * 0.72).toFixed(3)}), transparent 18%);
  filter: blur(calc(var(--liquid-glass-blur) * 1.75));
  transform: scale(1.05);
  opacity: 0.46;
}

html[data-theme="liquid-glass"] [data-component="settings-section-card"] {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, ${Number(coreAlpha) * 0.8}), transparent 24%),
    radial-gradient(circle at 100% 0%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.6}), transparent 18%),
    radial-gradient(circle at 80% 0%, color-mix(in srgb, var(--surface-interactive-base) ${Math.max(14, tintPercent - 8)}%, transparent), transparent 24%),
    linear-gradient(180deg, rgba(11, 18, 29, ${(Number(panelGlassAlpha) + 0.04).toFixed(3)}), rgba(15, 23, 36, ${(Number(panelGlassAlpha) + 0.12).toFixed(3)})) !important;
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 88%, transparent);
  box-shadow:
    inset 0 1px 0 0 var(--liquid-glass-rim),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.03),
    inset 18px 20px 28px -30px rgba(255, 255, 255, ${Number(coreAlpha) * 0.92}),
    inset -24px -24px 36px -36px var(--liquid-glass-depth),
    0 18px 46px -34px var(--liquid-glass-shadow),
    0 10px 24px -20px color-mix(in srgb, var(--liquid-glass-ambient) 28%, transparent);
  backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.35)) saturate(calc(var(--liquid-glass-saturation) * 1.08));
  -webkit-backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.35)) saturate(calc(var(--liquid-glass-saturation) * 1.08));
}

html[data-theme="liquid-glass"] [data-component="settings-section-card"]::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 24%),
    linear-gradient(135deg, rgba(255,255,255,0.08), transparent 18%, transparent 76%, rgba(255,255,255,0.04)),
    linear-gradient(118deg, transparent 12%, rgba(255,255,255,${Number(prismAlpha) * 0.54}) 40%, transparent 66%);
}

html[data-theme="liquid-glass"] [data-component="settings-section-card"]::after {
  content: "";
  position: absolute;
  inset: 1px;
  pointer-events: none;
  border-radius: inherit;
  background:
    radial-gradient(circle at 18% 14%, rgba(255, 255, 255, ${frostAlpha}), transparent 16%),
    radial-gradient(circle at 100% 100%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.4}), transparent 24%),
    linear-gradient(180deg, rgba(255,255,255,${streakAlpha}), transparent 16%);
  opacity: 0.94;
}

html[data-theme="liquid-glass"] [data-component="settings-section-card"] > * {
  position: relative;
}

html[data-theme="liquid-glass"] [data-component="settings-section-card"] > :not(:last-child) {
  border-bottom-color: var(--liquid-glass-divider) !important;
}

html[data-theme="liquid-glass"] [data-component="sidebar-rail"],
html[data-theme="liquid-glass"] [data-slot="dialog-content"],
html[data-theme="liquid-glass"] [data-component="toast"],
html[data-theme="liquid-glass"] [data-component="tooltip"],
html[data-theme="liquid-glass"] [data-component="select-content"],
html[data-theme="liquid-glass"] [data-component="dock-surface"],
html[data-theme="liquid-glass"] [data-component="titlebar-surface"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-card"],
html[data-theme="liquid-glass"] [data-component="settings-nav-hero"],
html[data-theme="liquid-glass"] [data-component="settings-nav-footer"],
html[data-theme="liquid-glass"] [data-component="settings-aside-card"],
html[data-theme="liquid-glass"] [data-component="settings-hero-stat"],
html[data-theme="liquid-glass"] [data-component="settings-pill"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-preview"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-panel"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-slider-row"],
html[data-theme="liquid-glass"] .settings-general-hero {
  background: var(--liquid-glass-panel-bg) !important;
  backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.28)) saturate(calc(var(--liquid-glass-saturation) * 1.06));
  -webkit-backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.28)) saturate(calc(var(--liquid-glass-saturation) * 1.06));
  border-color: var(--liquid-glass-border) !important;
  box-shadow:
    inset 0 1px 0 0 var(--liquid-glass-edge),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.03),
    0 18px 44px -28px var(--liquid-glass-shadow),
    0 8px 20px -16px color-mix(in srgb, var(--liquid-glass-ambient) 36%, transparent);
}

html[data-theme="liquid-glass"] [data-component="settings-nav-badge"] {
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 88%, transparent);
  background:
    radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.18) 42%, transparent 58%),
    linear-gradient(135deg, color-mix(in srgb, var(--surface-interactive-base) 72%, transparent), rgba(16, 28, 44, 0.78));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 18px 34px -24px color-mix(in srgb, var(--liquid-glass-ambient) 62%, transparent);
}

html[data-theme="liquid-glass"] [data-component="tabs"][data-variant="settings"][data-orientation="vertical"] [data-slot="tabs-trigger-wrapper"] {
  position: relative;
  overflow: hidden;
}

html[data-theme="liquid-glass"] [data-component="tabs"][data-variant="settings"][data-orientation="vertical"] [data-slot="tabs-trigger-wrapper"]:has([data-selected]) {
  background:
    radial-gradient(circle at 10% 0%, rgba(255, 255, 255, ${frostAlpha}), transparent 26%),
    radial-gradient(circle at 100% 100%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.44}), transparent 18%),
    linear-gradient(180deg, rgba(255, 255, 255, ${streakAlpha}), transparent 24%),
    linear-gradient(180deg, rgba(13, 21, 33, ${(Number(panelGlassAlpha) + 0.08).toFixed(3)}), rgba(15, 24, 37, ${(Number(panelGlassAlpha) + 0.16).toFixed(3)})) !important;
  box-shadow:
    inset 0 1px 0 var(--liquid-glass-rim),
    inset 0 0 0 1px color-mix(in srgb, var(--liquid-glass-border) 82%, transparent),
    inset 10px 12px 22px -18px rgba(255, 255, 255, ${Number(coreAlpha) * 0.86}),
    0 14px 30px -24px color-mix(in srgb, var(--liquid-glass-ambient) 58%, transparent) !important;
}

html[data-theme="liquid-glass"] [data-component="dialog-overlay"] {
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--surface-interactive-base) 10%, transparent), transparent 32%),
    hsl(from var(--background-base) h s l / 0.44);
  backdrop-filter: blur(calc(var(--liquid-glass-blur) * 0.55));
  -webkit-backdrop-filter: blur(calc(var(--liquid-glass-blur) * 0.55));
}

html[data-theme="liquid-glass"] [data-component="sidebar-rail"] {
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, ${sheenAlpha.toFixed(3)}), transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface-raised-stronger-non-alpha) 48%, transparent), color-mix(in srgb, var(--surface-raised-base) 74%, transparent)),
    linear-gradient(180deg, color-mix(in srgb, var(--surface-interactive-base) ${tintRailPercent}%, transparent), transparent 42%) !important;
  box-shadow:
    inset -1px 0 0 rgba(255, 255, 255, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    10px 0 32px -24px color-mix(in srgb, var(--liquid-glass-shadow) 88%, transparent) !important;
}

html[data-theme="liquid-glass"] [data-component="toast"] {
  color: var(--text-strong);
}

html[data-theme="liquid-glass"] [data-component="toast"] [data-slot="toast-title"] {
  color: var(--text-strong);
}

html[data-theme="liquid-glass"] [data-component="toast"] [data-slot="toast-description"],
html[data-theme="liquid-glass"] [data-component="tooltip"],
html[data-theme="liquid-glass"] [data-component="toast"] [data-slot="toast-action"] {
  color: var(--text-base);
}

html[data-theme="liquid-glass"] [data-component="select-content"],
html[data-theme="liquid-glass"] [data-component="tooltip"],
html[data-theme="liquid-glass"] [data-component="toast"],
html[data-theme="liquid-glass"] [data-slot="dialog-content"] {
  overflow: hidden;
  position: relative;
}

html[data-theme="liquid-glass"] [data-component="select-content"]::before,
html[data-theme="liquid-glass"] [data-component="tooltip"]::before,
html[data-theme="liquid-glass"] [data-component="toast"]::before,
html[data-theme="liquid-glass"] [data-slot="dialog-content"]::before,
html[data-theme="liquid-glass"] [data-component="sidebar-rail"]::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255,255,255,${sheenAlpha.toFixed(3)}), rgba(255,255,255,0) 30%),
    linear-gradient(135deg, rgba(255,255,255,0.06), transparent 22%, transparent 72%, rgba(255,255,255,0.04)),
    linear-gradient(118deg, transparent 12%, rgba(255,255,255,${Number(prismAlpha) * 0.5}) 42%, transparent 68%);
}

html[data-theme="liquid-glass"] [data-component="select-content"]::after,
html[data-theme="liquid-glass"] [data-component="tooltip"]::after,
html[data-theme="liquid-glass"] [data-component="toast"]::after,
html[data-theme="liquid-glass"] [data-slot="dialog-content"]::after,
html[data-theme="liquid-glass"] [data-component="sidebar-rail"]::after {
  content: "";
  position: absolute;
  inset: auto 8% 7% auto;
  width: 42%;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--liquid-glass-caustic-line), transparent);
  filter: blur(1.6px);
  opacity: 0.82;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-card"] {
  min-height: 380px;
  background:
    radial-gradient(circle at 100% 0%, rgba(255, 255, 255, 0.16), transparent 24%),
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--surface-interactive-base) 24%, transparent), transparent 28%),
    linear-gradient(132deg, transparent 8%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.38}) 40%, transparent 68%),
    linear-gradient(180deg, rgba(11, 18, 29, ${(Number(panelGlassAlpha) + 0.06).toFixed(3)}), rgba(15, 23, 36, ${(Number(panelGlassAlpha) + 0.14).toFixed(3)})) !important;
  box-shadow:
    inset 0 1px 0 0 var(--liquid-glass-rim),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.03),
    inset 18px 22px 30px -28px rgba(255, 255, 255, ${Number(coreAlpha)}),
    inset -30px -28px 42px -40px var(--liquid-glass-depth),
    0 26px 52px -34px var(--liquid-glass-shadow),
    0 16px 36px -26px color-mix(in srgb, var(--liquid-glass-ambient) 48%, transparent) !important;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview"] {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 86% 12%, rgba(255,255,255,${sheenAlpha.toFixed(3)}), transparent 18%),
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--surface-interactive-base) 22%, transparent), transparent 28%),
    linear-gradient(135deg, transparent 8%, rgba(255,255,255,${Number(prismAlpha) * 0.34}) 42%, transparent 68%),
    linear-gradient(180deg, rgba(11, 18, 29, ${(Number(panelGlassAlpha) + 0.03).toFixed(3)}), rgba(15, 23, 36, ${(Number(panelGlassAlpha) + 0.12).toFixed(3)})) !important;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview"]::after {
  content: "";
  position: absolute;
  inset: -12% -8% auto;
  height: 54%;
  pointer-events: none;
  background:
    radial-gradient(circle at 24% 18%, rgba(255, 255, 255, ${(Number(sheenAlpha) * 0.48).toFixed(3)}), transparent 18%),
    linear-gradient(180deg, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.72).toFixed(3)}), transparent 40%);
  filter: blur(22px);
  opacity: 0.76;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-canvas"] {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 14% 16%, rgba(255,255,255,${frostAlpha}), transparent 18%),
    radial-gradient(circle at 64% 34%, var(--liquid-glass-aura), transparent 22%),
    radial-gradient(circle at 82% 80%, color-mix(in srgb, var(--surface-interactive-base) 24%, transparent), transparent 18%),
    linear-gradient(130deg, rgba(255,255,255,${Number(prismAlpha) * 0.48}) 0%, transparent 26%, transparent 72%, rgba(255,255,255,${Number(prismAlpha) * 0.24}) 100%),
    linear-gradient(180deg, rgba(10, 15, 24, ${(Number(panelGlassAlpha) + 0.06).toFixed(3)}), rgba(12, 18, 28, ${(Number(panelGlassAlpha) + 0.14).toFixed(3)})) !important;
  backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.62)) saturate(calc(var(--liquid-glass-saturation) * 1.12));
  -webkit-backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.62)) saturate(calc(var(--liquid-glass-saturation) * 1.12));
  box-shadow:
    inset 0 1px 0 var(--liquid-glass-rim),
    inset 16px 18px 24px -22px rgba(255,255,255,${Number(coreAlpha) * 0.94}),
    inset -24px -24px 34px -34px var(--liquid-glass-depth),
    0 18px 40px -26px color-mix(in srgb, var(--liquid-glass-shadow) 88%, transparent) !important;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-canvas"]::before {
  content: "";
  position: absolute;
  inset: 4% 8%;
  pointer-events: none;
  border-radius: 22px;
  background:
    radial-gradient(circle at 18% 16%, rgba(255, 255, 255, ${(Number(causticAlpha) * 0.58).toFixed(3)}), transparent 18%),
    radial-gradient(circle at 72% 26%, rgba(255, 255, 255, ${(Number(causticAlpha) * 0.5).toFixed(3)}), transparent 16%),
    linear-gradient(140deg, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.72).toFixed(3)}), transparent 36%, transparent 70%, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.38).toFixed(3)}));
  filter: blur(26px);
  opacity: 0.78;
}

html[data-theme="liquid-glass"] [data-component="settings-hero-stat"],
html[data-theme="liquid-glass"] [data-component="settings-pill"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-slider-row"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-panel"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-float"],
html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-chip"] {
  background:
    radial-gradient(circle at 12% 0%, rgba(255,255,255,${frostAlpha}), transparent 18%),
    radial-gradient(circle at 100% 0%, rgba(255,255,255,${Number(coreAlpha) * 0.86}), transparent 18%),
    linear-gradient(180deg, rgba(255, 255, 255, ${streakAlpha}), transparent 18%),
    linear-gradient(136deg, transparent 8%, rgba(255,255,255,${Number(prismAlpha) * 0.28}) 42%, transparent 68%),
    linear-gradient(180deg, rgba(13, 21, 33, ${(Number(panelGlassAlpha) + 0.09).toFixed(3)}), rgba(15, 24, 37, ${(Number(panelGlassAlpha) + 0.17).toFixed(3)})) !important;
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 88%, transparent);
  box-shadow:
    inset 0 1px 0 var(--liquid-glass-rim),
    inset 12px 14px 20px -18px rgba(255,255,255,${Number(coreAlpha) * 0.88}),
    inset -18px -18px 24px -24px var(--liquid-glass-depth),
    0 18px 34px -28px color-mix(in srgb, var(--liquid-glass-shadow) 88%, transparent);
}

html[data-theme="liquid-glass"] [data-component="settings-nav-hero"],
html[data-theme="liquid-glass"] [data-component="settings-nav-footer"] {
  background:
    radial-gradient(circle at 14% 8%, rgba(255,255,255,${frostAlpha}), transparent 16%),
    linear-gradient(180deg, rgba(255,255,255,${streakAlpha}), transparent 18%),
    linear-gradient(180deg, rgba(13, 20, 31, ${(Number(panelGlassAlpha) + 0.03).toFixed(3)}), rgba(15, 23, 36, ${(Number(panelGlassAlpha) + 0.08).toFixed(3)})) !important;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-orb"] {
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 88%, transparent);
  background:
    radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0.22) 38%, transparent 58%),
    radial-gradient(circle at 76% 72%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.84}), transparent 28%),
    radial-gradient(circle at 72% 72%, color-mix(in srgb, var(--surface-interactive-base) 48%, transparent), transparent 36%),
    linear-gradient(145deg, rgba(18, 30, 46, 0.88), rgba(25, 39, 58, 0.7));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.24),
    inset -6px -8px 18px rgba(255, 255, 255, 0.04),
    inset 8px 8px 12px -10px rgba(255, 255, 255, ${Number(coreAlpha)}),
    0 22px 38px -24px color-mix(in srgb, var(--liquid-glass-ambient) 66%, transparent);
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-line"] {
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 72%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, ${(Number(streakAlpha) * 1.2).toFixed(3)}), transparent 34%),
    linear-gradient(124deg, transparent 12%, rgba(255, 255, 255, ${Number(prismAlpha) * 0.38}) 42%, transparent 68%),
    linear-gradient(90deg, rgba(16, 26, 40, 0.72), rgba(24, 38, 56, 0.46)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 12px 10px 12px -12px rgba(255, 255, 255, ${Number(coreAlpha) * 0.72});
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-focus"] {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 82%, transparent);
  background:
    radial-gradient(circle at 18% 14%, rgba(255, 255, 255, ${(Number(frostAlpha) * 1.3).toFixed(3)}), transparent 18%),
    radial-gradient(circle at 72% 72%, color-mix(in srgb, var(--surface-interactive-base) 34%, transparent), transparent 28%),
    linear-gradient(145deg, rgba(18, 31, 47, 0.76), rgba(24, 38, 57, 0.48)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 12px 12px 18px -16px rgba(255,255,255,${Number(coreAlpha) * 0.96}),
    0 16px 30px -22px color-mix(in srgb, var(--liquid-glass-shadow) 92%, transparent);
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-focus"]::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, ${(Number(streakAlpha) * 0.8).toFixed(3)}), transparent 32%),
    radial-gradient(circle at 70% 26%, rgba(255, 255, 255, ${(Number(causticAlpha) * 0.62).toFixed(3)}), transparent 18%);
  filter: blur(18px);
  opacity: 0.76;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-float"] {
  backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.26)) saturate(calc(var(--liquid-glass-saturation) * 1.08));
  -webkit-backdrop-filter: blur(calc(var(--liquid-glass-blur) * 1.26)) saturate(calc(var(--liquid-glass-saturation) * 1.08));
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-float-orb"] {
  background:
    radial-gradient(circle at 34% 30%, rgba(255,255,255,0.98), rgba(255,255,255,0.24) 38%, transparent 58%),
    radial-gradient(circle at 76% 70%, rgba(255,255,255,${Number(prismAlpha) * 0.82}), transparent 28%),
    linear-gradient(145deg, rgba(18, 31, 47, 0.82), rgba(24, 38, 56, 0.58));
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 88%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.22),
    0 12px 22px -16px color-mix(in srgb, var(--liquid-glass-ambient) 62%, transparent);
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-chip"]::before {
  content: "";
  position: absolute;
  inset: 16px 18px;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255,255,255,${Number(streakAlpha) * 0.82}), transparent 32%),
    linear-gradient(122deg, transparent 14%, rgba(255,255,255,${Number(prismAlpha) * 0.52}) 44%, transparent 70%);
  filter: blur(10px);
  opacity: 0.88;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-preview-caustic"] {
  background:
    linear-gradient(90deg, transparent, rgba(255,255,255,${Number(causticLineAlpha) * 1.24}), transparent),
    radial-gradient(circle at 50% 50%, rgba(255,255,255,${Number(prismAlpha) * 0.68}), transparent 62%);
  filter: blur(10px);
  opacity: 0.94;
}

html[data-theme="liquid-glass"] [data-component="settings-liquid-card"] .settings-liquid-slider {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--surface-interactive-base) 76%, transparent), color-mix(in srgb, var(--surface-raised-stronger-non-alpha) 84%, transparent));
}

html[data-theme="liquid-glass"] [data-component="select"][data-trigger-style="settings"] [data-slot="select-select-trigger"] {
  min-width: 196px;
  height: 36px;
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 86%, transparent);
  border-radius: 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-raised-stronger-non-alpha) 48%, transparent), color-mix(in srgb, var(--background-base) 72%, transparent)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 10px 24px -20px var(--liquid-glass-shadow);
}

html[data-theme="liquid-glass"] [data-component="select"][data-trigger-style="settings"] [data-slot="select-select-trigger-icon"] {
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 76%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
    color-mix(in srgb, var(--surface-raised-base) 70%, transparent) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

html[data-theme="liquid-glass"] [data-component="button"][data-variant="secondary"] {
  border: 1px solid color-mix(in srgb, var(--liquid-glass-border) 82%, transparent);
  background:
    radial-gradient(circle at 16% 0%, rgba(255,255,255,${frostAlpha}), transparent 22%),
    linear-gradient(180deg, rgba(14, 22, 34, ${(Number(panelGlassAlpha) + 0.03).toFixed(3)}), rgba(16, 25, 38, ${(Number(panelGlassAlpha) + 0.08).toFixed(3)})) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 10px 24px -20px var(--liquid-glass-shadow);
}

html[data-theme="liquid-glass"] [data-component="switch"] [data-slot="switch-control"] {
  border-color: color-mix(in srgb, var(--liquid-glass-border) 88%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-raised-base) 70%, transparent), color-mix(in srgb, var(--background-base) 84%, transparent));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
`
}

export function glassStyleText(input: {
  themeId: string
  blur: number
  opacity: number
  highlight: number
  tint: number
  saturation: number
}) {
  if (input.themeId !== "liquid-glass") return ""
  return glassCss(input)
}

export function LiquidGlassThemeBridge() {
  const theme = useTheme()
  const settings = useSettings()

  createEffect(() => {
    if (typeof document === "undefined") return

    const css = glassStyleText({
      themeId: theme.themeId(),
      blur: settings.appearance.liquidGlass.blur(),
      opacity: settings.appearance.liquidGlass.opacity(),
      highlight: settings.appearance.liquidGlass.highlight(),
      tint: settings.appearance.liquidGlass.tint(),
      saturation: settings.appearance.liquidGlass.saturation(),
    })

    if (!css) {
      removeStyle()
      return
    }

    ensureStyle().textContent = css
  })

  onCleanup(removeStyle)
  return null
}

export function isLiquidGlassTheme(themeId: string) {
  return themeId === "liquid-glass"
}

export function resetLiquidGlassValues() {
  return { ...liquidGlassDefaults }
}
