import z from "zod"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { extractTextFromHTML } from "./webfetch-html"
import { canUseWindowsWebFetch, fetchWithWindowsPowerShell } from "@lfcode-ai/shared/windows-webfetch"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

const isHttpStatusError = (error: unknown) => {
  if (!error || typeof error !== "object" || !("reason" in error)) return false
  const reason = error.reason
  return !!reason && typeof reason === "object" && "_tag" in reason && reason._tag === "StatusCodeError"
}

const shouldUseWindowsPowerShellFallback = (error: unknown) => {
  if (!canUseWindowsWebFetch()) return false
  if (isHttpStatusError(error)) return false
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes("timeout") || message.includes("timed out") || message.includes("response too large")) return false
  return true
}

const statusError = (status: number) => new Error(`HTTP ${status}`)

const parameters = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .default("markdown")
    .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
  timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (params.format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const request = HttpClientRequest.get(params.url).pipe(HttpClientRequest.setHeaders(headers))

          const fetched = yield* Effect.gen(function* () {
            const response = yield* httpOk.execute(request).pipe(
              Effect.catchIf(
                (err) =>
                  err.reason._tag === "StatusCodeError" &&
                  err.reason.response.status === 403 &&
                  err.reason.response.headers["cf-mitigated"] === "challenge",
                () =>
                  httpOk.execute(
                    HttpClientRequest.get(params.url).pipe(
                      HttpClientRequest.setHeaders({ ...headers, "User-Agent": "lfcode" }),
                    ),
                  ),
              ),
            )
            const contentLength = response.headers["content-length"]
            if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE)
              return yield* Effect.fail(new Error("Response too large (exceeds 5MB limit)"))
            const bytes = new Uint8Array(yield* response.arrayBuffer)
            if (bytes.byteLength > MAX_RESPONSE_SIZE)
              return yield* Effect.fail(new Error("Response too large (exceeds 5MB limit)"))
            return { bytes, contentType: response.headers["content-type"] || "" }
          }).pipe(
            Effect.catch((error) => {
              if (!shouldUseWindowsPowerShellFallback(error)) return Effect.fail(error)
              return Effect.tryPromise({
                try: (signal) =>
                  fetchWithWindowsPowerShell(
                    {
                      url: params.url,
                      headers,
                      maxResponseBytes: MAX_RESPONSE_SIZE,
                      maxRedirects: 5,
                      timeoutSeconds: Math.ceil(timeout / 1000),
                    },
                    signal,
                  ),
                catch: () => error,
              }).pipe(
                Effect.flatMap((response) => {
                  if (response.status < 200 || response.status >= 300) return Effect.fail(statusError(response.status))
                  return Effect.succeed({ bytes: response.body, contentType: response.contentType })
                }),
              )
            }),
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )

          const contentType = fetched.contentType
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(fetched.bytes).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(fetched.bytes)

          // Handle content based on requested format and actual content type
          switch (params.format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                const markdown = convertHTMLToMarkdown(content)
                return {
                  output: markdown,
                  title,
                  metadata: {},
                }
              }
              return { output: content, title, metadata: {} }

            case "text":
              if (contentType.includes("text/html")) {
                const text = extractTextFromHTML(content)
                return { output: text, title, metadata: {} }
              }
              return { output: content, title, metadata: {} }

            case "html":
              return { output: content, title, metadata: {} }

            default:
              return { output: content, title, metadata: {} }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
