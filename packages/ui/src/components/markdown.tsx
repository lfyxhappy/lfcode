import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import { useFileReferenceContext, type FileReferenceApp } from "../context/file-reference"
import { checksum } from "@lfcode-ai/shared/util/encode"
import { ComponentProps, createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { stream } from "./markdown-stream"
import {
  getPlainTextPathMatch,
  inferFileReferenceKind,
  isAbsoluteFileReferencePath,
  isLocalFileHref,
  isPathLike,
  looksLikeCommand,
  stripTrailingPathPunctuation,
} from "./file-reference-path"
import { getFileReferenceEventElement } from "./markdown-file-reference"
import { ContextMenu } from "./context-menu"
import { AppIcon } from "./app-icon"
import { sanitizeMarkdownHtml } from "./markdown-sanitize"
import {
  getFileReferenceCategory,
  isCardableFileReference,
  type FileReferenceValidation,
} from "./markdown-file-reference-card"

export { sanitizeMarkdownHtml } from "./markdown-sanitize"
import { extractMarkdownCodeLanguages } from "./markdown-code-languages"
import {
  type HtmlComponentContext,
  type HtmlComponentEventDetail,
  replaceHtmlComponentFences,
  setupHtmlComponents,
} from "./markdown-html-component"

type Entry = {
  hash: string
  html: string
}

type FileReferenceOptions = {
  enabled: boolean
  allowContextMenu?: boolean
  resolveRelativePath?: (value: string) => string | undefined
  validatePath?: (path: string) => Promise<FileReferenceValidation>
  onPreviewPath?: (path: string) => void
  onOpenDefaultApp?: (path: string) => void
  onOpenInApp?: (path: string) => void
  onOpenFolder?: (path: string) => void
  onOpenWith?: (path: string, app: string) => void
  onCopyPath?: (path: string) => void
  onReviewPath?: (path: string) => void
  openWithApps?: FileReferenceApp[]
}

const max = 200
const cache = new Map<string, Entry>()
const fileReferenceValidationCache = new Map<string, { result: FileReferenceValidation; expires: number }>()
const fileReferenceValidationInflight = new Map<string, Promise<FileReferenceValidation>>()
const fileReferenceValidationTtl = 3_000

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

type CopyLabels = {
  copy: string
  copied: string
}

export type { HtmlComponentContext, HtmlComponentEventDetail } from "./markdown-html-component"

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    button.setAttribute("data-tooltip", labels.copied)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
}

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels, languageHint?: string) {
  const parent = block.parentElement
  if (!parent) return
  const wrapper = parent.getAttribute("data-component") === "markdown-code" ? parent : document.createElement("div")
  if (wrapper !== parent) {
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
  }

  const code = block.querySelector("code")
  const language = code?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? languageHint ?? "text"
  let languageLabel = wrapper.querySelector('[data-slot="markdown-code-language"]')
  if (!(languageLabel instanceof HTMLSpanElement)) {
    languageLabel = document.createElement("span")
    languageLabel.setAttribute("data-slot", "markdown-code-language")
    wrapper.insertBefore(languageLabel, block)
  }
  languageLabel.textContent = language

  const buttons = Array.from(wrapper.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  for (const button of buttons.slice(1)) {
    button.remove()
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

function pathFilename(value: string) {
  return value.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || value
}

function decorateFileReference(link: HTMLAnchorElement, path: string, display: string) {
  link.setAttribute("data-kind", "file-ref")
  link.setAttribute("data-path", path)
  link.setAttribute("data-display", display)
  link.classList.add("file-reference")
  link.removeAttribute("target")
  link.removeAttribute("rel")
  link.href = "#"

  const cached = getFileReferenceValidation(path)
  if (!cached?.exists) return
  applyFileReferenceCard(link, cached)
}

function getFileReferenceValidation(path: string) {
  const entry = fileReferenceValidationCache.get(path)
  if (!entry || entry.expires < Date.now()) return
  return entry.result
}

function rememberFileReferenceValidation(path: string, result: FileReferenceValidation) {
  fileReferenceValidationCache.delete(path)
  fileReferenceValidationCache.set(path, { result, expires: Date.now() + fileReferenceValidationTtl })
  if (fileReferenceValidationCache.size <= max) return
  const first = fileReferenceValidationCache.keys().next().value
  if (first) fileReferenceValidationCache.delete(first)
}

function applyFileReferenceCard(link: HTMLAnchorElement, result: FileReferenceValidation) {
  const path = link.dataset.path
  if (!path || !isCardableFileReference(path, result)) return
  if (result.kind !== "file" && result.kind !== "directory") return
  link.classList.add("file-reference-card")
  link.setAttribute("data-reference-kind", result.kind)
  link.setAttribute("data-file-category", getFileReferenceCategory(path, result.kind))
  link.textContent = pathFilename(path)
  link.setAttribute("title", path)
  link.setAttribute("aria-label", path)
}

function decorateMarkdownLinks(root: HTMLDivElement, options: FileReferenceOptions) {
  const links = Array.from(root.querySelectorAll("a"))
  for (const link of links) {
    const href = link.getAttribute("href") ?? ""
    if (!isLocalFileHref(href)) continue
    const value = stripTrailingPathPunctuation(href)
    const resolved = options.resolveRelativePath?.(value) ?? value
    if (!resolved) continue
    decorateFileReference(link, resolved, link.textContent?.trim() || value)
  }
}

function decorateInlineCodePaths(root: HTMLDivElement, options: FileReferenceOptions) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const text = code.textContent?.trim() ?? ""
    if (!text || looksLikeCommand(text) || !isPathLike(text)) continue
    const resolved = options.resolveRelativePath?.(text) ?? stripTrailingPathPunctuation(text)
    if (!resolved) continue
    const link = document.createElement("a")
    decorateFileReference(link, resolved, text)
    if (!link.textContent) link.textContent = text
    code.parentNode?.replaceChild(link, code)
  }
}

function decoratePlainTextPaths(root: HTMLDivElement, options: FileReferenceOptions) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest("pre, code, a, [data-kind='file-ref']")) return NodeFilter.FILTER_REJECT
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const targets: Text[] = []
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) targets.push(walker.currentNode)
  }

  for (const node of targets) {
    const text = node.textContent ?? ""
    let last = 0
    const fragment = document.createDocumentFragment()
    let changed = false

    while (last < text.length) {
      const match = getPlainTextPathMatch(text, last)
      if (!match) {
        if (last < text.length) fragment.append(text.slice(last))
        break
      }

      const value = match.value
      if (!value || !isPathLike(value) || looksLikeCommand(value)) {
        last = match.end
        continue
      }

      const resolved = options.resolveRelativePath?.(value) ?? value
      if (!resolved) continue

      changed = true
      if (match.start > last) fragment.append(text.slice(last, match.start))

      const link = document.createElement("a")
      decorateFileReference(link, resolved, value)
      if (!link.classList.contains("file-reference-card")) link.textContent = value
      fragment.append(link)
      last = match.end
    }

    if (!changed) continue
    node.parentNode?.replaceChild(fragment, node)
  }
}

function validateFileReferences(root: HTMLDivElement, options: FileReferenceOptions, isCurrent: () => boolean) {
  if (!options.validatePath) return
  const candidates = Array.from(root.querySelectorAll('[data-kind="file-ref"]')).filter(
    (element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement && isAbsoluteFileReferencePath(element.dataset.path ?? ""),
  )
  const paths = Array.from(new Set(candidates.map((element) => element.dataset.path).filter((path): path is string => !!path)))

  for (const path of paths) {
    const cached = getFileReferenceValidation(path)
    if (cached) {
      for (const element of candidates) {
        if (element.dataset.path === path) applyFileReferenceCard(element, cached)
      }
      continue
    }

    const pending =
      fileReferenceValidationInflight.get(path) ??
      options
        .validatePath(path)
        .catch(() => ({ exists: false, kind: "unknown" as const }))
        .finally(() => fileReferenceValidationInflight.delete(path))
    fileReferenceValidationInflight.set(path, pending)
    void pending.then((result) => {
      rememberFileReferenceValidation(path, result)
      if (!isCurrent()) return
      for (const element of candidates) {
        if (element.isConnected && element.dataset.path === path) applyFileReferenceCard(element, result)
      }
    })
  }
}

function getFileReferenceKind(element: HTMLElement) {
  const kind = element.dataset.referenceKind
  if (kind === "file" || kind === "directory") return kind
  return inferFileReferenceKind(element.dataset.display ?? element.dataset.path ?? "")
}

function setupFileReferenceActions(root: HTMLDivElement, options: FileReferenceOptions) {
  const click = (event: MouseEvent) => {
    const element = getFileReferenceEventElement(event.target)
    if (!element) return
    const path = element.dataset.path
    if (!path) return
    const kind = getFileReferenceKind(element)
    event.preventDefault()
    event.stopPropagation()
    if (kind === "directory" && options.onOpenDefaultApp) {
      options.onOpenDefaultApp(path)
      return
    }
    options.onPreviewPath?.(path)
  }

  root.addEventListener("click", click)
  return () => {
    root.removeEventListener("click", click)
  }
}

type ContextState = {
  open: boolean
  path?: string
  display?: string
  kind?: "file" | "directory" | "unknown"
}

function decorate(root: HTMLDivElement, labels: CopyLabels, fileReferences?: FileReferenceOptions, source?: string) {
  const languages = source ? extractMarkdownCodeLanguages(source) : []
  const blocks = Array.from(root.querySelectorAll("pre"))
  blocks.forEach((block, index) => ensureCodeWrapper(block, labels, languages[index]))
  markCodeLinks(root)
  if (!fileReferences?.enabled) return
  decorateMarkdownLinks(root, fileReferences)
  decorateInlineCodePaths(root, fileReferences)
  decoratePlainTextPaths(root, fileReferences)
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    const labels = getLabels()
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    fileReferences?: FileReferenceOptions
    htmlComponents?: {
      context?: HtmlComponentContext
      onEvent?: (detail: HtmlComponentEventDetail) => void
    }
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, [
    "text",
    "cacheKey",
    "streaming",
    "fileReferences",
    "htmlComponents",
    "class",
    "classList",
  ])
  const marked = useMarked()
  const i18n = useI18n()
  const context = useFileReferenceContext()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [menu, setMenu] = createSignal<ContextState>({ open: false })
  const effectiveFileReferences = createMemo<FileReferenceOptions | undefined>(() => {
    if (local.fileReferences) return local.fileReferences
    if (!context?.enableMarkdownDecorations) return
    return {
      enabled: true,
      allowContextMenu: context.allowContextMenu,
      resolveRelativePath: (value) => context.resolvePath?.(value, context.baseDir),
      validatePath: context.validatePath,
      onPreviewPath: context.onPreviewPath,
      onOpenDefaultApp: context.onOpenDefaultApp,
      onOpenInApp: context.onOpenInApp,
      onOpenFolder: context.onOpenFolder,
      onOpenWith: context.onOpenWith,
      onCopyPath: context.onCopyPath,
      onReviewPath: context.onReviewPath,
      openWithApps: context.openWithApps,
    }
  })
  const [html] = createResource<string[], { text: string; key?: string; streaming: boolean }>(
    () => ({
      text: local.text,
      key: local.cacheKey,
      streaming: local.streaming ?? false,
    }),
    async (src) => {
      if (isServer) return [fallback(src.text)]
      if (!src.text) return []

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        stream(src.text, src.streaming).map(async (block, index) => {
          const hash = checksum(block.raw)
          const key = base ? `${base}:${index}:${block.mode}` : hash

          if (key && hash) {
            const cached = cache.get(key)
            if (cached && cached.hash === hash) {
              touch(key, cached)
              return cached.html
            }
          }

          const next = await Promise.resolve(marked.parse(replaceHtmlComponentFences(block.src)))
          const safe = sanitizeMarkdownHtml(next)
          if (key && hash) touch(key, { hash, html: safe })
          return safe
        }),
      )
        .catch(() => [fallback(src.text)])
    },
    { initialValue: local.text ? [fallback(local.text)] : [] },
  )

  let copyCleanup: (() => void) | undefined
  let fileReferenceCleanup: (() => void) | undefined
  let htmlComponentCleanup: (() => void) | undefined
  let fileReferenceDecorationVersion = 0
  let renderedBlocks: string[] = []
  let renderedNodes: Node[][] = []

  createEffect(() => {
    const container = root()
    const blocks = local.text ? (html.latest ?? html() ?? []) : []
    if (!container) return
    if (isServer) return

    if (!blocks.length) {
      container.innerHTML = ""
      renderedBlocks = []
      renderedNodes = []
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
    }
    const firstChanged = blocks.findIndex((value, index) => renderedBlocks[index] !== value)
    if (firstChanged >= 0 || renderedBlocks.length !== blocks.length) {
      const start = firstChanged >= 0 ? firstChanged : Math.min(renderedBlocks.length, blocks.length)
      for (const nodes of renderedNodes.slice(start)) {
        for (const node of nodes) node.parentNode?.removeChild(node)
      }
      renderedNodes = renderedNodes.slice(0, start)
      renderedBlocks = renderedBlocks.slice(0, start)
      for (const block of blocks.slice(start)) {
        const temp = document.createElement("div")
        temp.innerHTML = block
        decorate(temp, labels, effectiveFileReferences(), local.text)
        const nodes = Array.from(temp.childNodes)
        for (const node of nodes) container.appendChild(node)
        renderedNodes.push(nodes)
        renderedBlocks.push(block)
      }
    }

    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
      }))
    if (fileReferenceCleanup) {
      fileReferenceCleanup()
      fileReferenceCleanup = undefined
    }
    if (effectiveFileReferences()?.enabled) fileReferenceCleanup = setupFileReferenceActions(container, effectiveFileReferences()!)
    if (htmlComponentCleanup) {
      htmlComponentCleanup()
      htmlComponentCleanup = undefined
    }
    htmlComponentCleanup = setupHtmlComponents(container, {
      labels: {
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
        refresh: i18n.t("ui.htmlComponent.refresh"),
        shrink: i18n.t("ui.htmlComponent.shrink"),
        grow: i18n.t("ui.htmlComponent.grow"),
        fit: i18n.t("ui.htmlComponent.fit"),
        expand: i18n.t("ui.htmlComponent.expand"),
        collapse: i18n.t("ui.htmlComponent.collapse"),
        loading: i18n.t("ui.htmlComponent.loading"),
        error: i18n.t("ui.htmlComponent.error"),
      },
      context: local.htmlComponents?.context,
      onEvent: local.htmlComponents?.onEvent,
    })

    fileReferenceDecorationVersion += 1
    const decorationVersion = fileReferenceDecorationVersion
    if (effectiveFileReferences()?.enabled) {
      validateFileReferences(container, effectiveFileReferences()!, () => fileReferenceDecorationVersion === decorationVersion)
    }
  })

  const handleFileReferenceContextMenu = (event: MouseEvent) => {
    const options = effectiveFileReferences()
    if (!options?.enabled || !options.allowContextMenu) return
    const element = getFileReferenceEventElement(event.target)
    if (!element) {
      setMenu({ open: false })
      // The context-menu trigger wraps the whole Markdown surface. Do not let
      // non-file targets reach it, or it opens an empty file-reference menu.
      event.stopPropagation()
      return
    }
    const path = element.dataset.path
    if (!path) {
      setMenu({ open: false })
      return
    }
    // The Kobalte trigger opens later in the same contextmenu event. Populate
    // the controlled content state first so the initial menu is never empty.
    setMenu({
      open: true,
      path,
      display: element.dataset.display,
      kind: getFileReferenceKind(element),
    })
  }

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    if (fileReferenceCleanup) fileReferenceCleanup()
    if (htmlComponentCleanup) htmlComponentCleanup()
  })

  return (
    <>
      <Show
        when={effectiveFileReferences()?.enabled && effectiveFileReferences()?.allowContextMenu}
        fallback={
          <div
            data-component="markdown"
            classList={{
              ...local.classList,
              [local.class ?? ""]: !!local.class,
            }}
            ref={setRoot}
            {...others}
          />
        }
      >
        <ContextMenu
          onOpenChange={(open) =>
            setMenu((prev) => ({
              ...prev,
              open,
              ...(open ? {} : { path: undefined, display: undefined, kind: undefined }),
            }))
          }
        >
          <ContextMenu.Trigger as="div">
            <div
              data-component="markdown"
              classList={{
                ...local.classList,
                [local.class ?? ""]: !!local.class,
              }}
              ref={setRoot}
              on:contextmenu={handleFileReferenceContextMenu}
              {...others}
            />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <Show when={menu().kind === "directory" && menu().path && effectiveFileReferences()?.onOpenInApp}>
                <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onOpenInApp?.(menu().path!)}>
                  <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.browseInApp")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
              <Show when={menu().kind === "file" && menu().path && effectiveFileReferences()?.onPreviewPath}>
                <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onPreviewPath?.(menu().path!)}>
                  <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.open")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
              <Show when={menu().kind === "file" && menu().path && effectiveFileReferences()?.onReviewPath}>
                <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onReviewPath?.(menu().path!)}>
                  <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.reviewDiff")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
              <Show when={menu().path && effectiveFileReferences()?.onOpenDefaultApp}>
                <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onOpenDefaultApp?.(menu().path!)}>
                  <Show when={effectiveFileReferences()?.openWithApps?.[0]?.icon}>
                    <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                      <AppIcon id={effectiveFileReferences()?.openWithApps?.[0]?.icon!} />
                    </div>
                  </Show>
                  <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.openDefaultApp")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
              <Show when={menu().kind === "file" && menu().path && effectiveFileReferences()?.onOpenFolder}>
                <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onOpenFolder?.(menu().path!)}>
                  <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.openFolder")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
              <Show
                when={
                  (effectiveFileReferences()?.openWithApps?.length ?? 0) > 0 &&
                  menu().path &&
                  effectiveFileReferences()?.onOpenWith
                }
              >
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger>{i18n.t("ui.fileReference.openWith")}</ContextMenu.SubTrigger>
                  <ContextMenu.SubContent>
                    <For each={effectiveFileReferences()?.openWithApps ?? []}>
                      {(app) => (
                        <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onOpenWith?.(menu().path!, app.openWith)}>
                          <Show when={app.icon}>
                            <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                              <AppIcon id={app.icon!} />
                            </div>
                          </Show>
                          <ContextMenu.ItemLabel>{app.label}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                      )}
                    </For>
                  </ContextMenu.SubContent>
                </ContextMenu.Sub>
              </Show>
              <Show when={menu().path && effectiveFileReferences()?.onCopyPath}>
                <ContextMenu.Item onSelect={() => effectiveFileReferences()?.onCopyPath?.(menu().path!)}>
                  <ContextMenu.ItemLabel>{i18n.t("ui.fileReference.copyPath")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
      </Show>
    </>
  )
}
