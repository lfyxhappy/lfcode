export const wideSessionLayoutMinWidth = 1024
export const wideSessionLayoutQuery = `(min-width: ${wideSessionLayoutMinWidth}px)`

export function isWideSessionLayout(width: number) {
  return width >= wideSessionLayoutMinWidth
}
