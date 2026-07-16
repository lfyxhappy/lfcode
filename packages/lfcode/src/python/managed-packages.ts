export const MANAGED_PYTHON_PACKAGE_MANIFEST_VERSION = 1

export const MANAGED_PYTHON_PREINSTALLED_PACKAGES = [
  {
    pip: "httpx",
  },
  {
    pip: "beautifulsoup4",
    importName: "bs4",
  },
  {
    pip: "lxml",
  },
  {
    pip: "pydantic",
  },
  {
    pip: "python-dotenv",
    importName: "dotenv",
  },
  {
    pip: "openpyxl",
  },
  {
    pip: "python-docx",
    importName: "docx",
  },
  {
    pip: "pypdf",
  },
  {
    pip: "pillow",
    importName: "PIL",
  },
  {
    pip: "PyYAML",
    importName: "yaml",
  },
  {
    pip: "tenacity",
  },
] as const

export function managedPythonPackageInstallNames() {
  return MANAGED_PYTHON_PREINSTALLED_PACKAGES.map((item) => item.pip)
}

export function managedPythonPackageSummary() {
  return MANAGED_PYTHON_PREINSTALLED_PACKAGES.map((item) => {
    const importName = "importName" in item ? item.importName : undefined
    if (!importName || importName.toLowerCase() === item.pip.toLowerCase()) return item.pip
    return `${item.pip} (${importName})`
  }).join(", ")
}
