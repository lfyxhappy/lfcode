import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"

export const IMAGE_THUMBNAIL_MAX_BYTES = 256 * 1024
export const IMAGE_THUMBNAIL_MAX_EDGE = 480
export const IMAGE_THUMBNAIL_ROOT_MARGIN = "240px"
export const IMAGE_THUMBNAIL_CACHE_MAX_ENTRIES = 48
export const IMAGE_THUMBNAIL_CACHE_MAX_BYTES = 16 * 1024 * 1024

type ThumbnailCacheValue =
  | { status: "pending"; promise: Promise<string | undefined>; bytes: number }
  | { status: "ready"; value: string | undefined; bytes: number }

const thumbnailCache = new Map<string, ThumbnailCacheValue>()
let thumbnailCacheBytes = 0
let thumbnailCacheLimits = {
  maxEntries: IMAGE_THUMBNAIL_CACHE_MAX_ENTRIES,
  maxBytes: IMAGE_THUMBNAIL_CACHE_MAX_BYTES,
}

export function estimateDataUrlBytes(url: string) {
  const prefix = "base64,"
  const index = url.indexOf(prefix)
  if (index === -1) return
  const body = url.slice(index + prefix.length)
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding)
}

export function shouldGenerateImageThumbnail(input: {
  src: string
  byteSize?: number
  maxBytes?: number
}) {
  if (!input.src.startsWith("data:image/")) return false
  const byteSize = input.byteSize ?? estimateDataUrlBytes(input.src)
  if (byteSize === undefined) return false
  return byteSize > (input.maxBytes ?? IMAGE_THUMBNAIL_MAX_BYTES)
}

export async function prepareImagePreview(input: {
  src: string
  byteSize?: number
  maxBytes?: number
  maxEdge?: number
  cacheKey?: string
}) {
  const byteSize = input.byteSize ?? estimateDataUrlBytes(input.src)
  if (!shouldGenerateImageThumbnail({ src: input.src, byteSize, maxBytes: input.maxBytes })) {
    return {
      byteSize,
      previewDataUrl: undefined,
    }
  }

  return {
    byteSize,
    previewDataUrl: await getCachedThumbnail({
      src: input.src,
      maxEdge: input.maxEdge,
      cacheKey: input.cacheKey,
    }),
  }
}

async function getCachedThumbnail(input: { src: string; maxEdge?: number; cacheKey?: string }) {
  const key = `${input.cacheKey ?? input.src}|${input.maxEdge ?? IMAGE_THUMBNAIL_MAX_EDGE}`
  const cached = thumbnailCache.get(key)
  if (cached?.status === "ready") {
    touchThumbnailCacheKey(key)
    return cached.value
  }
  if (cached?.status === "pending") {
    touchThumbnailCacheKey(key)
    return cached.promise
  }

  const promise = generateImageThumbnail({
    src: input.src,
    maxEdge: input.maxEdge,
  }).then((value) => {
    const current = thumbnailCache.get(key)
    if (current?.status === "pending" && current.promise === promise) {
      setThumbnailCacheEntry(key, {
        status: "ready",
        value,
        bytes: value?.length ? value.length * 2 : 0,
      })
    }
    return value
  })

  setThumbnailCacheEntry(key, {
    status: "pending",
    promise,
    bytes: input.src.length * 2,
  })
  return promise
}

function touchThumbnailCacheKey(key: string) {
  const entry = thumbnailCache.get(key)
  if (!entry) return
  thumbnailCache.delete(key)
  thumbnailCache.set(key, entry)
}

function setThumbnailCacheEntry(key: string, entry: ThumbnailCacheValue) {
  const previous = thumbnailCache.get(key)
  if (previous) {
    thumbnailCacheBytes -= previous.bytes
    thumbnailCache.delete(key)
  }
  thumbnailCache.set(key, entry)
  thumbnailCacheBytes += entry.bytes
  enforceThumbnailCacheLimits()
}

function enforceThumbnailCacheLimits() {
  while (thumbnailCache.size > thumbnailCacheLimits.maxEntries || thumbnailCacheBytes > thumbnailCacheLimits.maxBytes) {
    const oldestKey = thumbnailCache.keys().next().value as string | undefined
    if (!oldestKey) return
    const entry = thumbnailCache.get(oldestKey)
    if (!entry) continue
    thumbnailCache.delete(oldestKey)
    thumbnailCacheBytes -= entry.bytes
  }
}

export function setThumbnailCacheEntryForTest(key: string, bytes: number) {
  setThumbnailCacheEntry(key, {
    status: "ready",
    value: `data:image/webp;base64,${"A".repeat(Math.max(1, Math.floor(bytes / 2)))}`,
    bytes,
  })
}

export function resetThumbnailCache() {
  thumbnailCache.clear()
  thumbnailCacheBytes = 0
  thumbnailCacheLimits = {
    maxEntries: IMAGE_THUMBNAIL_CACHE_MAX_ENTRIES,
    maxBytes: IMAGE_THUMBNAIL_CACHE_MAX_BYTES,
  }
}

export function setThumbnailCacheLimits(input: Partial<typeof thumbnailCacheLimits>) {
  thumbnailCacheLimits = {
    maxEntries: input.maxEntries ?? thumbnailCacheLimits.maxEntries,
    maxBytes: input.maxBytes ?? thumbnailCacheLimits.maxBytes,
  }
  enforceThumbnailCacheLimits()
}

export function getThumbnailCacheEntryCount() {
  return thumbnailCache.size
}

export function getThumbnailCacheBytes() {
  return thumbnailCacheBytes
}

async function generateImageThumbnail(input: { src: string; maxEdge?: number }) {
  if (typeof document === "undefined") return
  const maxEdge = input.maxEdge ?? IMAGE_THUMBNAIL_MAX_EDGE

  try {
    if (typeof createImageBitmap === "function" && typeof fetch === "function") {
      const bitmap = await createImageBitmap(await (await fetch(input.src)).blob())
      try {
        return renderThumbnail({
          width: bitmap.width,
          height: bitmap.height,
          draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
          mime: "image/webp",
          maxEdge,
        })
      } finally {
        bitmap.close()
      }
    }
  } catch {}

  try {
    const image = await loadImage(input.src)
    return renderThumbnail({
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      mime: "image/webp",
      maxEdge,
    })
  } catch {
    return
  }
}

function renderThumbnail(input: {
  width: number
  height: number
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void
  mime: string
  maxEdge: number
}) {
  if (!input.width || !input.height) return
  const scale = Math.min(1, input.maxEdge / Math.max(input.width, input.height))
  const width = Math.max(1, Math.round(input.width * scale))
  const height = Math.max(1, Math.round(input.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) return
  context.imageSmoothingEnabled = true
  input.draw(context, width, height)

  try {
    return canvas.toDataURL(input.mime, 0.82)
  } catch {
    return
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("failed to load image"))
    image.src = src
  })
}

export function ThumbnailImage(props: {
  src: string
  resolveSrc?: () => string | undefined | Promise<string | undefined>
  alt: string
  previewSrc?: string
  byteSize?: number
  cacheKey?: string
  maxBytes?: number
  maxEdge?: number
  slot?: string
  class?: string
  placeholderClass?: string
}) {
  const [sourceSrc, setSourceSrc] = createSignal<string | undefined>(props.resolveSrc ? undefined : props.src)
  const loadingSource = createMemo(() => !!props.resolveSrc && !sourceSrc())

  createEffect(() => {
    if (!props.resolveSrc) {
      setSourceSrc(props.src)
      return
    }
    setSourceSrc(undefined)
  })

  const oversized = createMemo(() =>
    shouldGenerateImageThumbnail({
      src: sourceSrc() ?? "",
      byteSize: props.byteSize,
      maxBytes: props.maxBytes,
    }),
  )
  const immediateSrc = createMemo(() => {
    const src = sourceSrc()
    if (!src) return
    return props.previewSrc ?? (oversized() ? undefined : src)
  })
  const [resolvedSrc, setResolvedSrc] = createSignal<string | undefined>(immediateSrc())
  const [active, setActive] = createSignal(!!props.previewSrc || typeof IntersectionObserver !== "function")
  let placeholderRef: HTMLDivElement | undefined

  createEffect(() => {
    setResolvedSrc(immediateSrc())
  })

  createEffect(() => {
    if (sourceSrc()) return
    if (!props.resolveSrc) return
    if (!active()) return

    let cancelled = false
    void Promise.resolve(props.resolveSrc()).then((value) => {
      if (cancelled) return
      setSourceSrc(value)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    if (loadingSource()) return
    if (!oversized()) {
      setActive(true)
      return
    }
    if (props.previewSrc) {
      setActive(true)
      return
    }
    if (typeof IntersectionObserver !== "function") {
      setActive(true)
    }
  })

  createEffect(() => {
    if (loadingSource()) return
    if (!oversized()) return
    if (resolvedSrc()) return
    if (active()) return
    if (!placeholderRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setActive(true)
        observer.disconnect()
      },
      { rootMargin: IMAGE_THUMBNAIL_ROOT_MARGIN },
    )

    observer.observe(placeholderRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (loadingSource()) return
    if (resolvedSrc()) return
    if (!active()) return
    if (!oversized()) return

    let cancelled = false
    void getCachedThumbnail({
      src: sourceSrc()!,
      maxEdge: props.maxEdge,
      cacheKey: props.cacheKey,
    }).then((value) => {
      if (cancelled) return
      setResolvedSrc(value)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <Show
      when={resolvedSrc()}
      fallback={
        <div
          ref={placeholderRef}
          data-component="image-thumbnail-placeholder"
          data-slot={props.slot ? `${props.slot}-placeholder` : undefined}
          class={props.placeholderClass}
          aria-hidden="true"
        />
      }
    >
      <img
        src={resolvedSrc()!}
        alt={props.alt}
        loading="lazy"
        decoding="async"
        data-slot={props.slot}
        class={props.class}
      />
    </Show>
  )
}
