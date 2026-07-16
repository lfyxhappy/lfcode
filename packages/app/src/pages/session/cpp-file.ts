const CPP_EDITABLE_EXTENSIONS = [".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx"]
const CPP_RUNNABLE_EXTENSIONS = [".cpp", ".cc", ".cxx", ".c++"]

function normalizedPath(path?: string) {
  return typeof path === "string" ? path.toLowerCase() : ""
}

export function isCppEditablePath(path?: string) {
  const value = normalizedPath(path)
  return CPP_EDITABLE_EXTENSIONS.some((ext) => value.endsWith(ext))
}

export function isCppRunnablePath(path?: string) {
  const value = normalizedPath(path)
  return CPP_RUNNABLE_EXTENSIONS.some((ext) => value.endsWith(ext))
}
