const PYTHON_RUNNABLE_EXTENSIONS = [".py", ".pyw"]

function normalizedPath(path?: string) {
  return typeof path === "string" ? path.toLowerCase() : ""
}

export function isPythonRunnablePath(path?: string) {
  const value = normalizedPath(path)
  return PYTHON_RUNNABLE_EXTENSIONS.some((ext) => value.endsWith(ext))
}
