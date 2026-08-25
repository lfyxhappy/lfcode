import path from "node:path"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"

const maximumVisualAssetBytes = 12 * 1024 * 1024

const mimeByExtension = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const

export type TavernVisualAsset = {
  path: string
  mime: (typeof mimeByExtension)[keyof typeof mimeByExtension]
}

export async function putTavernVisualAsset(input: {
  data: string
  filename: string
  base64: string
}): Promise<TavernVisualAsset> {
  const filename = safeFilename(input.filename)
  const extension = path.extname(filename).toLowerCase() as keyof typeof mimeByExtension
  const mime = mimeByExtension[extension]
  if (!mime) throw new Error("Tavern visual asset must be PNG, JPEG, GIF, or WebP")
  const bytes = decodeVisualAsset(input.base64)
  if (!matchesImageSignature(bytes, mime)) throw new Error("Tavern visual asset does not match its image type")
  const directory = path.join(input.data, "visuals")
  const output = path.join(directory, `${crypto.randomUUID()}-${filename}`)
  await mkdir(directory, { recursive: true })
  await writeFile(output, bytes, { flag: "wx" })
  return { path: path.relative(input.data, output).replaceAll("\\", "/"), mime }
}

export async function readTavernVisualAssets(input: { data: string; paths: string[] }) {
  const unique = [...new Set(input.paths)].slice(0, 4)
  const assets = await Promise.all(
    unique.map(async (requested) => {
      const file = readableVisualAssetPath(input.data, requested)
      if (!file) return
      const bytes = await readFile(file).catch(() => undefined)
      if (!bytes || !bytes.length || bytes.length > maximumVisualAssetBytes) return
      const extension = path.extname(file).toLowerCase() as keyof typeof mimeByExtension
      const mime = mimeByExtension[extension]
      if (!mime || !matchesImageSignature(bytes, mime)) return
      return [requested, `data:${mime};base64,${bytes.toString("base64")}`] as const
    }),
  )
  return Object.fromEntries(assets.flatMap((item) => (item ? [item] : [])))
}

export async function removeTavernVisualAsset(input: { data: string; path: string }) {
  const file = storedVisualAssetPath(input.data, input.path)
  if (!file) throw new Error("Tavern visual asset path is invalid")
  await unlink(file).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return
    throw cause
  })
  return { deleted: true }
}

function decodeVisualAsset(base64: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0)
    throw new Error("Tavern visual asset is not valid base64")
  const bytes = Buffer.from(base64, "base64")
  if (!bytes.length || bytes.length > maximumVisualAssetBytes)
    throw new Error("Tavern visual asset is empty or too large")
  return bytes
}

function safeFilename(value: string) {
  const filename = path.basename(value).replace(/[^\w.()\-\u4e00-\u9fff]/g, "_")
  if (!filename || filename === ".") throw new Error("Tavern visual asset file name is invalid")
  return filename
}

function readableVisualAssetPath(data: string, requested: string) {
  if (requested.startsWith("visuals/")) return storedVisualAssetPath(data, requested)
  if (requested.startsWith("imports/characters/")) return assetPath(data, "imports/characters", requested)
  if (requested.startsWith("characters/")) return assetPath(data, "migration-vault/sillytavern/source/characters", requested)
}

function storedVisualAssetPath(data: string, requested: string) {
  return assetPath(data, "visuals", requested)
}

function assetPath(data: string, directory: string, requested: string) {
  if (requested.includes("\\") || requested.includes("..") || path.isAbsolute(requested)) return
  const prefix = directory === "migration-vault/sillytavern/source/characters" ? "characters/" : `${directory}/`
  if (!requested.startsWith(prefix)) return
  const root = path.resolve(data, directory)
  const target = path.resolve(root, requested.slice(prefix.length))
  if (!target.startsWith(`${root}${path.sep}`)) return
  return target
}

function matchesImageSignature(bytes: Buffer, mime: TavernVisualAsset["mime"]) {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (mime === "image/gif")
    return bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a"
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
}
