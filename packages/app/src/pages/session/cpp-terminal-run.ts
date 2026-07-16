import type { useSDK } from "@/context/sdk"
import type { useTerminal } from "@/context/terminal"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useLanguage } from "@/context/language"
import { showToast } from "@lfcode-ai/ui/toast"
import { formatServerError } from "@/utils/server-errors"

const CPP_TERMINAL_TITLE = "C++ Run"

export async function runCppFileInTerminal(input: {
  sdk: ReturnType<typeof useSDK>
  terminal: ReturnType<typeof useTerminal>
  openPanel: () => void
  path: string
  args?: string[]
}) {
  const prepared = await input.sdk.client.cpp.prepareTerminalRun({
    path: input.path,
    args: input.args,
  })
  const payload = prepared.data
  if (!payload) throw new Error("C++ terminal run payload was empty.")

  const existing = input.terminal.all().find((item) => item.title === CPP_TERMINAL_TITLE)
  if (existing) {
    await input.terminal.close(existing.id)
  }

  const id = await input.terminal.create({
    args: ["-NoExit", "-Command", payload.command],
    cwd: payload.cwd,
    title: payload.terminalTitle,
  })
  input.openPanel()
  if (!id) throw new Error("Failed to create C++ terminal session.")
  input.terminal.open(id)
  return {
    terminalID: id,
    terminalTitle: payload.terminalTitle,
    command: payload.command,
    cwd: payload.cwd,
    sourcePath: payload.sourcePath,
    outputPath: payload.outputPath,
  }
}

export function isMissingCppCompilerError(error: unknown) {
  return readCppRunErrorMessage(error).includes("No C++ compiler was found")
}

export function promptInstallManagedCppCompiler(input: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
  onInstalled?: () => void | Promise<void>
}) {
  showToast({
    variant: "error",
    title: input.language.t("session.cppFile.runFailed"),
    description:
      "当前没有可用的 C++ 编译器。你可以一键安装受管 MinGW，安装完成后再继续运行当前文件。",
    persistent: true,
    actions: [
      {
        label: input.language.t("settings.runtimes.action.installManaged"),
        onClick: () => {
          void installManagedCppCompiler(input)
        },
      },
    ],
  })
}

async function installManagedCppCompiler(input: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
  onInstalled?: () => void | Promise<void>
}) {
  try {
    const result = await input.globalSDK.client.global.runtime.install({ id: "cpp-compiler" })
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

function readCppRunErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

export { CPP_TERMINAL_TITLE }
