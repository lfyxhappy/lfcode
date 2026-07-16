import { initializeMonacoKernel } from "./monaco-kernel"

export function initializeCodeDiffRuntime() {
  return initializeMonacoKernel().then((kernel) => ({
    monaco: kernel.monaco,
    createDiffEditor: kernel.createDiffEditor,
    createModel: kernel.createModel,
    syncConfiguration: (input: { theme: "light" | "dark"; fontSize?: number; wordWrap?: boolean }) =>
      kernel.syncConfiguration({ theme: input.theme }),
    ensureLanguageSupport: kernel.ensureLanguageSupport,
  }))
}
