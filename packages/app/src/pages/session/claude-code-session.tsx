import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import { Terminal } from "@/components/terminal"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { permissionModeFromScreen } from "./claude-code-controls"

type Binding = {
  sessionID: string
  claudeSessionID: string
  directory: string
  status: "ready" | "running"
  ptyID?: string
  models: { id: string; label: string }[]
  permissionMode?: "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions"
}

export function ClaudeCodeSession(props: { sessionID: string; binding: Binding; restartToken?: number; onConnectionChange?: (connected: boolean) => void; onPermissionModeChange?: (mode: ReturnType<typeof permissionModeFromScreen>) => void }) {
  const sdk = useSDK()
  const language = useLanguage()
  const [ptyID, setPtyID] = createSignal(props.binding.ptyID)
  const [error, setError] = createSignal<string>()
  const [opening, setOpening] = createSignal(false)
  const [terminalClosed, setTerminalClosed] = createSignal(false)
  const [resetting, setResetting] = createSignal(false)
  const setConnected = (connected: boolean) => props.onConnectionChange?.(connected)

  onCleanup(() => setConnected(false))

  const open = async () => {
    if (opening()) return
    setOpening(true)
    setConnected(false)
    setError(undefined)
    setTerminalClosed(false)
    try {
      const response = await sdk.client.claudeCode.open({ sessionID: props.sessionID })
      if (!response.data) throw new Error(language.t("claudeCode.openFailed"))
      setPtyID(response.data.ptyID)
    } catch (cause) {
      setConnected(false)
      setError(cause instanceof Error ? cause.message : language.t("claudeCode.openFailed"))
    } finally {
      setOpening(false)
    }
  }

  createEffect(() => {
    if (ptyID() || resetting() || error()) return
    void open()
  })

  createEffect(
    on(
      () => props.restartToken,
      (next, previous) => {
        if (!next || next === previous) return
        setConnected(false)
        setPtyID(undefined)
        setError(undefined)
        setTerminalClosed(false)
      },
    ),
  )

  const reopen = () => {
    setConnected(false)
    setPtyID(undefined)
    setError(undefined)
    setTerminalClosed(false)
  }

  const reset = async () => {
    if (resetting()) return
    setResetting(true)
    setConnected(false)
    setError(undefined)
    try {
      await sdk.client.claudeCode.reset({ sessionID: props.sessionID })
      setPtyID(undefined)
      setTerminalClosed(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : language.t("claudeCode.resetFailed"))
    } finally {
      setResetting(false)
    }
  }

  return (
    <section class="relative size-full min-h-0 bg-background-stronger" data-component="claude-code-session">
      <Show
        when={ptyID()}
        fallback={
          <div class="flex size-full items-center justify-center text-13-regular text-text-weak">
            <Show
              when={error()}
              fallback={opening() ? language.t("claudeCode.opening") : language.t("claudeCode.terminalUnavailable")}
            >
              {(message) => (
                <button type="button" class="rounded-md bg-surface-raised-base px-3 py-2 text-13-medium text-text-strong hover:bg-surface-raised-base-hover disabled:opacity-50" disabled={opening()} onClick={() => void open()}>
                  {message()}
                </button>
              )}
            </Show>
          </div>
        }
      >
        {(id) => (
          <>
            <Terminal
              pty={{ id: id(), title: "Claude Code", titleNumber: 0 }}
              autoFocus
              onConnect={() => setConnected(true)}
              onConnectError={(cause) => {
                setConnected(false)
                setError(cause instanceof Error ? cause.message : language.t("claudeCode.terminalClosed"))
                setTerminalClosed(true)
              }}
              onScreenChange={(screen) => {
                const mode = permissionModeFromScreen(screen)
                if (mode) props.onPermissionModeChange?.(mode)
              }}
              class="absolute inset-0"
            />
            <Show when={terminalClosed()}>
              <div class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-white/10 bg-[#171717] px-4 py-2 font-mono text-12-regular text-[#b8b8b8]">
                <span>{language.t("claudeCode.terminalClosed")}</span>
                <div class="flex shrink-0 items-center gap-2">
                  <button type="button" class="text-[#d4d4d4] hover:text-white disabled:opacity-50" data-action="claude-code-reopen" disabled={opening() || resetting()} onClick={reopen}>
                    {language.t("claudeCode.reopen")}
                  </button>
                  <button type="button" class="text-[#ff8aa1] hover:text-[#ffb2c1] disabled:opacity-50" data-action="claude-code-reset" disabled={opening() || resetting()} onClick={() => void reset()}>
                    {resetting() ? language.t("claudeCode.resetting") : language.t("claudeCode.reset")}
                  </button>
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
