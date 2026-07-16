import "@/index.css"
import { I18nProvider } from "@lfcode-ai/ui/context"
import { DialogProvider } from "@lfcode-ai/ui/context/dialog"
import { FileComponentProvider } from "@lfcode-ai/ui/context/file"
import { MarkedProvider } from "@lfcode-ai/ui/context/marked"
import { File } from "@lfcode-ai/ui/file"
import { Font } from "@lfcode-ai/ui/font"
import { ThemeProvider } from "@lfcode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import {
  type Component,
  ErrorBoundary,
  type JSX,
  lazy,
  type ParentProps,
  Show,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { ServerConnection, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ConnectionGate } from "@/components/connection-gate"
import { LiquidGlassThemeBridge } from "@/components/liquid-glass-theme"
import type {
  UiDriverEditorInput,
  UiDriverNodeSnapshot,
  UiDriverQueryInput,
  UiDriverReadTextInput,
  UiDriverTypeInput,
  UiDriverWaitInput,
} from "@/automation/ui-driver"
import { ErrorPage } from "./pages/error"
import type { DetachedSidePanelContext } from "./pages/session/detached-side-panel"

const HomeRoute = lazy(() => import("@/pages/home"))
const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)

if (typeof location === "object" && /\/session(?:\/|$)/.test(location.pathname)) {
  void loadSession()
}

const SessionRoute = () => <Session />

const SessionIndexRoute = () => <Navigate href="session" />

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  type LfcodeCodeEditorAutomationSelection = {
    startLineNumber: number
    startColumn: number
    endLineNumber?: number
    endColumn?: number
  }

  type LfcodeCodeEditorAutomationDiagnostic = {
    severity: "error" | "warning"
    message: string
    line: number
    column: number
    source?: string
    code?: string
  }

  type LfcodeCodeEditorAutomationState = {
    implementation: "phase0"
    path: string
    language: string
    requestedLanguage: string
    modelURI?: string
    compatibilityRuntimeInitialized: boolean
    value: string
    selection?: LfcodeCodeEditorAutomationSelection
    cursor?: { line: number; column: number }
    diagnostics: {
      errors: number
      warnings: number
      items: LfcodeCodeEditorAutomationDiagnostic[]
      open: boolean
    }
  }

  type LfcodeCodeEditorAutomationHoverItem = {
    id: string
    kind: "text" | "markdown" | "code"
    text: string
    language?: string
  }

  type LfcodeCodeEditorAutomationNavigationTarget = {
    id: string
    path: string
    label: string
    detail: string
    selection: LfcodeCodeEditorAutomationSelection
  }

  type LfcodeCodeEditorAutomationHandle = {
    getState: () => LfcodeCodeEditorAutomationState
    setValue: (value: string) => void
    setSelection: (selection: LfcodeCodeEditorAutomationSelection) => void
    focus: () => void
    save: () => Promise<void> | void
    undo: () => Promise<void> | void
    redo: () => Promise<void> | void
    navigateBack: () => Promise<void> | void
    navigateForward: () => Promise<void> | void
    openCommandPalette: () => Promise<void> | void
    openQuickOutline: () => Promise<void> | void
    openFind: () => Promise<void> | void
    openReplace: () => Promise<void> | void
    findPrevious: () => Promise<void> | void
    findNext: () => Promise<void> | void
    openGoToLine: () => Promise<void> | void
    openQuickFix: () => Promise<void> | void
    renameSymbol: () => Promise<void> | void
    showHover: () => Promise<void> | void
    triggerSuggest: () => Promise<void> | void
    triggerParameterHints: () => Promise<void> | void
    openProblems: () => Promise<void> | void
    nextProblem: () => Promise<void> | void
    previousProblem: () => Promise<void> | void
    organizeImports: () => Promise<void> | void
    expandSelection: () => Promise<void> | void
    shrinkSelection: () => Promise<void> | void
    moveLineUp: () => Promise<void> | void
    moveLineDown: () => Promise<void> | void
    copyLineUp: () => Promise<void> | void
    copyLineDown: () => Promise<void> | void
    deleteLine: () => Promise<void> | void
    addNextMatchToSelection: () => Promise<void> | void
    duplicateSelection: () => Promise<void> | void
    insertCursorAbove: () => Promise<void> | void
    insertCursorBelow: () => Promise<void> | void
    joinLines: () => Promise<void> | void
    trimTrailingWhitespace: () => Promise<void> | void
    toggleWordWrap: () => Promise<void> | void
    foldCurrent: () => Promise<void> | void
    unfoldCurrent: () => Promise<void> | void
    foldAll: () => Promise<void> | void
    unfoldAll: () => Promise<void> | void
    peekDeclaration: () => Promise<void> | void
    peekDefinition: () => Promise<void> | void
    peekTypeDefinition: () => Promise<void> | void
    peekImplementation: () => Promise<void> | void
    peekReferences: () => Promise<void> | void
    formatDocument: () => Promise<void> | void
    formatSelection: () => Promise<void> | void
    toggleLineComment: () => Promise<void> | void
    toggleBlockComment: () => Promise<void> | void
    getHover: () => Promise<LfcodeCodeEditorAutomationHoverItem[]>
    getDocumentSymbols: () => Promise<
      Array<{
        id: string
        label: string
        detail?: string
        depth: number
        selection: LfcodeCodeEditorAutomationSelection
      }>
    >
    getWorkspaceSymbols: (query: string) => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getIncomingCalls: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getOutgoingCalls: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getDeclarations: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getDefinitions: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getTypeDefinitions: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getImplementations: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getReferences: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getDocumentHighlights: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    openNavigationTarget: (target: LfcodeCodeEditorAutomationNavigationTarget) => Promise<void> | void
    revealSelection: (selection: LfcodeCodeEditorAutomationSelection) => void
    setDiagnosticsOpen: (open: boolean) => void
    inspectLanguage: (input: {
        kind:
          | "hover"
          | "completion"
          | "signatureHelp"
          | "declaration"
          | "definition"
          | "references"
        | "typeDefinition"
        | "implementation"
        | "documentHighlights"
        | "documentSymbols"
        | "incomingCalls"
        | "outgoingCalls"
      position?: {
        lineNumber: number
        column: number
      }
      triggerCharacter?: string
      maxItems?: number
    }) => Promise<unknown>
  }

  type LfcodeMessageCodeBlockAutomationHandle = {
    bindFileToPath: (path: string) => Promise<boolean>
    reload: () => Promise<void>
  }

  type LfcodeUiAutomationDriver = {
    query: (input: UiDriverQueryInput) => UiDriverNodeSnapshot
    click: (input: UiDriverQueryInput) => Promise<UiDriverNodeSnapshot>
    type: (input: UiDriverTypeInput) => Promise<UiDriverNodeSnapshot>
    readText: (input: UiDriverReadTextInput) => string
    wait: (input: UiDriverWaitInput) => Promise<UiDriverNodeSnapshot>
    editor: (input: UiDriverEditorInput) => Promise<unknown>
  }

  type LfcodeRendererAutomation = {
    getState?: () => unknown | Promise<unknown>
    call?: (action: string, input?: unknown) => unknown | Promise<unknown>
    ui?: LfcodeUiAutomationDriver
  }

  interface Window {
    __LFCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
      appModuleSentinel?: string
      sessionModuleSentinel?: string
      detachedSidePanel?: DetachedSidePanelContext
      navigate?: (route: string) => void
      automation?: LfcodeRendererAutomation
      sessionAutomation?: LfcodeRendererAutomation
      debugTimeline?: unknown
      debugSessionMessages?: unknown
      debugScrollRestore?: unknown
      debugBrowserPanels?: Record<string, unknown>
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      openExternalLink?: (url: string) => void
      automationEvent?: (payload: { type: string; data?: unknown }) => Promise<void>
    }
  }
}

if (typeof window !== "undefined") {
  window.__LFCODE__ ??= {}
  window.__LFCODE__.appModuleSentinel = "app.tsx:loadSession->@/pages/session"
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <LiquidGlassThemeBridge />
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {props.appChildren}
      {props.children}
    </AppShellProviders>
  )
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProvider>
                  <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                </MarkedProvider>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      disableHealthCheck={props.disableHealthCheck}
      servers={props.servers}
    >
      <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
        <ServerKey>
          <QueryProvider>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
                <Dynamic
                  component={props.router ?? Router}
                  root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                >
                  <Route path="/" component={HomeRoute} />
                  <Route path="/:dir" component={DirectoryLayout}>
                    <Route path="/" component={SessionIndexRoute} />
                    <Route path="/session/:id?" component={SessionRoute} />
                  </Route>
                </Dynamic>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </QueryProvider>
        </ServerKey>
      </ConnectionGate>
    </ServerProvider>
  )
}
