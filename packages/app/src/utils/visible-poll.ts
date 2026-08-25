export function startVisiblePolling(
  run: () => void | Promise<void>,
  intervalMs: number,
  options: { immediate?: boolean } = {},
) {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {}

  let alive = true
  let running = false
  let interval: number | undefined
  let nativeVisible = true
  let nativeVisibilityReady = !window.api?.getWindowVisibility
  let nativeVisibilityVersion = 0
  let refreshPending = false

  const isVisible = () => document.visibilityState === "visible" && nativeVisibilityReady && nativeVisible

  const stopInterval = () => {
    if (interval === undefined) return
    window.clearInterval(interval)
    interval = undefined
  }

  const invoke = () => {
    if (!alive || !isVisible() || running) return
    running = true
    void Promise.resolve()
      .then(run)
      .finally(() => {
        running = false
        if (!refreshPending || !isVisible()) return
        refreshPending = false
        invoke()
      })
  }

  const start = (forceImmediate = false) => {
    if (!alive || !isVisible()) return
    if (forceImmediate && running) refreshPending = true
    if (interval !== undefined) return
    if ((forceImmediate || options.immediate !== false) && !running) {
      refreshPending = false
      invoke()
    }
    interval = window.setInterval(invoke, intervalMs)
  }

  const onNativeVisibility = (visible: boolean, initial = false) => {
    nativeVisibilityVersion += 1
    nativeVisibilityReady = true
    nativeVisible = visible
    if (visible) {
      if (interval === undefined) start(!initial)
      return
    }
    stopInterval()
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      if (interval === undefined) start(true)
      return
    }
    stopInterval()
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  const removeNativeVisibilityListener = window.api?.onWindowVisibility?.(onNativeVisibility)
  if (window.api?.getWindowVisibility) {
    const version = nativeVisibilityVersion
    void window.api
      .getWindowVisibility()
      .then((visible) => {
        if (version !== nativeVisibilityVersion) return
        onNativeVisibility(visible, true)
      })
      .catch(() => {
        nativeVisibilityReady = true
        start()
      })
  } else {
    start()
  }

  return () => {
    alive = false
    stopInterval()
    document.removeEventListener("visibilitychange", onVisibilityChange)
    removeNativeVisibilityListener?.()
  }
}
