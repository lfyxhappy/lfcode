export type TavernExportFile = {
  base64: string
  filename: string
  mime: string
}

export function downloadTavernExport(input: TavernExportFile) {
  if (!input.base64 || !input.filename || !input.mime) throw new Error("酒馆导出文件无效")
  const binary = atob(input.base64)
  const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: input.mime }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = input.filename
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
