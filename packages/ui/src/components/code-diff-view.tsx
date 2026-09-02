import { createEffect, createMemo, createSignal, ErrorBoundary, onCleanup, Show } from "solid-js"
import { type DiffLineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { useI18n } from "../context/i18n"
import { useTheme } from "../theme"
import { lineInSelectedRange } from "../pierre/selection-bridge"
import { getCodeDiffLanguage } from "./code-diff-shared"
import { initializeCodeDiffRuntime } from "./code-diff-runtime"
import { type LineCommentAnnotationMeta } from "./line-comment-annotations"
import "monaco-editor/min/vs/editor/editor.main.css"
import "./code-diff-view.css"

type MonacoApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js")

type CodeDiffViewProps = {
  path?: string
  before: string
  after: string
  diffStyle?: "split" | "unified"
  heightClass?: string
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  reviewAnnotations?: DiffLineAnnotation<LineCommentAnnotationMeta<unknown>>[]
  renderReviewAnnotation?: (
    annotation: DiffLineAnnotation<LineCommentAnnotationMeta<unknown>>,
  ) => HTMLElement | undefined
  renderHoverUtility?: (getHoveredLine: () => HoveredDiffLine | undefined) => HTMLElement | undefined
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd?: (range: SelectedLineRange | null) => void
  onReady?: VoidFunction
  onUnavailable?: VoidFunction
}

export function CodeDiffView(props: CodeDiffViewProps) {
  return (
    <ErrorBoundary
      fallback={() => {
        try {
          props.onUnavailable?.()
        } catch (error) {
          console.warn("[CodeDiffView] unavailable callback failed", error)
        }
        return null
      }}
    >
      <CodeDiffViewImpl {...props} />
    </ErrorBoundary>
  )
}

function CodeDiffViewImpl(props: CodeDiffViewProps) {
  const i18n = useI18n()
  const theme = useTheme()
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const language = createMemo(() => getCodeDiffLanguage(props.path))
  let host!: HTMLDivElement
  let editor: import("monaco-editor").editor.IStandaloneDiffEditor | undefined
  let originalModel: import("monaco-editor").editor.ITextModel | undefined
  let modifiedModel: import("monaco-editor").editor.ITextModel | undefined
  let originalDecorationIds: string[] = []
  let modifiedDecorationIds: string[] = []
  let originalCommentZones: DiffCommentZone[] = []
  let modifiedCommentZones: DiffCommentZone[] = []
  let disposeHoverUtilities: VoidFunction | undefined
  let disposeSelectionInteractions: VoidFunction | undefined
  let setupToken = 0
  let reportedUnavailable = false
  let activePath: string | undefined
  let activeLanguage: string | undefined
  const instanceID = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)

  const reportCleanupFailure = (resource: string, error: unknown) => {
    console.warn("[CodeDiffView] non-fatal cleanup failure", { resource, error })
  }

  const safeCleanup = (resource: string, cleanup: VoidFunction) => {
    try {
      cleanup()
    } catch (error) {
      reportCleanupFailure(resource, error)
    }
  }

  const disposeModels = () => {
    const activeEditor = editor
    const currentOriginalModel = originalModel
    const currentModifiedModel = modifiedModel
    const currentOriginalZones = originalCommentZones
    const currentModifiedZones = modifiedCommentZones
    const currentOriginalDecorationIds = originalDecorationIds
    const currentModifiedDecorationIds = modifiedDecorationIds
    const disposeHover = disposeHoverUtilities
    disposeHoverUtilities = undefined
    originalModel = undefined
    modifiedModel = undefined
    originalCommentZones = []
    modifiedCommentZones = []
    originalDecorationIds = []
    modifiedDecorationIds = []
    activePath = undefined
    activeLanguage = undefined

    safeCleanup("hover utilities", () => disposeHover?.())
    safeCleanup("original comment zones", () => {
      try {
        disposeCommentZones(activeEditor?.getOriginalEditor(), currentOriginalZones)
      } catch (error) {
        reportCleanupFailure("original comment zones", error)
        disposeCommentZones(undefined, currentOriginalZones)
      }
    })
    safeCleanup("modified comment zones", () => {
      try {
        disposeCommentZones(activeEditor?.getModifiedEditor(), currentModifiedZones)
      } catch (error) {
        reportCleanupFailure("modified comment zones", error)
        disposeCommentZones(undefined, currentModifiedZones)
      }
    })
    safeCleanup("original decorations", () => {
      activeEditor?.getOriginalEditor().deltaDecorations(currentOriginalDecorationIds, [])
    })
    safeCleanup("modified decorations", () => {
      activeEditor?.getModifiedEditor().deltaDecorations(currentModifiedDecorationIds, [])
    })
    safeCleanup("diff editor model", () => activeEditor?.setModel(null))
    safeCleanup("original model", () => currentOriginalModel?.dispose())
    safeCleanup("modified model", () => currentModifiedModel?.dispose())
  }

  const disposeEditor = () => {
    const activeEditor = editor
    const disposeSelection = disposeSelectionInteractions
    disposeSelectionInteractions = undefined
    disposeModels()
    editor = undefined
    safeCleanup("selection interactions", () => disposeSelection?.())
    safeCleanup("diff editor", () => activeEditor?.dispose())
  }

  const clearHighlightDecorations = () => {
    if (!editor) {
      originalDecorationIds = []
      modifiedDecorationIds = []
      return
    }
    const currentEditor = editor
    const original = originalDecorationIds
    const modified = modifiedDecorationIds
    originalDecorationIds = []
    modifiedDecorationIds = []
    safeCleanup("original decorations", () => {
      currentEditor.getOriginalEditor().deltaDecorations(original, [])
    })
    safeCleanup("modified decorations", () => {
      currentEditor.getModifiedEditor().deltaDecorations(modified, [])
    })
  }

  const clearCommentZones = () => {
    const currentEditor = editor
    const original = originalCommentZones
    const modified = modifiedCommentZones
    originalCommentZones = []
    modifiedCommentZones = []
    safeCleanup("original comment zones", () => {
      try {
        disposeCommentZones(currentEditor?.getOriginalEditor(), original)
      } catch (error) {
        reportCleanupFailure("original comment zones", error)
        disposeCommentZones(undefined, original)
      }
    })
    safeCleanup("modified comment zones", () => {
      try {
        disposeCommentZones(currentEditor?.getModifiedEditor(), modified)
      } catch (error) {
        reportCleanupFailure("modified comment zones", error)
        disposeCommentZones(undefined, modified)
      }
    })
  }

  const syncRuntimeConfiguration = async () => {
    const runtime = await initializeCodeDiffRuntime()
    await runtime.syncConfiguration({
      theme: theme.mode() === "dark" ? "dark" : "light",
      fontSize: 13,
      wordWrap: true,
    })
    return runtime
  }

  const markUnavailable = () => {
    if (reportedUnavailable) return
    reportedUnavailable = true
    setupToken += 1
    setReady(false)
    disposeEditor()
    setFailed(true)
    safeCleanup("unavailable callback", () => props.onUnavailable?.())
  }

  const setupEditor = async () => {
    const token = ++setupToken
    reportedUnavailable = false
    setReady(false)
    setFailed(false)
    const nextLanguage = language()
    if (!host) return
    if (!nextLanguage) {
      markUnavailable()
      return
    }

    try {
      const runtime = await syncRuntimeConfiguration()
      await runtime.ensureLanguageSupport(nextLanguage)
      if (token !== setupToken) return

      disposeModels()
      const nextOriginalModel = runtime.createModel(
        props.before,
        nextLanguage,
        runtime.monaco.Uri.from({
          scheme: "lfcode-diff",
          authority: "original",
          path: `/${instanceID}/${(props.path ?? "diff").replaceAll("\\", "/").replace(/^\/+/, "")}`,
        }),
      )
      const nextModifiedModel = runtime.createModel(
        props.after,
        nextLanguage,
        runtime.monaco.Uri.from({
          scheme: "lfcode-diff",
          authority: "modified",
          path: `/${instanceID}/${(props.path ?? "diff").replaceAll("\\", "/").replace(/^\/+/, "")}`,
        }),
      )
      originalModel = nextOriginalModel
      modifiedModel = nextModifiedModel
      activePath = props.path
      activeLanguage = nextLanguage
      if (!editor) {
        editor = runtime.createDiffEditor(host, {
          automaticLayout: true,
          readOnly: true,
          originalEditable: false,
          renderSideBySide: props.diffStyle !== "unified",
          enableSplitViewResizing: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          lineNumbers: "on",
          renderOverviewRuler: false,
          glyphMargin: false,
          folding: true,
          wordWrap: "on",
          fontFamily: "var(--font-family-mono)",
          fontSize: 13,
          lineHeight: 22,
        })
        disposeSelectionInteractions = bindDiffSelectionInteractions(runtime.monaco, editor, props)
      }
      const activeEditor = editor
      activeEditor.setModel({
        original: nextOriginalModel,
        modified: nextModifiedModel,
      })
      setReady(true)
      props.onReady?.()
    } catch {
      if (token !== setupToken) return
      markUnavailable()
    }
  }


  createEffect(() => {
    const nextLanguage = language()
    props.path
    if (!host || !nextLanguage) return
    void setupEditor()
  })

  createEffect(() => {
    const nextLanguage = language()
    const nextBefore = props.before
    const nextAfter = props.after
    if (!ready() || !editor || !originalModel || !modifiedModel || !nextLanguage) return
    if (activeLanguage !== nextLanguage || activePath !== props.path) {
      void setupEditor()
      return
    }
    if (originalModel.getValue() !== nextBefore) originalModel.setValue(nextBefore)
    if (modifiedModel.getValue() !== nextAfter) modifiedModel.setValue(nextAfter)
  })

  createEffect(() => {
    theme.mode()
    if (!ready()) return
    const token = setupToken
    void syncRuntimeConfiguration().catch(() => {
      if (token !== setupToken || !ready()) return
      markUnavailable()
    })
  })

  createEffect(() => {
    const mode = props.diffStyle !== "unified"
    if (!editor) return
    try {
      editor.updateOptions({ renderSideBySide: mode })
    } catch {
      markUnavailable()
    }
  })

  createEffect(() => {
    const selected = props.selectedLines ?? null
    const commented = props.commentedLines ?? []
    if (!ready() || !editor) return

    const activeEditor = editor
    const token = setupToken
    void initializeCodeDiffRuntime().then((runtime) => {
      if (token !== setupToken || activeEditor !== editor) return
      const decorations = createDiffHighlightDecorations(runtime.monaco, {
        selected,
        commented,
      })
      originalDecorationIds = activeEditor
        .getOriginalEditor()
        .deltaDecorations(originalDecorationIds, decorations.original)
      modifiedDecorationIds = activeEditor
        .getModifiedEditor()
        .deltaDecorations(modifiedDecorationIds, decorations.modified)
    }).catch(() => {
      if (token !== setupToken || activeEditor !== editor) return
      markUnavailable()
    })
  })

  createEffect(() => {
    const selected = props.selectedLines ?? null
    if (!ready() || !editor || !selected) return
    try {
      revealSelectedRange(editor, selected)
    } catch {
      markUnavailable()
    }
  })

  createEffect(() => {
    const annotations = props.reviewAnnotations ?? []
    const renderAnnotation = props.renderReviewAnnotation
    if (!ready() || !editor || !renderAnnotation) {
      clearCommentZones()
      return
    }

    try {
      originalCommentZones = syncCommentZones(
        editor.getOriginalEditor(),
        originalCommentZones,
        annotations.filter((annotation) => annotation.side === "deletions"),
        renderAnnotation,
      )
      modifiedCommentZones = syncCommentZones(
        editor.getModifiedEditor(),
        modifiedCommentZones,
        annotations.filter((annotation) => (annotation.side ?? "additions") === "additions"),
        renderAnnotation,
      )
    } catch {
      markUnavailable()
    }
  })

  createEffect(() => {
    const renderHoverUtility = props.renderHoverUtility
    if (!ready() || !editor || !renderHoverUtility) {
      safeCleanup("hover utilities", () => disposeHoverUtilities?.())
      disposeHoverUtilities = undefined
      return
    }

    const activeEditor = editor
    const token = setupToken
    void initializeCodeDiffRuntime().then((runtime) => {
      if (token !== setupToken || activeEditor !== editor) return
      safeCleanup("hover utilities", () => disposeHoverUtilities?.())
      disposeHoverUtilities = bindDiffHoverUtilities(runtime.monaco, activeEditor, renderHoverUtility)
    }).catch(() => {
      if (token !== setupToken || activeEditor !== editor) return
      markUnavailable()
    })
  })

  onCleanup(() => {
    setupToken += 1
    disposeEditor()
  })

  return (
    <div
      class={`relative overflow-hidden rounded-lg border border-border-weak-base bg-background-base ${props.heightClass ?? ""}`}
      style={props.heightClass ? undefined : { height: "420px" }}
    >
      <Show when={!ready() && !failed()}>
        <div class="absolute inset-0 z-10 flex items-center justify-center text-12-regular text-text-weak">
          {i18n.t("ui.codeDiff.loading")}
        </div>
      </Show>
      <Show when={failed()}>
        <div class="absolute inset-0 overflow-auto p-4 text-12-regular text-text-weak">
          {i18n.t("ui.codeDiff.unavailable")}
        </div>
      </Show>
      <div ref={(el) => (host = el)} class="h-full min-h-0 w-full" />
    </div>
  )
}

function revealSelectedRange(
  diffEditor: import("monaco-editor").editor.IStandaloneDiffEditor,
  range: SelectedLineRange,
) {
  const line = Math.max(1, Math.min(range.start, range.end))
  const side = range.side ?? range.endSide ?? "additions"
  const target = side === "deletions" ? diffEditor.getOriginalEditor() : diffEditor.getModifiedEditor()
  target.revealLineInCenter(line)
}

function createDiffHighlightDecorations(
  monaco: MonacoApi,
  input: {
    selected: SelectedLineRange | null
    commented: SelectedLineRange[]
  },
) {
  return {
    original: createSideDecorations(monaco, "deletions", input),
    modified: createSideDecorations(monaco, "additions", input),
  }
}

function createSideDecorations(
  monaco: MonacoApi,
  side: "deletions" | "additions",
  input: {
    selected: SelectedLineRange | null
    commented: SelectedLineRange[]
  },
) {
  const lineStates = new Map<number, { commented: boolean; selected: boolean }>()
  for (const range of input.commented) {
    applyRangeState(lineStates, range, side, "commented")
  }
  if (input.selected) {
    applyRangeState(lineStates, input.selected, side, "selected")
  }

  return Array.from(lineStates.entries()).map(([line, state]) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: true,
      className: buildDecorationClassName(state),
      linesDecorationsClassName: buildGutterClassName(state),
    },
  }))
}

function applyRangeState(
  target: Map<number, { commented: boolean; selected: boolean }>,
  range: SelectedLineRange,
  side: "deletions" | "additions",
  field: "commented" | "selected",
) {
  const first = Math.max(1, Math.min(range.start, range.end))
  const last = Math.max(range.start, range.end)
  for (let line = first; line <= last; line++) {
    if (!lineInSelectedRange(range, line, side)) continue
    const state = target.get(line) ?? { commented: false, selected: false }
    state[field] = true
    target.set(line, state)
  }
}

function buildDecorationClassName(state: { commented: boolean; selected: boolean }) {
  const classes = ["lfcode-code-diff-line-highlight"]
  if (state.commented) classes.push("lfcode-code-diff-line-commented")
  if (state.selected) classes.push("lfcode-code-diff-line-selected")
  return classes.join(" ")
}

function buildGutterClassName(state: { commented: boolean; selected: boolean }) {
  if (state.selected) return "lfcode-code-diff-gutter-selected"
  if (state.commented) return "lfcode-code-diff-gutter-commented"
  return undefined
}

type DiffCommentZone = {
  key: string
  id: string
  lineNumber: number
  host: HTMLElement
  zone: import("monaco-editor").editor.IViewZone & { heightInPx: number }
  observer: ResizeObserver
  disposed: boolean
  frame?: number
}

type DiffCommentZoneOperation =
  | { type: "keep"; zone: DiffCommentZone }
  | {
      type: "create"
      key: string
      lineNumber: number
      host: HTMLElement
      zone?: DiffCommentZone
    }

type HoveredDiffLine = {
  lineNumber: number
  side: "deletions" | "additions"
}

function bindDiffSelectionInteractions(
  monaco: MonacoApi,
  diffEditor: import("monaco-editor").editor.IStandaloneDiffEditor,
  props: {
    onLineSelected?: (range: SelectedLineRange | null) => void
    onLineSelectionEnd?: (range: SelectedLineRange | null) => void
    onLineNumberSelectionEnd?: (range: SelectedLineRange | null) => void
  },
) {
  const disposables = [
    bindSideSelectionInteractions(monaco, diffEditor.getOriginalEditor(), "deletions", props),
    bindSideSelectionInteractions(monaco, diffEditor.getModifiedEditor(), "additions", props),
  ]
  return () => {
    for (const dispose of disposables) {
      try {
        dispose()
      } catch (error) {
        console.warn("[CodeDiffView] selection listener cleanup failed", error)
      }
    }
  }
}

function bindDiffHoverUtilities(
  monaco: MonacoApi,
  diffEditor: import("monaco-editor").editor.IStandaloneDiffEditor,
  renderHoverUtility: (getHoveredLine: () => HoveredDiffLine | undefined) => HTMLElement | undefined,
) {
  const cleanups = [
    bindSideHoverUtility(monaco, diffEditor.getOriginalEditor(), "deletions", renderHoverUtility),
    bindSideHoverUtility(monaco, diffEditor.getModifiedEditor(), "additions", renderHoverUtility),
  ]
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch (error) {
        console.warn("[CodeDiffView] hover cleanup failed", error)
      }
    }
  }
}

function bindSideSelectionInteractions(
  monaco: MonacoApi,
  editor: import("monaco-editor").editor.IStandaloneCodeEditor,
  side: "deletions" | "additions",
  props: {
    onLineSelected?: (range: SelectedLineRange | null) => void
    onLineSelectionEnd?: (range: SelectedLineRange | null) => void
    onLineNumberSelectionEnd?: (range: SelectedLineRange | null) => void
  },
) {
  let lastMouseTargetType: number | undefined
  const selection = editor.onDidChangeCursorSelection(() => {
    props.onLineSelected?.(readEditorLineRange(editor, side))
  })
  const mouseDown = editor.onMouseDown((event) => {
    lastMouseTargetType = event.target.type
  })
  const mouseUp = editor.onMouseUp(() => {
    const range = readEditorLineRange(editor, side)
    props.onLineSelectionEnd?.(range)
    if (!isLineNumberTarget(monaco, lastMouseTargetType)) return
    requestAnimationFrame(() => props.onLineNumberSelectionEnd?.(range))
  })
  return () => {
    selection.dispose()
    mouseDown.dispose()
    mouseUp.dispose()
  }
}

function bindSideHoverUtility(
  monaco: MonacoApi,
  editor: import("monaco-editor").editor.IStandaloneCodeEditor,
  side: "deletions" | "additions",
  renderHoverUtility: (getHoveredLine: () => HoveredDiffLine | undefined) => HTMLElement | undefined,
) {
  let hoveredLine: HoveredDiffLine | undefined
  const button = renderHoverUtility(() => hoveredLine)
  if (!button) return () => {}

  button.classList.add("lfcode-code-diff-hover-utility")
  button.setAttribute("data-side", side)
  const widget = {
    allowEditorOverflow: true,
    getId: () => `lfcode-code-diff-hover-utility:${side}`,
    getDomNode: () => button,
    getPosition: () =>
      hoveredLine
        ? {
            position: { lineNumber: hoveredLine.lineNumber, column: 1 },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          }
        : null,
  } satisfies import("monaco-editor").editor.IContentWidget

  editor.addContentWidget(widget)

  const hide = () => {
    if (!hoveredLine) return
    hoveredLine = undefined
    editor.layoutContentWidget(widget)
  }

  const show = (lineNumber: number) => {
    if (hoveredLine?.lineNumber === lineNumber) return
    hoveredLine = { lineNumber, side }
    editor.layoutContentWidget(widget)
  }

  const move = editor.onMouseMove((event) => {
    if (!isHoverUtilityTarget(monaco, event.target.type)) {
      hide()
      return
    }
    const lineNumber = event.target.position?.lineNumber ?? event.target.range?.startLineNumber
    if (!lineNumber) {
      hide()
      return
    }
    show(lineNumber)
  })
  const leave = editor.onMouseLeave(() => {
    hide()
  })
  const model = editor.onDidChangeModel(() => {
    hide()
  })

  return () => {
    hoveredLine = undefined
    move.dispose()
    leave.dispose()
    model.dispose()
    editor.removeContentWidget(widget)
    button.remove()
  }
}

function readEditorLineRange(
  editor: import("monaco-editor").editor.IStandaloneCodeEditor,
  side: "deletions" | "additions",
): SelectedLineRange | null {
  const selection = editor.getSelection()
  if (!selection) return null
  return {
    start: selection.startLineNumber,
    end: selection.endLineNumber,
    side,
    endSide: side,
  }
}

function isLineNumberTarget(monaco: MonacoApi, targetType: number | undefined) {
  return (
    targetType === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
    targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
    targetType === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
  )
}

function isHoverUtilityTarget(monaco: MonacoApi, targetType: number | undefined) {
  return (
    targetType === monaco.editor.MouseTargetType.CONTENT_TEXT ||
    targetType === monaco.editor.MouseTargetType.CONTENT_EMPTY ||
    targetType === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
    targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
    targetType === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
  )
}

function syncCommentZones(
  codeEditor: import("monaco-editor").editor.IStandaloneCodeEditor,
  existing: DiffCommentZone[],
  annotations: DiffLineAnnotation<LineCommentAnnotationMeta<unknown>>[],
  renderAnnotation: (
    annotation: DiffLineAnnotation<LineCommentAnnotationMeta<unknown>>,
  ) => HTMLElement | undefined,
) {
  const byKey = new Map(existing.map((zone) => [zone.key, zone]))
  const retained = new Set<string>()
  const stale = new Map<string, DiffCommentZone>()
  const operations: DiffCommentZoneOperation[] = []
  for (const annotation of annotations.slice().sort((a, b) => a.lineNumber - b.lineNumber)) {
    const key = annotation.metadata.key
    const host = renderAnnotation(annotation)
    if (!host) continue
    host.setAttribute("data-slot", "code-diff-inline-comment")
    const current = byKey.get(key)
    if (current && current.lineNumber === annotation.lineNumber && current.host === host) {
      retained.add(key)
      operations.push({ type: "keep", zone: current })
      continue
    }

    if (current) stale.set(key, current)
    retained.add(key)
    operations.push({ type: "create", key, lineNumber: annotation.lineNumber, host })
  }

  for (const zone of existing) {
    if (retained.has(zone.key)) continue
    stale.set(zone.key, zone)
  }

  if (stale.size > 0 || operations.some((operation) => operation.type === "create")) {
    codeEditor.changeViewZones((accessor) => {
      for (const zone of stale.values()) {
        disposeSingleCommentZone(accessor, zone)
      }
      for (const operation of operations) {
        if (operation.type !== "create") continue
        operation.zone = createCommentZone(accessor, codeEditor, operation.key, operation.lineNumber, operation.host)
      }
    })
  }

  return operations.flatMap((operation) => (operation.type === "keep" ? [operation.zone] : operation.zone ? [operation.zone] : []))
}

function disposeCommentZones(
  codeEditor: import("monaco-editor").editor.IStandaloneCodeEditor | undefined,
  existing: DiffCommentZone[],
  next: DiffCommentZone[] = [],
) {
  if (codeEditor) {
    codeEditor.changeViewZones((accessor) => {
      for (const zone of existing) disposeSingleCommentZone(accessor, zone)
    })
    return next
  }
  for (const zone of existing) disposeSingleCommentZone(undefined, zone)
  return next
}

function measureCommentZoneHeight(host: HTMLElement) {
  return Math.max(48, Math.ceil(host.getBoundingClientRect().height || host.offsetHeight || 48))
}

function createCommentZone(
  accessor: import("monaco-editor").editor.IViewZoneChangeAccessor,
  codeEditor: import("monaco-editor").editor.IStandaloneCodeEditor,
  key: string,
  lineNumber: number,
  host: HTMLElement,
) {
  let entry: DiffCommentZone
  const zone = {
    afterLineNumber: lineNumber,
    heightInPx: measureCommentZoneHeight(host),
    domNode: host,
    suppressMouseDown: false,
  } satisfies import("monaco-editor").editor.IViewZone & { heightInPx: number }
  const id = accessor.addZone(zone)
  if (!id) return
  const observer = new ResizeObserver(() => {
    const nextHeight = measureCommentZoneHeight(host)
    if (nextHeight === zone.heightInPx) return
    zone.heightInPx = nextHeight
    if (entry.frame !== undefined) cancelAnimationFrame(entry.frame)
    entry.frame = requestAnimationFrame(() => {
      entry.frame = undefined
      codeEditor.changeViewZones((accessor) => {
        accessor.layoutZone(id)
      })
    })
  })
  observer.observe(host)
  entry = {
    key,
    id,
    lineNumber,
    host,
    zone,
    observer,
    disposed: false,
  } satisfies DiffCommentZone
  return entry
}

function disposeSingleCommentZone(
  accessor: import("monaco-editor").editor.IViewZoneChangeAccessor | undefined,
  zone: DiffCommentZone,
) {
  if (zone.disposed) return
  zone.disposed = true
  if (zone.frame !== undefined) cancelAnimationFrame(zone.frame)
  zone.observer.disconnect()
  accessor?.removeZone(zone.id)
}
