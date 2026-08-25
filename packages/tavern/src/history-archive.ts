import path from "node:path"
import { mkdir, rename, writeFile } from "node:fs/promises"

export async function archiveTavernHistory(input: { data: string; filename: string; base64: string }) {
  const filename = path.basename(input.filename)
  if (filename !== input.filename || !/\.(jsonl|json)$/i.test(filename)) throw new Error("Tavern history must be a JSON or JSONL file")
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0) throw new Error("Tavern history archive is not valid base64")
  const bytes = Buffer.from(input.base64, "base64")
  if (!bytes.length || bytes.length > 15_000_000) throw new Error("Tavern history archive is too large")
  const directory = path.join(input.data, "imports", "chats")
  await mkdir(directory, { recursive: true })
  const output = path.join(directory, `${crypto.randomUUID()}-${filename}`)
  await writeFile(output, bytes)
  return { path: path.relative(input.data, output).replaceAll("\\", "/") }
}

export async function writeTavernHistoryExport(input: { output: string; base64: string }) {
  if (!path.isAbsolute(input.output)) throw new Error("Tavern history export path must be absolute")
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0) throw new Error("Tavern history export is not valid base64")
  const bytes = Buffer.from(input.base64, "base64")
  if (!bytes.length || bytes.length > 15_000_000) throw new Error("Tavern history export is too large")
  const target = path.resolve(input.output)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, bytes, { flag: "wx" })
  await rename(temporary, target)
  return { filename: path.basename(target), bytes: bytes.length }
}
