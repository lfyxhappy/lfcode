import type { DesktopTheme } from "./types"
import lfcodeThemeJson from "./themes/lfcode.json"

export const lfcodeTheme = lfcodeThemeJson as DesktopTheme

// Web and desktop deliberately ship one canonical theme. Extensions can still
// register additional themes at runtime through ThemeProvider.
export const DEFAULT_THEMES: Record<"lfcode", DesktopTheme> = {
  lfcode: lfcodeTheme,
}
