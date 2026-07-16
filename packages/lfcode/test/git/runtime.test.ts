import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { resolveGitCommand } from "../../src/git/runtime"

const roots: string[] = []

afterEach(async () => {
  delete process.env.LFCODE_GIT_PATH
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("git runtime", () => {
  test("prefers bundled git path when provided", async () => {
    const root = path.join(tmpdir(), `lfcode-git-runtime-${process.pid}-${Date.now()}`)
    const gitPath = path.join(root, "git.exe")
    roots.push(root)
    await mkdir(root, { recursive: true })
    await writeFile(gitPath, "")
    process.env.LFCODE_GIT_PATH = gitPath
    expect(resolveGitCommand()).toBe(gitPath)
  })

  test("falls back to git command when bundled path is absent", () => {
    delete process.env.LFCODE_GIT_PATH
    expect(resolveGitCommand()).toBe("git")
  })
})
