export function getFileReferenceEventElement(target: EventTarget | null) {
  const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const element = node?.closest('[data-kind="file-ref"]')
  return element instanceof HTMLElement ? element : null
}
