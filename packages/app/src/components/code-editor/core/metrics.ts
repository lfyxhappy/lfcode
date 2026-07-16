type CodeEditorMetricStage =
  | "runtime:start"
  | "runtime:ready"
  | "model:start"
  | "model:ready"
  | "editor:start"
  | "editor:ready"
  | "editor:failed"

type CodeEditorMetric = {
  stage: CodeEditorMetricStage
  path?: string
  language?: string
  at: number
  duration?: number
}

const EVENT_NAME = "lfcode:code-editor-phase0-metric"

export function emitCodeEditorMetric(metric: CodeEditorMetric) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new window.CustomEvent(EVENT_NAME, { detail: metric }))
}

export type { CodeEditorMetric, CodeEditorMetricStage }

export function startCodeEditorMetric(stage: Extract<CodeEditorMetricStage, `${string}:start`>, input: {
  path?: string
  language?: string
}) {
  const at = performance.now()
  emitCodeEditorMetric({
    stage,
    path: input.path,
    language: input.language,
    at,
  })
  return (nextStage: Exclude<CodeEditorMetricStage, `${string}:start`>) => {
    const nextAt = performance.now()
    emitCodeEditorMetric({
      stage: nextStage,
      path: input.path,
      language: input.language,
      at: nextAt,
      duration: nextAt - at,
    })
  }
}

export function getCodeEditorMetricEventName() {
  return EVENT_NAME
}
