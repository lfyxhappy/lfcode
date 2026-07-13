export * as WebFetchTool from "./webfetch"

import { ToolFailure } from "@lfcode-ai/llm"
import { Duration, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import TurndownService from "turndown"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "webfetch"
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120

export type WebFetchFailureClass =
  | "invalid_url"
  | "search_engine_url"
  | "browser_required"
  | "tls"
  | "timeout"
  | "http_403"
  | "http_429"
  | "http_5xx"
  | "http_error"
  | "unsupported_content"
  | "response_too_large"
  | "transport"

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.`

const Timeout = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS))

export const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Timeout.pipe(Schema.optional).annotate({
    description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
  }),
})

const Output = Schema.Struct({
  url: Schema.String,
  contentType: Schema.String,
  format: Input.fields.format,
  output: Schema.String,
})

type Format = (typeof Input.Type)["format"]

const acceptHeader = (format: Format) => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
  return "*/*"
}

const headers = (format: Format, userAgent: string) => ({
  "User-Agent": userAgent,
  Accept: acceptHeader(format),
  "Accept-Language": "en-US,en;q=0.9",
})

const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

const searchEngineHosts = new Set([
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
  "baidu.com",
  "www.baidu.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "yandex.com",
  "www.yandex.com",
])

export function isSearchEngineUrl(value: URL) {
  return searchEngineHosts.has(value.hostname.toLowerCase())
}

function extractHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return
  const reason = "reason" in error ? error.reason : error
  if (!reason || typeof reason !== "object") return
  if ("response" in reason && reason.response && typeof reason.response === "object" && "status" in reason.response) {
    const status = reason.response.status
    if (typeof status === "number") return status
  }
}

export function classifyWebFetchFailure(error: unknown): WebFetchFailureClass {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes("webfetch:")) return message.split("webfetch:")[1]?.split(/[\s:]/)[0] as WebFetchFailureClass
  if (message.includes("certificate") || message.includes("tls") || message.includes("ssl")) return "tls"
  if (message.includes("timeout") || message.includes("timed out")) return "timeout"
  if (isCloudflareChallenge(error)) return "browser_required"
  const status = extractHttpStatus(error)
  if (status === 403) return "http_403"
  if (status === 429) return "http_429"
  if (status !== undefined && status >= 500) return "http_5xx"
  if (status !== undefined) return "http_error"
  return "transport"
}

export function formatWebFetchFailure(failure: WebFetchFailureClass) {
  if (failure === "search_engine_url") return "这是搜索结果页。请使用 websearch，而不是直接抓取搜索引擎页面。"
  if (failure === "browser_required") return "该页面需要浏览器会话、JavaScript 或登录状态。请使用内置浏览器或浏览器自动化工具。"
  if (failure === "tls") return "TLS 证书连接失败。请检查目标站点证书或使用浏览器会话；Lfcode 不会绕过 TLS 校验。"
  if (failure === "timeout") return "网页请求超时。可稍后重试、缩小目标页面，或改用浏览器会话。"
  if (failure === "http_403") return "目标站点拒绝访问（HTTP 403）。页面可能需要浏览器或登录状态。"
  if (failure === "http_429") return "目标站点正在限流（HTTP 429）。请稍后重试。"
  if (failure === "http_5xx") return "目标站点服务暂时不可用（HTTP 5xx）。请稍后重试。"
  if (failure === "unsupported_content") return "该 URL 返回的不是可读取文本网页。请使用对应的文件或媒体工具。"
  if (failure === "response_too_large") return "网页响应过大，已停止读取。请使用更具体的 URL 或其他工具。"
  if (failure === "invalid_url") return "URL 无效，且必须使用 http:// 或 https://。"
  return "网页请求失败，请检查网络、URL 或改用浏览器会话。"
}

const isCloudflareChallenge = (error: unknown) => {
  if (!error || typeof error !== "object" || !("reason" in error)) return false
  const reason = error.reason
  if (
    !reason ||
    typeof reason !== "object" ||
    !("_tag" in reason) ||
    reason._tag !== "StatusCodeError" ||
    !("response" in reason)
  )
    return false
  const response = reason.response as HttpClientResponse.HttpClientResponse
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge"
}

const request = (url: string, format: Format, userAgent = browserUserAgent) =>
  HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers(format, userAgent)))

const assertHttpUrl = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
}

const execute = (http: HttpClient.HttpClient, url: string, format: Format, userAgent = browserUserAgent) =>
  http.execute(request(url, format, userAgent)).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))

const collectBody = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    const contentLength = response.headers["content-length"]
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return yield* Effect.fail(new Error("webfetch:response_too_large"))
    }
    const chunks: Uint8Array[] = []
    let size = 0
    yield* Stream.runForEach(response.stream, (chunk) =>
      Effect.gen(function* () {
        size += chunk.byteLength
        if (size > MAX_RESPONSE_BYTES) return yield* Effect.fail(new Error("webfetch:response_too_large"))
        chunks.push(chunk)
        return undefined
      }),
    )
    return Buffer.concat(chunks, size)
  })

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"
const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const http = yield* HttpClient.HttpClient
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* Effect.try({
                try: () => {
                  const parsed = new URL(input.url)
                  assertHttpUrl(parsed)
                  if (isSearchEngineUrl(parsed)) throw new Error("webfetch:search_engine_url")
                  return parsed
                },
                catch: (error) => error,
              })

              yield* permission.assert({
                action: name,
                resources: [input.url],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const { body, contentType } = yield* Effect.gen(function* () {
                const response = yield* execute(http, input.url, input.format).pipe(
                  Effect.catchIf(isCloudflareChallenge, () => execute(http, input.url, input.format, "lfcode")),
                )
                const contentType = response.headers["content-type"] || ""
                const mime = mimeFrom(contentType)
                if (isImageAttachment(mime))
                  return yield* Effect.fail(new Error("webfetch:unsupported_content"))
                if (!isTextualMime(mime))
                  return yield* Effect.fail(new Error("webfetch:unsupported_content"))
                return { body: yield* collectBody(response), contentType }
              }).pipe(
                Effect.timeoutOrElse({
                  duration: Duration.seconds(input.timeout ?? DEFAULT_TIMEOUT_SECONDS),
                  orElse: () => Effect.fail(new Error("webfetch:timeout")),
                }),
              )
              const content = convert(new TextDecoder().decode(body), contentType, input.format)
              return {
                url: input.url,
                contentType,
                format: input.format,
                output: content,
              }
            }).pipe(
              Effect.mapError((error) => new ToolFailure({ message: formatWebFetchFailure(classifyWebFetchFailure(error)) })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) skipDepth++
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })
  parser.write(html)
  parser.end()
  return text.trim()
}

export function convertHTMLToMarkdown(html: string) {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndown.remove(["script", "style", "meta", "link"])
  return turndown.turndown(html)
}
