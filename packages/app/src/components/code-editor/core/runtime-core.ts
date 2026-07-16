import {
  initializeMonacoKernel,
  registerMonacoLanguageSupportHook,
} from "@lfcode-ai/ui/monaco-kernel"
import {
  applyJsonLanguageServiceDefaultsUnsafe,
  applyTypeScriptLanguageServiceDefaultsUnsafe,
} from "@/components/code-editor/core/language-service"

let hooksRegistered = false

export function initializeCodeEditorRuntimeCore() {
  if (!hooksRegistered) {
    hooksRegistered = true
    registerMonacoLanguageSupportHook("json", applyJsonLanguageServiceDefaultsUnsafe)
    registerMonacoLanguageSupportHook("typescript", applyTypeScriptLanguageServiceDefaultsUnsafe)
    registerMonacoLanguageSupportHook("javascript", applyTypeScriptLanguageServiceDefaultsUnsafe)
  }

  return initializeMonacoKernel().then((kernel) => ({
    ...kernel,
    executeProviderCommand: kernel.executeCommand,
  }))
}
