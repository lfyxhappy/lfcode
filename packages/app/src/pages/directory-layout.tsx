import { DataProvider } from "@lfcode-ai/ui/context"
import { showToast } from "@lfcode-ai/ui/toast"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, onMount, type ParentProps, Show } from "solid-js"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { PromptProvider } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { TerminalProvider } from "@/context/terminal"
import { decode64 } from "@/utils/base64"
import { installSessionViewportNavigationBridge } from "@/pages/session/session-viewport-registry"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

  onMount(() => onCleanup(installSessionViewportNavigationBridge()))

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

function DirectorySessionProviders(props: ParentProps<{ directory: string }>) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>
            {props.children}
          </CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectorySessionProviders directory={resolved}>
              <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
            </DirectorySessionProviders>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
