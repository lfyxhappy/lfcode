import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../src/util"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { provideInstance, tmpdir } from "../fixture/fixture"

const run = <A, E>(eff: Effect.Effect<A, E, File.Service>) =>
  Effect.runPromise(provideInstance(Instance.directory)(eff.pipe(Effect.provide(File.defaultLayer))))
const read = (file: string, options?: { referenceToken?: string }) => run(File.Service.use((svc) => svc.read(file, options)))
const list = (dir?: string) => run(File.Service.use((svc) => svc.list(dir)))
const stat = (file: string) => run(File.Service.use((svc) => svc.stat(file)))
const write = (input: { path: string; content: string }) => run(File.Service.use((svc) => svc.write(input)))
const grantReferenceDirectory = (dir: string) => run(File.Service.use((svc) => svc.grantReferenceDirectory(dir)))
const listReferenceDirectory = (input: { path: string; token?: string }) =>
  run(File.Service.use((svc) => svc.listReferenceDirectory(input)))

describe("Filesystem.contains", () => {
  test("allows paths within project", () => {
    expect(Filesystem.contains("/project", "/project/src")).toBe(true)
    expect(Filesystem.contains("/project", "/project/src/file.ts")).toBe(true)
    expect(Filesystem.contains("/project", "/project")).toBe(true)
  })

  test("blocks ../ traversal", () => {
    expect(Filesystem.contains("/project", "/project/../etc")).toBe(false)
    expect(Filesystem.contains("/project", "/project/src/../../etc")).toBe(false)
    expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
  })

  test("blocks absolute paths outside project", () => {
    expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
    expect(Filesystem.contains("/project", "/tmp/file")).toBe(false)
    expect(Filesystem.contains("/home/user/project", "/home/user/other")).toBe(false)
  })

  test("handles prefix collision edge cases", () => {
    expect(Filesystem.contains("/project", "/project-other/file")).toBe(false)
    expect(Filesystem.contains("/project", "/projectfile")).toBe(false)
  })
})

/*
 * Integration tests for read() and list() path traversal protection.
 *
 * These tests verify the HTTP API code path is protected. The HTTP endpoints
 * in server.ts (GET /file/content, GET /file) call read()/list()
 * directly - they do NOT go through ReadTool or the agent permission layer.
 *
 * This is a SEPARATE code path from ReadTool, which has its own checks.
 */
describe("File.read path traversal protection", () => {
  test("rejects ../ traversal attempting to read /etc/passwd", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "allowed.txt"), "allowed content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(read("../../../etc/passwd")).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })

  test("rejects deeply nested traversal", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(read("src/nested/../../../../../../../etc/passwd")).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })

  test("allows valid paths within project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "valid.txt"), "valid content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await read("valid.txt")
        expect(result.content).toBe("valid content")
      },
    })
  })
})

describe("File.list path traversal protection", () => {
  test("rejects ../ traversal attempting to list /etc", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(list("../../../etc")).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })

  test("allows valid subdirectory listing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "file.txt"), "content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await list("subdir")
        expect(Array.isArray(result)).toBe(true)
      },
    })
  })
})

describe("File.write path traversal protection", () => {
  test("rejects absolute paths outside the project", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(write({ path: path.join(outside.path, "outside.txt"), content: "blocked" })).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })
})

describe("File.stat path traversal protection", () => {
  test("rejects absolute paths outside the project", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "outside")
      },
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(stat(path.join(outside.path, "outside.txt"))).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })
})

describe("File.listReferenceDirectory", () => {
  test("lists only direct children of an existing absolute directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "entry.txt"), "content")
        await fs.mkdir(path.join(dir, "nested"), { recursive: true })
        await Bun.write(path.join(dir, "nested", "child.txt"), "content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grant = await grantReferenceDirectory(tmp.path)
        await expect(listReferenceDirectory({ path: tmp.path, token: grant.token })).resolves.toEqual([
          expect.objectContaining({ name: "nested", path: path.join(tmp.path, "nested"), type: "directory" }),
          expect.objectContaining({ name: "entry.txt", path: path.join(tmp.path, "entry.txt"), type: "file" }),
        ])
      },
    })
  })

  test("rejects relative paths, files, and missing directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grant = await grantReferenceDirectory(tmp.path)
        await expect(listReferenceDirectory({ path: "relative" })).rejects.toThrow("must be absolute")
        await expect(listReferenceDirectory({ path: path.join(tmp.path, "file.txt"), token: grant.token })).rejects.toThrow(
          "not a directory",
        )
        await expect(listReferenceDirectory({ path: path.join(tmp.path, "missing"), token: grant.token })).rejects.toThrow(
          "does not exist",
        )
      },
    })
  })

  test("requires a project-bound grant for external directories and files", async () => {
    await using project = await tmpdir()
    await using reference = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "allowed.txt"), "reference content")
      },
    })
    await using outside = await tmpdir()

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await Bun.write(path.join(outside.path, "outside.txt"), "outside")
        await expect(listReferenceDirectory({ path: reference.path })).rejects.toThrow("missing grant")
        await expect(read(path.join(reference.path, "allowed.txt"))).rejects.toThrow("missing grant")

        const grant = await grantReferenceDirectory(reference.path)
        await expect(listReferenceDirectory({ path: reference.path, token: grant.token })).resolves.toEqual([
          expect.objectContaining({ name: "allowed.txt", path: path.join(reference.path, "allowed.txt"), type: "file" }),
        ])
        await expect(read(path.join(reference.path, "allowed.txt"), { referenceToken: grant.token })).resolves.toMatchObject({
          exists: true,
          content: "reference content",
        })
        await expect(listReferenceDirectory({ path: path.dirname(reference.path), token: grant.token })).rejects.toThrow(
          "escapes granted directory",
        )

        const escaped = path.join(reference.path, "escape.txt")
        await fs.symlink(path.join(outside.path, "outside.txt"), escaped).catch(() => undefined)
        if (await fs.lstat(escaped).then(() => true, () => false)) {
          await expect(read(escaped, { referenceToken: grant.token })).rejects.toThrow("escapes granted directory")
        }
      },
    })

    await Instance.provide({
      directory: reference.path,
      fn: async () => {
        const foreign = await Instance.provide({
          directory: project.path,
          fn: () => grantReferenceDirectory(reference.path),
        })
        await expect(listReferenceDirectory({ path: reference.path, token: foreign.token })).rejects.toThrow("invalid grant")
      },
    })
  })
})

describe("Instance.containsPath", () => {
  test("returns true for path inside directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath(path.join(tmp.path, "foo.txt"))).toBe(true)
        expect(Instance.containsPath(path.join(tmp.path, "src", "file.ts"))).toBe(true)
      },
    })
  })

  test("returns true for path inside worktree but outside directory (monorepo subdirectory scenario)", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "packages", "lib")
    await fs.mkdir(subdir, { recursive: true })

    await Instance.provide({
      directory: subdir,
      fn: () => {
        // .lfcode at worktree root, but we're running from packages/lib
        expect(Instance.containsPath(path.join(tmp.path, ".lfcode", "state"))).toBe(true)
        // sibling package should also be accessible
        expect(Instance.containsPath(path.join(tmp.path, "packages", "other", "file.ts"))).toBe(true)
        // worktree root itself
        expect(Instance.containsPath(tmp.path)).toBe(true)
      },
    })
  })

  test("returns false for path outside both directory and worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath("/etc/passwd")).toBe(false)
        expect(Instance.containsPath("/tmp/other-project")).toBe(false)
      },
    })
  })

  test("returns false for path with .. escaping worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath(path.join(tmp.path, "..", "escape.txt"))).toBe(false)
      },
    })
  })

  test("handles directory === worktree (running from repo root)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.directory).toBe(Instance.worktree)
        expect(Instance.containsPath(path.join(tmp.path, "file.txt"))).toBe(true)
        expect(Instance.containsPath("/etc/passwd")).toBe(false)
      },
    })
  })

  test("non-git project does not allow arbitrary paths via worktree='/'", async () => {
    await using tmp = await tmpdir() // no git: true

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        // worktree is "/" for non-git projects, but containsPath should NOT allow all paths
        expect(Instance.containsPath(path.join(tmp.path, "file.txt"))).toBe(true)
        expect(Instance.containsPath("/etc/passwd")).toBe(false)
        expect(Instance.containsPath("/tmp/other")).toBe(false)
      },
    })
  })
})
