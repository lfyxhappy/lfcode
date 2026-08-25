;(function () {
  var key = "lfcode-theme-id"
  var themeId = localStorage.getItem(key) || "lfcode"

  var legacyIds = [
    "oc-1", "oc-2", "amoled", "aura", "ayu", "carbonfox", "catppuccin", "catppuccin-frappe",
    "catppuccin-macchiato", "cobalt2", "cursor", "dracula", "everforest", "flexoki", "github", "gruvbox",
    "kanagawa", "liquid-glass", "lucent-orng", "material", "matrix", "mercury", "monokai", "nightowl",
    "nord", "one-dark", "onedarkpro", "orng", "osaka-jade", "palenight", "rosepine", "shadesofpurple",
    "solarized", "synthwave84", "tokyonight", "vercel", "vesper", "zenburn"
  ]

  if (legacyIds.includes(themeId)) {
    themeId = "lfcode"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("lfcode-theme-css-light")
    localStorage.removeItem("lfcode-theme-css-dark")
  }

  // Remote browser sessions should visually match the desktop app on their
  // first visit. An explicit browser preference still takes precedence.
  var scheme = localStorage.getItem("lfcode-color-scheme") || "dark"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  if (themeId === "lfcode") return

  var css = localStorage.getItem("lfcode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
