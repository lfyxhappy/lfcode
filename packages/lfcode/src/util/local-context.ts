import { AsyncLocalStorage } from "async_hooks"

export class NotFound extends Error {
  constructor(public override readonly name: string) {
    super(`No context found for ${name}`)
  }
}

/** Supports bundled runtimes where duplicate module copies break instanceof. */
export function isNotFound(error: unknown, name?: string) {
  if (error instanceof NotFound) return name === undefined || error.name === name
  if (!(error instanceof Error)) return false
  if (name !== undefined && error.name !== name) return false
  return error.message === `No context found for ${name ?? error.name}`
}

export function create<T>(name: string) {
  const storage = new AsyncLocalStorage<T>()
  return {
    use() {
      const result = storage.getStore()
      if (!result) {
        throw new NotFound(name)
      }
      return result
    },
    provide<R>(value: T, fn: () => R) {
      return storage.run(value, fn)
    },
  }
}
