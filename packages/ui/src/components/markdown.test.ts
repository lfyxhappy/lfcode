import { describe, expect, test } from "bun:test"
import { HTML_COMPONENT_EVENT_TYPE, replaceHtmlComponentFences, setupHtmlComponents } from "./markdown-html-component"
import { sanitizeMarkdownHtml } from "./markdown-sanitize"
import { marked } from "marked"
import markedKatex from "marked-katex-extension"

describe("markdown sanitization", () => {
  test("preserves KaTeX SVG needed for square roots", async () => {
    const parser = marked.use(
      markedKatex({
        throwOnError: false,
        nonStandard: true,
      }),
    )

    const html = await parser.parse("$$t = \\frac{Z}{\\sqrt{V/n}}$$")
    const safe = sanitizeMarkdownHtml(html)

    expect(html.includes("<svg")).toBeTrue()
    expect(safe.includes("<svg")).toBeTrue()
    expect(safe.includes('class="mord sqrt"')).toBeTrue()
  })

  test("supports common LaTeX bracket delimiters via normalization", async () => {
    const parser = marked.use(
      markedKatex({
        throwOnError: false,
        nonStandard: true,
      }),
    )

    const html = await parser.parse(String.raw`\[\frac{a}{b}\] and \(\sqrt{x}\)`)
    const safe = sanitizeMarkdownHtml(html)

    expect(safe.includes("katex")).toBeTrue()
    expect(safe.includes("mfrac")).toBeTrue()
    expect(safe.includes("sqrt")).toBeTrue()
  })
})

describe("lfcode html markdown blocks", () => {
  test("keeps regular html fences as code blocks", () => {
    const markdown = '```html\n<div>Hello</div>\n```'
    expect(replaceHtmlComponentFences(markdown)).toBe(markdown)
  })

  test("converts closed lfcode-html fences into placeholders", () => {
    const next = replaceHtmlComponentFences('```lfcode-html height=420 title="五子棋"\n<button>Play</button>\n```')
    expect(next).toContain('data-component="lfcode-html-placeholder"')
    expect(next).toContain('data-html-height="420"')
    expect(next).toContain('data-html-title="五子棋"')
  })

  test("converts escaped lfcode html fences into placeholders", () => {
    const next = replaceHtmlComponentFences('```<<lfcode>>-<<html>>\n<button>Play</button>\n```')
    expect(next).toContain('data-component="lfcode-html-placeholder"')
  })

  test("keeps unfinished lfcode-html fences inert", () => {
    const markdown = '```lfcode-html height=420 title="五子棋"\n<button>Play</button>'
    expect(replaceHtmlComponentFences(markdown)).toBe(markdown)
  })
})

describe("lfcode html iframe setup", () => {
  test("mounts sandboxed iframe and forwards component events", () => {
    const root = document.createElement("div")
    root.innerHTML = replaceHtmlComponentFences('```lfcode-html title="Chooser"\n<button>Pick</button>\n```')

    const events: unknown[] = []
    const cleanup = setupHtmlComponents(root as HTMLDivElement, {
      labels: {
        copy: "Copy",
        copied: "Copied",
        refresh: "Refresh",
        shrink: "Smaller",
        grow: "Larger",
        fit: "Fit",
        expand: "Expand",
        collapse: "Collapse",
        loading: "Loading...",
        error: "Component failed to load",
      },
      context: {
        sessionID: "session-1",
        messageID: "message-1",
        partID: "part-1",
        role: "assistant",
      },
      onEvent: (detail) => events.push(detail),
    })

    const iframe = root.querySelector('iframe[data-slot="lfcode-html-iframe"]') as HTMLIFrameElement | null
    const body = root.querySelector('[data-slot="lfcode-html-body"]') as HTMLDivElement | null
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    expect(body?.style.height).toBe("360px")
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-forms")
    expect(iframe?.getAttribute("srcdoc")).toContain("lfcode.component.ready")
    expect(iframe?.getAttribute("srcdoc")).toContain("globalThis.lfcode = bridge")

    const resize = new MessageEvent("message", {
      data: {
        type: "lfcode.component.resize",
        height: 720,
      },
    })
    Object.defineProperty(resize, "source", {
      configurable: true,
      value: iframe?.contentWindow,
    })
    window.dispatchEvent(resize)
    expect(body?.style.height).toBe("720px")

    const message = new MessageEvent("message", {
      data: {
        type: HTML_COMPONENT_EVENT_TYPE,
        event: "pick_option",
        payload: { value: "A" },
        state: { selected: "A" },
      },
    })
    Object.defineProperty(message, "source", {
      configurable: true,
      value: iframe?.contentWindow,
    })
    window.dispatchEvent(message)

    expect(events).toEqual([
      {
        componentID: expect.any(String),
        title: "Chooser",
        event: "pick_option",
        payload: { value: "A" },
        state: { selected: "A" },
        context: {
          sessionID: "session-1",
          messageID: "message-1",
          partID: "part-1",
          role: "assistant",
        },
      },
    ])

    cleanup?.()
  })
})
