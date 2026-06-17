import { createLfcodeClient, type LfcodeClient } from "@lfcode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export type ServerSdkOptions = Omit<NonNullable<Parameters<typeof createLfcodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}

export function createSdkForServer({
  server,
  ...config
}: ServerSdkOptions): LfcodeClient {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "lfcode"}:${server.password}`)}`,
    }
  })()

  return createLfcodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
