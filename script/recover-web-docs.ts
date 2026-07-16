#!/usr/bin/env bun
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { docsLocale } from "../packages/web/src/i18n/locales.ts"

const cwd = process.cwd()
const docsDir = path.join(cwd, "packages/web/src/content/docs")
const sourcePath = process.argv[2] ?? path.join(docsDir, "ar/acp.mdx")
const outputDir = process.argv[3] ?? path.join(cwd, ".codex-temp/recovered-web-docs")
const applyChanges = process.argv.includes("--apply")
const applyRoot = process.argv.includes("--include-root")

const rootDocs = Array.from(new Bun.Glob("*.mdx").scanSync({ cwd: docsDir })).sort()
if (rootDocs.length !== 36) {
  console.error(`Expected 36 root docs, found ${rootDocs.length}`)
  process.exit(1)
}

const localeDirs = await Promise.all(
  docsLocale.map(async (locale) => {
    try {
      const info = await stat(path.join(docsDir, locale))
      return info.isDirectory() ? locale : null
    } catch {
      return null
    }
  }),
).then((items) => items.filter((item): item is (typeof docsLocale)[number] => item !== null))

if (localeDirs.length === 0) {
  console.error("No locale directories found under packages/web/src/content/docs")
  process.exit(1)
}

const missingLocaleDirs = docsLocale.filter((locale) => !localeDirs.includes(locale))
const localeDocs = Array.from(new Bun.Glob("*.mdx").scanSync({ cwd: path.join(docsDir, localeDirs[0]) })).sort()
if (localeDocs.length !== 34) {
  console.error(`Expected 34 locale docs, found ${localeDocs.length} in ${localeDirs[0]}`)
  process.exit(1)
}

const source = await Bun.file(sourcePath).text()
const lines = source.split(/\r?\n/)
const titleIndexes = lines
  .map((line, index) => ({ line, index }))
  .filter((item) => item.line.startsWith("title: "))

const englishSequence = ["title: ACP Support", "title: Agents", "title: CLI", "title: Commands", "title: Config"]
const englishStart = titleIndexes.findIndex((item, index, array) =>
  englishSequence.every((title, offset) => array[index + offset]?.line === title),
)

if (englishStart < 0) {
  console.error("Failed to locate the English docs block in the polluted corpus")
  process.exit(1)
}

const expectedLocaleEntries = localeDirs.length * localeDocs.length
if (englishStart !== expectedLocaleEntries) {
  console.error(
    `Unexpected English block position. Expected ${expectedLocaleEntries} locale entries before English, found ${englishStart}`,
  )
  process.exit(1)
}

const expectedEntries = expectedLocaleEntries + rootDocs.length
if (titleIndexes.length !== expectedEntries) {
  console.error(`Expected ${expectedEntries} docs in corpus, found ${titleIndexes.length}`)
  process.exit(1)
}

const entries = titleIndexes.map((item, index) => {
  const start = item.index - 1
  if (lines[start] !== "---") {
    console.error(`Frontmatter start not found before line ${item.index + 1}`)
    process.exit(1)
  }
  const next = titleIndexes[index + 1]?.index ?? lines.length
  const end = next - 2
  return {
    title: item.line.replace(/^title:\s*/, "").replace(/^"(.*)"$/, "$1"),
    startLine: start + 1,
    endLine: end + 1,
    content: `${lines.slice(start, end + 1).join("\n").trimEnd()}\n`,
  }
})

const writes: Array<Promise<number>> = []
const manifest = {
  sourcePath,
  applyChanges,
  applyRoot,
  rootDocs,
  localeDocs,
  localeDirs,
  missingLocaleDirs,
  blocks: [] as Array<{
    locale: string
    count: number
    targetDir: string
    firstTitle: string
    lastTitle: string
  }>,
}

const rootEntryOffset = localeDirs.length * localeDocs.length
const rootTargetDir = applyChanges && applyRoot ? docsDir : path.join(outputDir, "root")
await mkdir(rootTargetDir, { recursive: true })
rootDocs.forEach((file, index) => {
  const entry = entries[rootEntryOffset + index]
  writes.push(Bun.write(path.join(rootTargetDir, file), entry.content))
})
manifest.blocks.push({
  locale: "root",
  count: rootDocs.length,
  targetDir: rootTargetDir,
  firstTitle: entries[rootEntryOffset].title,
  lastTitle: entries[rootEntryOffset + rootDocs.length - 1].title,
})

localeDirs.forEach((locale, localeIndex) => {
  const localeEntryOffset = localeIndex * localeDocs.length
  const targetDir = applyChanges ? path.join(docsDir, locale) : path.join(outputDir, locale)
  writes.push(mkdir(targetDir, { recursive: true }).then(() => 0))
  localeDocs.forEach((file, fileIndex) => {
    const entry = entries[localeEntryOffset + fileIndex]
    writes.push(Bun.write(path.join(targetDir, file), entry.content))
  })
  manifest.blocks.push({
    locale,
    count: localeDocs.length,
    targetDir,
    firstTitle: entries[localeEntryOffset].title,
    lastTitle: entries[localeEntryOffset + localeDocs.length - 1].title,
  })
})

await Promise.all(writes)
await mkdir(outputDir, { recursive: true })
await Bun.write(path.join(outputDir, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(
  JSON.stringify(
    {
      sourcePath,
      localeDirs,
      missingLocaleDirs,
      rootDocs: rootDocs.length,
      localeDocs: localeDocs.length,
      wroteRoot: applyChanges ? applyRoot : true,
      outputDir,
    },
    null,
    2,
  ),
)
