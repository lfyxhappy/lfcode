export function createSingleFlight<K, V>() {
  const pending = new Map<K, Promise<V>>()

  const run = (key: K, task: () => PromiseLike<V> | V) => {
    const current = pending.get(key)
    if (current) return current

    let resolveResult: (value: V | PromiseLike<V>) => void = () => undefined
    let rejectResult: (reason?: unknown) => void = () => undefined
    const result = new Promise<V>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    pending.set(key, result)

    try {
      Promise.resolve(task()).then(resolveResult, rejectResult)
    } catch (error) {
      rejectResult(error)
    }

    void result.then(
      () => pending.delete(key),
      () => pending.delete(key),
    )
    return result
  }

  return {
    run,
    has: (key: K) => pending.has(key),
  }
}
