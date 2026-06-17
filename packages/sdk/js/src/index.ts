export * from "./client.js"
export * from "./server.js"

import { createLfcodeClient } from "./client.js"
import { createLfcodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createLfcode(options?: ServerOptions) {
  const server = await createLfcodeServer({
    ...options,
  })

  const client = createLfcodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
