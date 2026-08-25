type ClipboardImage = {
  isEmpty(): boolean
  toPNG(): Uint8Array
  getSize(): { width: number; height: number }
}

export function clipboardImagePayload(image: ClipboardImage) {
  if (image.isEmpty()) return null
  const png = image.toPNG()
  const size = image.getSize()
  return {
    buffer: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    width: size.width,
    height: size.height,
  }
}
