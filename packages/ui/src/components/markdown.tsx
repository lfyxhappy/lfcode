import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import { useFileReferenceContext, type FileReferenceApp } from "../context/file-reference"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@lfcode-ai/shared/util/encode"
import { ComponentProps, createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { stream } from "./markdown-stream"
import {
  inferFileReferenceKind,
  isLocalFileHref,
  isPathLike,
  looksLikeCommand,
  stripTrailingPathPunctuation,
} from "./file-reference-path"
import { DropdownMenu } from "./dropdown-menu"
import { AppIcon } from "./app-icon"

type Entry = {
  hash: string
  html: string
}

type FileReferenceOptions = {
  enabled: boolean
  allowContextMenu?: boolean
  resolveRelativePath?: (value: string) => string | undefined
  onPreviewPath?: (path: string) => void
  onOpenDefaultApp?: (path: string) => void
  onOpenFolder?: (path: string) => void
  onOpenWith?: (path: string, app: string) => void
  onCopyPath?: (path: string) => void
  onReviewPath?: (path: string) => void
  openWithApps?: FileReferenceApp[]
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
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

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  const buttons = Array.from(parent.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    parent.appendChild(createCopyButton(labels))
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

function decorateMarkdownLinks(root: HTMLDivElement, options: FileReferenceOptions) {
  const links = Array.from(root.querySelectorAll("a"))
  for (const link of links) {
    const href = link.getAttribute("href") ?? ""
    if (!isLocalFileHref(href)) continue
    const value = stripTrailingPathPunctuation(href)
    const resolved = options.resolveRelativePath?.(value) ?? value
    if (!resolved) continue
    link.setAttribute("data-kind", "file-ref")
    link.setAttribute("data-path", resolved)
    link.setAttribute("data-display", link.textContent?.trim() || value)
    link.classList.add("file-reference")
    link.removeAttribute("target")
    link.removeAttribute("rel")
    link.href = "#"
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
    link.href = "#"
    link.className = "file-reference"
    link.setAttribute("data-kind", "file-ref")
    link.setAttribute("data-path", resolved)
    link.setAttribute("data-display", text)
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
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

  const pattern =
    /(?:[A-Za-z]:[\\/][^\s<>"'`]+|(?:\.{1,2}[\\/]|\/)[^\s<>"'`]+|[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+)/gu
  for (const node of targets) {
    const text = node.textContent ?? ""
    let match: RegExpExecArray | null
    let last = 0
    const fragment = document.createDocumentFragment()
    let changed = false

    while ((match = pattern.exec(text))) {
      const raw = match[0]
      const value = stripTrailingPathPunctuation(raw)
      if (!value || !isPathLike(value) || looksLikeCommand(value)) continue
      const resolved = options.resolveRelativePath?.(value) ?? value
      if (!resolved) continue

      changed = true
      if (match.index > last) fragment.append(text.slice(last, match.index))

      const link = document.createElement("a")
      link.href = "#"
      link.className = "file-reference"
      link.setAttribute("data-kind", "file-ref")
      link.setAttribute("data-path", resolved)
      link.setAttribute("data-display", value)
      link.textContent = value
      fragment.append(link)
      last = match.index + raw.length
    }

    if (!changed) continue
    if (last < text.length) fragment.append(text.slice(last))
    node.parentNode?.replaceChild(fragment, node)
  }
}

function setupFileReferenceActions(root: HTMLDivElement, options: FileReferenceOptions) {
  const click = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target.closest('[data-kind="file-ref"]') : null
    if (!(element instanceof HTMLElement)) return
    const path = element.dataset.path
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
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

function decorate(root: HTMLDivElement, labels: CopyLabels, fileReferences?: FileReferenceOptions) {
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels)
  }
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
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "streaming", "fileReferences", "class", "classList"])
  const marked = useMarked()
  const i18n = useI18n()
  const context = useFileReferenceContext()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [menuAnchor, setMenuAnchor] = createSignal<HTMLSpanElement>()
  const [menu, setMenu] = createSignal<ContextState>({ open: false })
  const effectiveFileReferences = createMemo<FileReferenceOptions | undefined>(() => {
    if (local.fileReferences) return local.fileReferences
    if (!context?.enableMarkdownDecorations) return
    return {
      enabled: true,
      allowContextMenu: context.allowContextMenu,
      resolveRelativePath: (value) => context.resolvePath?.(value, context.baseDir),
      onPreviewPath: context.onPreviewPath,
      onOpenDefaultApp: context.onOpenDefaultApp,
      onOpenFolder: context.onOpenFolder,
      onOpenWith: context.onOpenWith,
      onCopyPath: context.onCopyPath,
      onReviewPath: context.onReviewPath,
      openWithApps: context.openWithApps,
    }
  })
  const [html] = createResource(
    () => ({
      text: local.text,
      key: local.cacheKey,
      streaming: local.streaming ?? false,
    }),
    async (src) => {
      if (isServer) return fallback(src.text)
      if (!src.text) return ""

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

          const next = await Promise.resolve(marked.parse(block.src))
          const safe = sanitize(next)
          if (key && hash) touch(key, { hash, html: safe })
          return safe
        }),
      )
        .then((list) => list.join(""))
        .catch(() => fallback(src.text))
    },
    { initialValue: fallback(local.text) },
  )

  let copyCleanup: (() => void) | undefined
  let fileReferenceCleanup: (() => void) | undefined

  createEffect(() => {
    const container = root()
    const content = local.text ? (html.latest ?? html() ?? "") : ""
    if (!container) return
    if (isServer) return

    if (!content) {
      container.innerHTML = ""
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
    }
    const temp = document.createElement("div")
    temp.innerHTML = content
    decorate(temp, labels, effectiveFileReferences())

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (
          fromEl instanceof HTMLButtonElement &&
          toEl instanceof HTMLButtonElement &&
          fromEl.getAttribute("data-slot") === "markdown-copy-button" &&
          toEl.getAttribute("data-slot") === "markdown-copy-button" &&
          fromEl.getAttribute("data-copied") === "true"
        ) {
          setCopyState(toEl, labels, true)
        }
        if (fromEl.isEqualNode(toEl)) return false
        return true
      },
    })

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
  })

  createEffect(() => {
    const container = root()
    const options = effectiveFileReferences()
    if (!container || !options?.enabled || !options.allowContextMenu) return

    const handleContextMenu = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest('[data-kind="file-ref"]') : null
      if (!(element instanceof HTMLElement)) return
      const path = element.dataset.path
      if (!path) return
      event.preventDefault()
      event.stopPropagation()
      const anchor = menuAnchor()
      if (!anchor) return
      anchor.style.position = "fixed"
      anchor.style.left = `${event.clientX}px`
      anchor.style.top = `${event.clientY}px`
      anchor.style.width = "1px"
      anchor.style.height = "1px"
      setMenu({
        open: true,
        path,
        display: element.dataset.display,
        kind: inferFileReferenceKind(element.dataset.display ?? path),
      })
    }

    container.addEventListener("contextmenu", handleContextMenu)
    onCleanup(() => container.removeEventListener("contextmenu", handleContextMenu))
  })

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    if (fileReferenceCleanup) fileReferenceCleanup()
  })

  return (
    <>
      <div
        data-component="markdown"
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
        ref={setRoot}
        {...others}
      />
      <Show when={effectiveFileReferences()?.enabled && effectiveFileReferences()?.allowContextMenu}>
        <DropdownMenu open={menu().open} onOpenChange={(open) => setMenu((prev) => ({ ...prev, open }))}>
          <DropdownMenu.Trigger
            as="span"
            ref={setMenuAnchor}
            style={{ position: "fixed", left: "-10000px", top: "-10000px", width: "1px", height: "1px" }}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content anchorRef={menuAnchor}>
              <Show when={menu().path && effectiveFileReferences()?.onOpenDefaultApp}>
                <DropdownMenu.Item onSelect={() => effectiveFileReferences()?.onOpenDefaultApp?.(menu().path!)}>
                  <Show when={effectiveFileReferences()?.openWithApps?.[0]?.icon}>
                    <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                      <AppIcon id={effectiveFileReferences()?.openWithApps?.[0]?.icon!} />
                    </div>
                  </Show>
                  <DropdownMenu.ItemLabel>{i18n.t("ui.fileReference.openDefaultApp")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={menu().kind === "file" && menu().path && effectiveFileReferences()?.onOpenFolder}>
                <DropdownMenu.Item onSelect={() => effectiveFileReferences()?.onOpenFolder?.(menu().path!)}>
                  <DropdownMenu.ItemLabel>{i18n.t("ui.fileReference.openFolder")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show
                when={
                  (effectiveFileReferences()?.openWithApps?.length ?? 0) > 0 &&
                  menu().path &&
                  effectiveFileReferences()?.onOpenWith
                }
              >
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger>{i18n.t("ui.fileReference.openWith")}</DropdownMenu.SubTrigger>
                  <DropdownMenu.SubContent>
                    <For each={effectiveFileReferences()?.openWithApps ?? []}>
                      {(app) => (
                        <DropdownMenu.Item onSelect={() => effectiveFileReferences()?.onOpenWith?.(menu().path!, app.openWith)}>
                          <Show when={app.icon}>
                            <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                              <AppIcon id={app.icon!} />
                            </div>
                          </Show>
                          <DropdownMenu.ItemLabel>{app.label}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
              </Show>
              <Show when={menu().path && effectiveFileReferences()?.onCopyPath}>
                <DropdownMenu.Item onSelect={() => effectiveFileReferences()?.onCopyPath?.(menu().path!)}>
                  <DropdownMenu.ItemLabel>{i18n.t("ui.fileReference.copyPath")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
    </>
  )
}
