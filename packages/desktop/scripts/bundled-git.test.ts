import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { hasBundledGitRecommendedTools, isBundledGitDir, stageBundledGitRuntimeFrom } from "./bundled-git"

const roots: string[] = []

async function createFile(file: string, contents = "") {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, contents)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("bundled git staging", () => {
  test("keeps git core plus recommended ssh and less runtime paths", async () => {
    const root = path.join(tmpdir(), `lfcode-bundled-git-${process.pid}-${Date.now()}`)
    const source = path.join(root, "source")
    const stage = path.join(root, "stage")
    roots.push(root)

    await createFile(path.join(source, "cmd", "git.exe"))
    await createFile(path.join(source, "mingw64", "bin", "git.exe"))
    await createFile(path.join(source, "mingw64", "libexec", "git-core", "git-add.exe"))
    await createFile(path.join(source, "mingw64", "share", "git-core", "templates", "hooks", "README.sample"))
    await createFile(path.join(source, "mingw64", "etc", "ssl", "certs", "ca-bundle.crt"))
    await createFile(path.join(source, "usr", "bin", "ssh.exe"))
    await createFile(path.join(source, "usr", "bin", "less.exe"))
    await createFile(path.join(source, "usr", "lib", "ssh", "ssh_config"))
    await createFile(path.join(source, "usr", "share", "terminfo", "x", "xterm"))
    await createFile(path.join(source, "usr", "share", "vim", "vim90", "huge.txt"))
    await createFile(path.join(source, "LICENSE.txt"), "license")

    expect(isBundledGitDir(source)).toBe(true)

    const result = await stageBundledGitRuntimeFrom(source, stage)
    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(hasBundledGitRecommendedTools(stage)).toBe(true)
    expect(Bun.file(path.join(stage, "cmd", "git.exe")).size).toBeGreaterThanOrEqual(0)
    expect(Bun.file(path.join(stage, "usr", "bin", "ssh.exe")).size).toBeGreaterThanOrEqual(0)
    expect(Bun.file(path.join(stage, "usr", "bin", "less.exe")).size).toBeGreaterThanOrEqual(0)
    expect(existsSync(path.join(stage, "mingw64", "share", "git-core", "templates", "hooks", "README.sample"))).toBe(true)
    expect(existsSync(path.join(stage, "usr", "share", "vim", "vim90", "huge.txt"))).toBe(false)
  })
})
