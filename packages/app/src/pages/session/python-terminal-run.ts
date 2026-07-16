import type { useGlobalSDK } from "@/context/global-sdk"
import type { useLanguage } from "@/context/language"
import type { useSDK } from "@/context/sdk"
import type { useTerminal } from "@/context/terminal"
import { showToast } from "@lfcode-ai/ui/toast"
import { formatServerError } from "@/utils/server-errors"

const PYTHON_TERMINAL_TITLE = "Python Run"

type RuntimeManageItem = {
  id: string
  installed: boolean
  path?: string
}

type RuntimeManageState = {
  items?: RuntimeManageItem[]
}

export async function runPythonFileInTerminal(input: {
  sdk: ReturnType<typeof useSDK>
  globalSDK: ReturnType<typeof useGlobalSDK>
  terminal: ReturnType<typeof useTerminal>
  openPanel: () => void
  path: string
  args?: string[]
}) {
  const python = await resolveManagedPythonPath(input.globalSDK)
  if (!python) throw new Error("Managed Python runtime is not installed.")

  const existing = input.terminal.all().find((item) => item.title === PYTHON_TERMINAL_TITLE)
  if (existing) {
    await input.terminal.close(existing.id)
  }

  const id = await input.terminal.create({
    command: python,
    args: [input.path, ...(input.args ?? [])],
    cwd: input.sdk.directory,
    title: PYTHON_TERMINAL_TITLE,
  })
  input.openPanel()
  if (!id) throw new Error("Failed to create Python terminal session.")
  input.terminal.open(id)
  return {
    terminalID: id,
    terminalTitle: PYTHON_TERMINAL_TITLE,
    command: python,
    cwd: input.sdk.directory,
    sourcePath: input.path,
  }
}

export function isMissingManagedPythonError(error: unknown) {
  return readPythonRunErrorMessage(error).includes("Managed Python runtime is not installed")
}

export function promptInstallManagedPythonRuntime(input: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
  onInstalled?: () => void | Promise<void>
}) {
  showToast({
    variant: "error",
    title: input.language.t("session.codeFile.runFailed"),
    description: "当前没有可用的受管 Python 运行时。你可以一键安装，安装完成后再继续运行当前文件。",
    persistent: true,
    actions: [
      {
        label: input.language.t("settings.runtimes.action.installManaged"),
        onClick: () => {
          void installManagedPythonRuntime(input)
        },
      },
    ],
  })
}

async function installManagedPythonRuntime(input: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
  onInstalled?: () => void | Promise<void>
}) {
  try {
    const result = await input.globalSDK.client.global.runtime.install({ id: "python-managed" })
    showToast({
      variant: "success",
      title: input.language.t("settings.runtimes.toast.install.title"),
      description: result.data?.message ?? input.language.t("settings.runtimes.toast.success.description"),
    })
    await input.onInstalled?.()
  } catch (error) {
    showToast({
      variant: "error",
      title: input.language.t("settings.runtimes.toast.install.failed"),
      description: formatServerError(error, input.language.t, input.language.t("common.requestFailed")),
    })
  }
}

async function resolveManagedPythonPath(globalSDK: ReturnType<typeof useGlobalSDK>) {
  const result = await globalSDK.client.global.runtime.manage()
  const state = result.data as RuntimeManageState | undefined
  return state?.items?.find((item) => item.id === "python-managed" && item.installed)?.path
}

function readPythonRunErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

export { PYTHON_TERMINAL_TITLE }
