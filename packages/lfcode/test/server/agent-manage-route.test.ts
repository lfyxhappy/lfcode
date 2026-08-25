import fs from "fs/promises"
import os from "os"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Global } from "../../src/global"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

type ManageItem = {
  id: string
  config: Record<string, unknown>
  native: { scope: "native" } | null
  global: { path: string; config: Record<string, unknown>; prompt: string } | null
  project: { path: string; config: Record<string, unknown>; prompt: string } | null
  effective: { config: Record<string, unknown>; prompt: string } | null
  source: string
  origins: string[]
}

const app = Server.Default().app

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

describe("agent manage routes", () => {
  test("lists the 14 native subagent presets without internal agents", async () => {
    await using tmp = await managedTmpdir()
    await withManagedPaths(tmp.path, async () => {
      const response = await request(tmp.path, "/agent/manage")
      expect(response.status).toBe(200)
      const body = (await response.json()) as { items: ManageItem[] }
      expect(body.items.map((item) => item.id).sort()).toEqual([
        "database",
        "debugger",
        "docs",
        "explore",
        "frontend",
        "general",
        "implementer",
        "performance",
        "planner",
        "release",
        "researcher",
        "reviewer",
        "security",
        "tester",
      ])
      expect(body.items.find((item) => item.id === "general")?.native).toEqual(expect.objectContaining({ scope: "native" }))
      expect(body.items.map((item) => item.id)).not.toContain("build")
      expect(body.items.map((item) => item.id)).not.toContain("plan")
      expect(body.items.map((item) => item.id)).not.toContain("title")
    })
  })

  test("refreshes agent definitions without disposing active instances", async () => {
    await using tmp = await managedTmpdir()
    await withManagedPaths(tmp.path, async () => {
      await managedItem(tmp.path, "explore")
      expect(Instance.has(tmp.path)).toBe(true)

      const saved = await request(tmp.path, "/agent/manage/explore", {
        method: "PUT",
        body: {
          scope: "project",
          config: { mode: "subagent", description: "Updated without interruption" },
        },
      })
      expect(saved.status).toBe(200)
      expect(Instance.has(tmp.path)).toBe(true)

      const refreshed = await managedItem(tmp.path, "explore")
      expect(refreshed.effective?.config.description).toBe("Updated without interruption")
    })
  })

  test("writes global and project overrides, then restores global inheritance after deletion", async () => {
    await using tmp = await managedTmpdir()
    await withManagedPaths(tmp.path, async (global) => {
      const globalPut = await request(tmp.path, "/agent/manage/explore", {
        method: "PUT",
        body: {
          scope: "global",
          config: { mode: "subagent", description: "Global explore", default_execution: "wait" },
          prompt: "Global prompt",
        },
      })
      expect(globalPut.status).toBe(200)
      expect(await Bun.file(path.join(global, "agent", "explore.md")).exists()).toBe(true)

      const projectPut = await request(tmp.path, "/agent/manage/explore", {
        method: "PUT",
        body: {
          scope: "project",
          config: { mode: "subagent", description: "Project explore" },
          prompt: "Project prompt",
        },
      })
      expect(projectPut.status).toBe(200)
      expect(await Bun.file(path.join(tmp.path, ".lfcode", "agent", "explore.md")).exists()).toBe(true)

      const project = await managedItem(tmp.path, "explore")
      expect(project.source).toBe("project")
      expect(project.origins).toEqual(["native", "global", "project"])
      expect(project.global?.config.description).toBe("Global explore")
      expect(project.project?.config.description).toBe("Project explore")
      expect(project.effective?.config.description).toBe("Project explore")
      expect(project.effective?.config.default_execution).toBe("wait")
      expect(project.effective?.prompt).toBe("Project prompt")

      const deleted = await request(tmp.path, "/agent/manage/explore?scope=project", { method: "DELETE" })
      expect(deleted.status).toBe(200)
      expect(await Bun.file(path.join(tmp.path, ".lfcode", "agent", "explore.md")).exists()).toBe(false)

      const restored = await managedItem(tmp.path, "explore")
      expect(restored.source).toBe("global")
      expect(restored.effective?.config.description).toBe("Global explore")
      expect(restored.effective?.prompt).toBe("Global prompt")

      const nativeDelete = await request(tmp.path, "/agent/manage/explore?scope=global", { method: "DELETE" })
      expect(nativeDelete.status).toBe(200)
      const native = await managedItem(tmp.path, "explore")
      expect(native.source).toBe("native")
      expect(native.global).toBeNull()
      expect(native.effective?.config.description).toBe("快速定位文件、调用链、配置和现有实现，只做只读调查。")
    })
  })

  test("creates a custom subagent with the minimum read-only baseline", async () => {
    await using tmp = await managedTmpdir()
    await withManagedPaths(tmp.path, async () => {
      const response = await request(tmp.path, "/agent/manage/readonly_custom", {
        method: "PUT",
        body: {
          scope: "global",
          config: { description: "Read-only custom agent" },
        },
      })
      expect(response.status).toBe(200)

      const item = await managedItem(tmp.path, "readonly_custom")
      expect(item.native).toBeNull()
      expect(item.source).toBe("global")
      expect(item.global?.config.mode).toBe("subagent")
      expect(item.effective?.config.mode).toBe("subagent")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = await AppRuntime.runPromise(Agent.Service.use((service) => service.get("readonly_custom")))
          expect(Permission.evaluate("edit", "*", agent!.permission).action).toBe("deny")
          expect(Permission.evaluate("actor", "*", agent!.permission).action).toBe("deny")
        },
      })
    })
  })

  test("rejects internal IDs and path-like agent IDs, and never deletes a native definition", async () => {
    await using tmp = await managedTmpdir()
    await withManagedPaths(tmp.path, async () => {
      const reserved = await request(tmp.path, "/agent/manage/title", {
        method: "PUT",
        body: { scope: "global", config: {} },
      })
      expect(reserved.status).toBe(400)

      const primary = await request(tmp.path, "/agent/manage/build", {
        method: "PUT",
        body: { scope: "global", config: {} },
      })
      expect(primary.status).toBe(400)

      const invalid = await request(tmp.path, "/agent/manage/not.valid", {
        method: "PUT",
        body: { scope: "global", config: {} },
      })
      expect(invalid.status).toBe(400)

      const nativeDelete = await request(tmp.path, "/agent/manage/general?scope=global", { method: "DELETE" })
      expect(nativeDelete.status).toBe(404)
    })
  })
})

async function managedItem(directory: string, id: string) {
  const response = await request(directory, "/agent/manage")
  expect(response.status).toBe(200)
  const body = (await response.json()) as { items: ManageItem[] }
  const item = body.items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Missing managed agent ${id}`)
  return item
}

function request(directory: string, input: string, init?: { method?: string; body?: unknown }) {
  return app.request(input, {
    method: init?.method,
    headers: {
      "content-type": "application/json",
      "x-lfcode-directory": directory,
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

async function withManagedPaths<T>(root: string, fn: (global: string) => Promise<T>) {
  const global = path.join(root, "global-config")
  const home = path.join(root, "home")
  const original = {
    config: Global.Path.config,
    state: Global.Path.state,
    home: process.env.HOME,
    userprofile: process.env.USERPROFILE,
  }
  await fs.mkdir(global, { recursive: true })
  await fs.mkdir(home, { recursive: true })
  Object.assign(Global.Path, { config: global, state: path.join(root, "state") })
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    return await fn(global)
  } finally {
    await Instance.disposeAll().catch(() => undefined)
    Object.assign(Global.Path, { config: original.config, state: original.state })
    if (original.home === undefined) delete process.env.HOME
    else process.env.HOME = original.home
    if (original.userprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = original.userprofile
  }
}

async function managedTmpdir() {
  const dir = await fs.mkdtemp(path.join(process.env["LFCODE_TEST_TMPDIR_ROOT"] ?? os.tmpdir(), "lfcode-agent-manage-"))
  await Bun.$`git init`.cwd(dir).quiet()
  await Bun.$`git config core.fsmonitor false`.cwd(dir).quiet()
  await Bun.$`git config commit.gpgsign false`.cwd(dir).quiet()
  await Bun.$`git config user.email "test@lfcode.test"`.cwd(dir).quiet()
  await Bun.$`git config user.name "Test"`.cwd(dir).quiet()
  await Bun.$`git commit --allow-empty -m "agent manage test"`.cwd(dir).quiet()
  return {
    path: await fs.realpath(dir),
    async [Symbol.asyncDispose]() {
      await Instance.disposeAll().catch(() => undefined)
      Bun.gc(true)
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
          return
        } catch {
          await sleep(250)
        }
      }
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
    },
  }
}
