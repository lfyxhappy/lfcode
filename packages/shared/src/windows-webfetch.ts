import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

export type WindowsWebFetchInput = {
  readonly url: string
  readonly headers: Record<string, string>
  readonly maxResponseBytes: number
  readonly maxRedirects: number
  readonly timeoutSeconds: number
}

export type WindowsWebFetchResponse = {
  readonly body: Buffer
  readonly contentType: string
  readonly headers: Record<string, string>
  readonly status: number
}

const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $true
$handler.MaxAutomaticRedirections = [int]$request.maxRedirects
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds([int]$request.timeoutSeconds)

try {
  foreach ($property in $request.headers.PSObject.Properties) {
    [void]$client.DefaultRequestHeaders.TryAddWithoutValidation($property.Name, [string]$property.Value)
  }
  $response = $client.GetAsync([Uri]$request.url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  $responseHeaders = [ordered]@{}
  foreach ($header in $response.Headers) {
    $responseHeaders[$header.Key] = [string]::Join(', ', $header.Value)
  }
  foreach ($header in $response.Content.Headers) {
    $responseHeaders[$header.Key] = [string]::Join(', ', $header.Value)
  }
  $stream = $response.Content.ReadAsStream()
  $body = [System.IO.MemoryStream]::new()
  $buffer = New-Object byte[] 81920
  $total = 0
  try {
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $read
      if ($total -gt [int]$request.maxResponseBytes) {
        [Console]::Out.WriteLine('{"ok":false,"error":"response_too_large"}')
        exit 0
      }
      $body.Write($buffer, 0, $read)
    }
  } finally {
    $stream.Dispose()
  }
  $contentType = $response.Content.Headers.ContentType
  [Console]::Out.WriteLine((@{
    ok = $true
    status = [int]$response.StatusCode
    headers = $responseHeaders
    contentType = if ($contentType) { [string]$contentType } else { '' }
    bodyBase64 = [Convert]::ToBase64String($body.ToArray())
  } | ConvertTo-Json -Compress -Depth 6))
} catch {
  [Console]::Out.WriteLine('{"ok":false,"error":"transport"}')
} finally {
  $client.Dispose()
  $handler.Dispose()
}
`

const maximumProcessOutput = (maxResponseBytes: number) => Math.ceil((maxResponseBytes * 4) / 3) + 256 * 1024

const executable = () => {
  const bundled = process.env.LFCODE_PWSH_PATH
  if (bundled && existsSync(bundled)) return bundled
  return "pwsh.exe"
}

const failure = (message: string) => new Error(`windows_webfetch:${message}`)

export function canUseWindowsWebFetch(platform = process.platform) {
  return platform === "win32"
}

export function parseWindowsWebFetchResponse(value: string, maxResponseBytes: number): WindowsWebFetchResponse {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== "object") throw failure("invalid_response")
  if (!("ok" in parsed) || parsed.ok !== true) {
    const code = "error" in parsed && typeof parsed.error === "string" ? parsed.error : "transport"
    throw failure(code)
  }
  if (!("status" in parsed) || typeof parsed.status !== "number") throw failure("invalid_response")
  if (!("bodyBase64" in parsed) || typeof parsed.bodyBase64 !== "string") throw failure("invalid_response")
  const body = Buffer.from(parsed.bodyBase64, "base64")
  if (body.byteLength > maxResponseBytes) throw failure("response_too_large")
  const headers =
    "headers" in parsed && parsed.headers && typeof parsed.headers === "object"
      ? Object.fromEntries(Object.entries(parsed.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {}
  const contentType = "contentType" in parsed && typeof parsed.contentType === "string" ? parsed.contentType : (headers["Content-Type"] ?? "")
  return { body, contentType, headers, status: parsed.status }
}

export function fetchWithWindowsPowerShell(input: WindowsWebFetchInput, signal?: AbortSignal): Promise<WindowsWebFetchResponse> {
  if (!canUseWindowsWebFetch()) return Promise.reject(failure("unsupported_platform"))
  return new Promise((resolve, reject) => {
    const child = spawn(executable(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    const outputLimit = maximumProcessOutput(input.maxResponseBytes)
    const stdout: Buffer[] = []
    let outputBytes = 0
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", abort)
      callback()
    }
    const stop = (error: Error) => {
      child.kill()
      finish(() => reject(error))
    }
    const abort = () => stop(signal?.reason instanceof Error ? signal.reason : failure("aborted"))

    if (signal?.aborted) return abort()
    signal?.addEventListener("abort", abort, { once: true })
    child.once("error", () => finish(() => reject(failure("spawn_failed"))))
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > outputLimit) return stop(failure("response_too_large"))
      stdout.push(chunk)
    })
    child.once("close", (code) => {
      if (settled) return
      if (code !== 0) return finish(() => reject(failure("process_failed")))
      try {
        finish(() => resolve(parseWindowsWebFetchResponse(Buffer.concat(stdout).toString("utf8"), input.maxResponseBytes)))
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : failure("invalid_response")))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}
