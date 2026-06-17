#!/usr/bin/env bun

import { Script } from "@lfcode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const tag = `v${Script.version}`

if (!Script.preview) {
  const existing = await $`gh release view ${tag} --json tagName,databaseId --repo ${process.env.GH_REPO}`
    .json()
    .catch(() => undefined) as
    | {
        tagName: string
        databaseId: number
      }
    | undefined

  if (existing) {
    output.push(`release=${existing.databaseId}`)
    output.push(`tag=${existing.tagName}`)
  }
  else {
    await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd())
    const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
    const body = await Bun.file(file)
      .text()
      .catch(() => "No notable changes")
    const dir = process.env.RUNNER_TEMP ?? "/tmp"
    const notesFile = `${dir}/lfcode-release-notes.txt`
    await Bun.write(notesFile, body)
    await $`gh release create ${tag} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile} --repo ${process.env.GH_REPO}`
    const release = await $`gh release view ${tag} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
    output.push(`release=${release.databaseId}`)
    output.push(`tag=${release.tagName}`)
  }
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
