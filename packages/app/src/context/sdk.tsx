import type { Event } from "@lfcode-ai/sdk/v2/client"
import { createSimpleContext } from "@lfcode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { useGlobalSDK } from "./global-sdk"

type SDKEventMap = {
  [key in Event["type"]]: Extract<Event, { type: key }>
}

type SDKContext = {
  directory: string
  client: ReturnType<ReturnType<typeof useGlobalSDK>["createClient"]>
  event: ReturnType<typeof createGlobalEmitter<SDKEventMap>>
  url: string
  createClient: ReturnType<typeof useGlobalSDK>["createClient"]
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext<SDKContext, { directory: Accessor<string> }>({
  name: "SDK",
  init: (props): SDKContext => {
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    const client = createMemo(() =>
      globalSDK.createClient({
        directory: directory(),
        throwOnError: true,
      }),
    )

    const emitter = createGlobalEmitter<SDKEventMap>()

    createEffect(() => {
      const unsub = globalSDK.event.on(directory(), (event) => {
        emitter.emit(event.type, event)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.url
      },
      createClient(opts: Parameters<typeof globalSDK.createClient>[0]) {
        return globalSDK.createClient(opts)
      },
    }
  },
})
