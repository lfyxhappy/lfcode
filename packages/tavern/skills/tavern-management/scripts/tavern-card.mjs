#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { inflateSync } from "node:zlib"

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export async function readTavernCard(file) {
  if (path.extname(file).toLowerCase() === ".json") return parseCard(await readFile(file, "utf8"))
  if (path.extname(file).toLowerCase() !== ".png") throw new Error("Character card must be a .json or .png file")
  const buffer = await readFile(file)
  const payload = pngChunks(buffer)
    .map((chunk) => charaText(chunk.type, chunk.data))
    .find((value) => value !== undefined)
  if (!payload) throw new Error("PNG does not contain a valid chara character-card payload")
  return parseCard(Buffer.from(payload, "base64").toString("utf8"))
}

export async function writeTavernCard(input, cardFile, output) {
  if (path.resolve(input) === path.resolve(output)) throw new Error("Write translated output to a new file")
  const card = parseCard(await readFile(cardFile, "utf8"))
  const extension = path.extname(input).toLowerCase()
  if (extension === ".json") {
    if (path.extname(output).toLowerCase() !== ".json") throw new Error("A JSON source must write to a .json output")
    await writeFile(output, JSON.stringify(card, null, 2) + "\n", "utf8")
    return
  }
  if (extension !== ".png" || path.extname(output).toLowerCase() !== ".png") {
    throw new Error("A PNG source must write to a separate .png output")
  }

  const chunks = pngChunks(await readFile(input)).filter((chunk) => !isCharaChunk(chunk.type, chunk.data))
  const iend = chunks.findIndex((chunk) => chunk.type === "IEND")
  if (iend < 0) throw new Error("PNG is missing its IEND chunk")
  const payload = Buffer.concat([
    Buffer.from("chara\0", "latin1"),
    Buffer.from(Buffer.from(JSON.stringify(card), "utf8").toString("base64"), "latin1"),
  ])
  const next = Buffer.concat([
    signature,
    ...chunks.slice(0, iend).map((chunk) => chunk.raw),
    pngChunk("tEXt", payload),
    ...chunks.slice(iend).map((chunk) => chunk.raw),
  ])
  await writeFile(output, next)
}

function pngChunks(buffer) {
  if (buffer.length < signature.length || !buffer.subarray(0, signature.length).equals(signature)) {
    throw new Error("File is not a PNG image")
  }
  const result = []
  for (let offset = signature.length; offset + 12 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) throw new Error("PNG contains a truncated chunk")
    result.push({
      type: buffer.toString("latin1", offset + 4, offset + 8),
      data: buffer.subarray(offset + 8, offset + 8 + length),
      raw: buffer.subarray(offset, end),
    })
    offset = end
  }
  if (!result.some((chunk) => chunk.type === "IEND")) throw new Error("PNG is missing its IEND chunk")
  return result
}

function charaText(type, data) {
  const zero = data.indexOf(0)
  if (zero === -1 || data.subarray(0, zero).toString("latin1") !== "chara") return
  try {
    if (type === "tEXt") return data.subarray(zero + 1).toString("latin1")
    if (type === "zTXt" && data[zero + 1] === 0) return inflateSync(data.subarray(zero + 2)).toString("latin1")
    if (type !== "iTXt") return
    const languageEnd = data.indexOf(0, zero + 3)
    if (languageEnd === -1) return
    const translatedEnd = data.indexOf(0, languageEnd + 1)
    if (translatedEnd === -1) return
    const text = data.subarray(translatedEnd + 1)
    if (data[zero + 1] === 0) return text.toString("utf8")
    if (data[zero + 1] === 1 && data[zero + 2] === 0) return inflateSync(text).toString("utf8")
  } catch {
    return
  }
}

function isCharaChunk(type, data) {
  if (type !== "tEXt" && type !== "zTXt" && type !== "iTXt") return false
  const zero = data.indexOf(0)
  return zero !== -1 && data.subarray(0, zero).toString("latin1") === "chara"
}

function parseCard(value) {
  const card = JSON.parse(value)
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error("Character card JSON must be an object")
  return card
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "latin1")
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  typeBytes.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8)
  return result
}

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

async function main() {
  const [command, input, cardFile, output] = process.argv.slice(2)
  if (command === "read" && input && !cardFile && !output) {
    process.stdout.write(JSON.stringify(await readTavernCard(input), null, 2) + "\n")
    return
  }
  if (command === "write" && input && cardFile && output) {
    await writeTavernCard(input, cardFile, output)
    return
  }
  throw new Error("Usage: tavern-card.mjs read <card.json|card.png> | write <source> <translated.json> <output>")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
