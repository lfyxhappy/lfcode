import type { Hooks, PluginInput } from "@lfcode-ai/plugin"

export async function AnthropicProxyPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      async loader(_getAuth, provider) {
        if (!provider?.options?.baseURL) return {}
        return {
          async fetch(url: any, init: any) {
            if (init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
              delete init.headers["anthropic-beta"]
            }
            const response = await fetch(url, init)
            if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let done = false
            let buffer = ""
            const body = new ReadableStream<Uint8Array>({
              async pull(controller) {
                if (done) {
                  controller.close()
                  return
                }
                const chunk = await reader.read()
                if (chunk.done) {
                  controller.close()
                  return
                }
                controller.enqueue(chunk.value)
                buffer += decoder.decode(chunk.value, { stream: true })
                if (buffer.includes("\nevent: message_stop\n") || buffer.includes("\ndata: {\"type\":\"message_stop\"}")) {
                  done = true
                  void reader.cancel()
                  controller.close()
                }
                if (buffer.length > 512) buffer = buffer.slice(-256)
              },
              cancel() {
                return reader.cancel()
              },
            })
            return new Response(body, { headers: response.headers, status: response.status })
          },
        }
      },
      methods: [],
    },
  }
}
