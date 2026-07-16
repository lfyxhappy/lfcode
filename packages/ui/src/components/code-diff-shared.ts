const MAX_DIFF_CHARS = 200_000
const MAX_DIFF_LINES = 5_000

const languageByExtension = new Map<string, string>([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".json", "json"],
  [".jsonc", "json"],
  [".cpp", "cpp"],
  [".cc", "cpp"],
  [".cxx", "cpp"],
  [".c++", "cpp"],
  [".c", "c"],
  [".h", "cpp"],
  [".hpp", "cpp"],
  [".hh", "cpp"],
  [".hxx", "cpp"],
  [".py", "python"],
  [".ps1", "powershell"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".html", "html"],
  [".htm", "html"],
  [".css", "css"],
  [".scss", "scss"],
  [".less", "less"],
  [".sh", "shell"],
  [".bash", "shell"],
  [".zsh", "shell"],
])

export function canUseCodeDiffView(input: { path?: string; before: string; after: string }) {
  const language = getCodeDiffLanguage(input.path)
  if (!language) return false
  const charCount = input.before.length + input.after.length
  if (charCount > MAX_DIFF_CHARS) return false
  const lineCount = countLines(input.before) + countLines(input.after)
  if (lineCount > MAX_DIFF_LINES) return false
  return true
}

export function getCodeDiffLanguage(path?: string) {
  if (!path) return
  const normalized = path.toLowerCase()
  for (const [extension, language] of languageByExtension) {
    if (normalized.endsWith(extension)) return language
  }
}

function countLines(value: string) {
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}
