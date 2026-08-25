import { Flag } from "@/flag/flag"
import { Hono, type Context } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import { extname, relative, resolve } from "node:path"

const embeddedUIPromise = Flag.LFCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("lfcode-web-ui.gen.ts")
      .then((module) => module.default as Record<string, string>)
      .catch(() => null)

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

export function inlineScriptHash(source: string) {
  // HTML parsing normalizes CRLF to LF before CSP evaluates inline scripts.
  return createHash("sha256").update(source.replace(/\r\n?/g, "\n")).digest("base64")
}

const exists = (file: string) => fs.access(file).then(() => true).catch(() => false)

export const UIRoutes = (): Hono =>
  new Hono().all("/*", async (c) => {
    const rendererDir = process.env.LFCODE_WEB_UI_DIR
    if (rendererDir) {
      const requested = c.req.path.replace(/^\/+/, "")
      const file = resolve(rendererDir, requested || "index.html")
      const pathFromRenderer = relative(rendererDir, file)
      if (pathFromRenderer === "" || (!pathFromRenderer.startsWith("..") && !pathFromRenderer.startsWith("..\\") && !pathFromRenderer.includes("\u0000"))) {
        const fallback = !extname(requested) ? resolve(rendererDir, "index.html") : undefined
        const match = (await exists(file)) ? file : fallback && (await exists(fallback)) ? fallback : undefined
        if (match) return serveWebUIFile(c, match)
      }
      return c.json({ error: "Not Found" }, 404)
    }

    const embeddedWebUI = await embeddedUIPromise
    const path = c.req.path

    if (embeddedWebUI && Object.keys(embeddedWebUI).length > 0) {
      const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
      if (!match) return c.json({ error: "Not Found" }, 404)

      if (await exists(match)) {
        return serveWebUIFile(c, match)
      } else {
        return c.json({ error: "Not Found" }, 404)
      }
    } else {
      const response = await proxy(`https://app.lfcode.ai${path}`, {
        raw: c.req.raw,
        headers: {
          ...Object.fromEntries(c.req.raw.headers.entries()),
          host: "app.lfcode.ai",
        },
      })
      const match = response.headers.get("content-type")?.includes("text/html")
        ? (await response.clone().text()).match(
            /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
          )
        : undefined
      const hash = match ? inlineScriptHash(match[2]) : ""
      response.headers.set("Content-Security-Policy", csp(hash))
      return response
    }
  })

async function serveWebUIFile(c: Context, file: string) {
  const mime = getMimeType(file) ?? "text/plain"
  c.header("Content-Type", mime)
  const data = await fs.readFile(file)
  if (mime.startsWith("text/html")) {
    const html = data.toString("utf8")
    const match = html.match(
      /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
    )
    const hash = match ? inlineScriptHash(match[2]) : ""
    c.header("Content-Security-Policy", csp(hash))
  }
  return c.body(new Uint8Array(data))
}
