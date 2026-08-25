import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import { setTimeout as sleep } from "node:timers/promises"
import path from "path"
import matter from "gray-matter"
import { HTTPException } from "hono/http-exception"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { assertDiscoveryInstallInput, skillImportError } from "../../src/server/routes/instance/skills"
import { cleanupTmpdir, tmpdir } from "../fixture/fixture"

const originalFetch = globalThis.fetch
const tmpdirWithGit = { git: true }

afterEach(() => {
  globalThis.fetch = originalFetch
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
  Bun.gc(true)
  await sleep(800)
})

describe("skills routes", () => {
  test("GET /skills lists managed global skill entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await withManagedPaths(tmp.path, async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Bun.write(
            path.join(tmp.path, "global-home", ".lfcode", "skills", "route-skill", "SKILL.md"),
            `---\nname: route-skill\ndescription: Route test skill.\n---\n\n# Route Skill\n`,
          )
          await Bun.write(
            path.join(tmp.path, "global-home", ".lfcode", "skills", "route-skill", "agents", "openai.yaml"),
            'interface:\n  display_name: "Route Skill UI"\n  short_description: "Route Skill metadata"\n  default_prompt: "Use $route-skill"\n',
          )

          const previous = process.env["LFCODE_DISABLE_COMPOSE_SKILLS"]
          process.env["LFCODE_DISABLE_COMPOSE_SKILLS"] = "true"
          const response = await Server.Default().app.request("/skills", {
            method: "GET",
            headers: {
              "x-lfcode-directory": tmp.path,
            },
          })
          if (previous === undefined) delete process.env["LFCODE_DISABLE_COMPOSE_SKILLS"]
          else process.env["LFCODE_DISABLE_COMPOSE_SKILLS"] = previous

          expect(response.status).toBe(200)

          const body = (await response.json()) as Array<{ name: string; description: string; displayName?: string; shortDescription?: string }>
          expect(body.map((skill) => skill.name)).toContain("route-skill")
          expect(body.find((skill) => skill.name === "route-skill")?.description).toBe("Route test skill.")
          expect(body.find((skill) => skill.name === "route-skill")?.displayName).toBe("Route Skill UI")
          expect(body.find((skill) => skill.name === "route-skill")?.shortDescription).toBe("Route Skill metadata")
        },
      })
    })
    await disposeTestInstance(tmp.path)
  })

  test("GET /skills/manage/list only lists managed global skill entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await withManagedPaths(tmp.path, async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Bun.write(
            path.join(tmp.path, "global-home", ".lfcode", "skills", "local-only", "SKILL.md"),
            `---\nname: local-only\ndescription: Local only skill.\n---\n\n# Local Only\n`,
          )
          await Bun.write(
            path.join(tmp.path, ".lfcode", "skills", "project-local", "SKILL.md"),
            `---\nname: project-local\ndescription: Project local skill.\n---\n\n# Project Local\n`,
          )
          await Bun.write(
            path.join(tmp.path, "global-home", ".lfcode", "skills", "local-only", "agents", "openai.yaml"),
            'interface:\n  display_name: "Local Skill"\n  short_description: "Managed local Skill"\n  default_prompt: "Use $local-only"\npolicy:\n  allow_implicit_invocation: true\n',
          )

          const previous = process.env["LFCODE_DISABLE_COMPOSE_SKILLS"]
          process.env["LFCODE_DISABLE_COMPOSE_SKILLS"] = "true"
          const response = await Server.Default().app.request("/skills/manage/list", {
            method: "GET",
            headers: {
              "x-lfcode-directory": tmp.path,
            },
          })
          if (previous === undefined) delete process.env["LFCODE_DISABLE_COMPOSE_SKILLS"]
          else process.env["LFCODE_DISABLE_COMPOSE_SKILLS"] = previous

          expect(response.status).toBe(200)

          const body = (await response.json()) as Array<{ name: string; directory: string; displayName?: string; shortDescription?: string }>
          expect(body.map((skill) => skill.name)).toEqual(["local-only"])
          expect(body[0]?.directory).toBe("local-only")
          expect(body[0]?.displayName).toBe("Local Skill")
          expect(body[0]?.shortDescription).toBe("Managed local Skill")
        },
      })
    })
    await disposeTestInstance(tmp.path)
  })

  test("POST /skills/create safely serializes YAML-special descriptions", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    const response = await withManagedPaths(tmp.path, () =>
      Server.Default().app.request("/skills/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ name: "yaml-safe", description: "Create: validate # YAML safely" }),
      }),
    )

    await expectOk(response)
    const content = await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "yaml-safe", "SKILL.md")).text()
    const parsed = matter(content)
    expect(parsed.data).toMatchObject({ name: "yaml-safe", description: "Create: validate # YAML safely" })
    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "yaml-safe", "agents", "openai.yaml")).text()).toBe(
      'interface:\n  display_name: "Yaml Safe"\n  short_description: "Create: validate # YAML safely"\n  default_prompt: "Use $yaml-safe for: Create: validate # YAML safely"\npolicy:\n  allow_implicit_invocation: true\n',
    )
    await disposeTestInstance(tmp.path)
  })

  test("GET /skills/discover loads skills.sh entries and marks installed skills", async () => {
    await using tmp = await tmpdir({ git: true })
    globalThis.fetch = mock((input: URL | RequestInfo) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      if (url.pathname.endsWith("/sitemap-skills-1.xml")) {
        return Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://www.skills.sh/alpha/repo/alpha-skill</loc></url>
              <url><loc>https://www.skills.sh/beta/repo/beta-skill</loc></url>
            </urlset>`,
            { headers: { "content-type": "application/xml" } },
          ),
        )
      }
      if (url.pathname.endsWith("/sitemap-skills-2.xml")) {
        return Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
            { headers: { "content-type": "application/xml" } },
          ),
        )
      }
      if (url.pathname === "/alpha/repo/alpha-skill") {
        return Promise.resolve(
          new Response(
            `
              <html>
                <head>
                  <script type="application/ld+json">
                    {"@type":"SoftwareApplication","name":"Alpha Skill","description":"Alpha description"}
                  </script>
                </head>
                <body>
                  <code>npx skills add https://github.com/alpha/repo --skill alpha-skill</code>
                </body>
              </html>
            `,
            { headers: { "content-type": "text/html" } },
          ),
        )
      }
      if (url.pathname === "/beta/repo/beta-skill") {
        return Promise.resolve(
          new Response(
            `
              <html>
                <head>
                  <script type="application/ld+json">
                    {"@type":"SoftwareApplication","name":"Beta Skill","description":"Beta description"}
                  </script>
                </head>
                <body>
                  <code>npx skills add https://github.com/beta/repo --skill beta-skill</code>
                </body>
              </html>
            `,
            { headers: { "content-type": "text/html" } },
          ),
        )
      }
      return Promise.resolve(new Response("not found", { status: 404 }))
    }) as unknown as typeof globalThis.fetch

    await withManagedPaths(tmp.path, async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Bun.write(
            path.join(tmp.path, "global-home", ".lfcode", "skills", "alpha-skill", "SKILL.md"),
            `---\nname: alpha-skill\ndescription: Alpha local skill.\n---\n\n# Alpha Skill\n`,
          )

          const previous = process.env["LFCODE_DISABLE_COMPOSE_SKILLS"]
          process.env["LFCODE_DISABLE_COMPOSE_SKILLS"] = "true"
          const response = await Server.Default().app.request("/skills/discover?source=skills.sh&status=available&page=1&pageSize=24", {
            method: "GET",
            headers: {
              "x-lfcode-directory": tmp.path,
            },
          })
          if (previous === undefined) delete process.env["LFCODE_DISABLE_COMPOSE_SKILLS"]
          else process.env["LFCODE_DISABLE_COMPOSE_SKILLS"] = previous

          expect(response.status).toBe(200)

          const body = (await response.json()) as {
            items: Array<{ name: string; repository: string; installed: boolean }>
            repositories: Array<{ id: string; count: number }>
            total: number
          }
          expect(body.total).toBe(1)
          expect(body.items).toHaveLength(1)
          expect(body.items[0]?.name).toBe("Beta Skill")
          expect(body.items[0]?.repository).toBe("beta/repo")
          expect(body.items[0]?.installed).toBe(false)
          expect(body.repositories.map((item) => item.id)).toEqual(["alpha/repo", "beta/repo"])
          expect(body.repositories.find((item) => item.id === "alpha/repo")?.count).toBe(1)
        },
      })
    })
  })

  test("POST /skills/import imports a single skill directory", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    await writeSkill(path.join(tmp.path, "external", "single"), "single-import", "Single import.")

    const response = await withManagedPaths(tmp.path, () =>
      Server.Default().app.request("/skills/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ kind: "folder", source: path.join(tmp.path, "external", "single") }),
      }),
    )

    await expectOk(response)
    const body = (await response.json()) as Array<{ name: string; location: string }>
    expect(body.map((skill) => skill.name)).toEqual(["single-import"])
    expect(body[0]?.location).toContain(path.join("skills", "single", "SKILL.md"))
    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "single", "SKILL.md")).text()).not.toContain("auto_activate")
    await disposeTestInstance(tmp.path)
  })

  test("discovery install accepts only exact skills.sh URLs and maps remote failures to 400", () => {
    expect(() =>
      assertDiscoveryInstallInput({
        url: "https://127.0.0.1/private-skill",
        owner: "private",
        repo: "repo",
        skill: "private-skill",
      }),
    ).toThrow("exact HTTPS skills.sh entry URL")
    expect(() =>
      assertDiscoveryInstallInput({
        url: "https://www.skills.sh/owner/repo/remote-skill?redirect=1",
        owner: "owner",
        repo: "repo",
        skill: "remote-skill",
      }),
    ).toThrow("exact HTTPS skills.sh entry URL")
    expect(
      assertDiscoveryInstallInput({
        url: "https://www.skills.sh/owner/repo/remote-skill",
        owner: "owner",
        repo: "repo",
        skill: "remote-skill",
      }),
    ).toMatchObject({ skill: "remote-skill" })
    const remoteFailure = skillImportError(new Error("Remote 404"))
    expect(remoteFailure).toBeInstanceOf(HTTPException)
    if (!(remoteFailure instanceof HTTPException)) throw new Error("Expected a client import error")
    expect(remoteFailure.getResponse().status).toBe(400)
  })

  test("POST /skills/import imports multiple skill child directories", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    const source = path.join(tmp.path, "external", "many")
    await writeSkill(path.join(source, "alpha"), "alpha-import", "Alpha import.")
    await writeSkill(path.join(source, "beta"), "beta-import", "Beta import.")

    const response = await withManagedPaths(tmp.path, () =>
      Server.Default().app.request("/skills/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ kind: "folder", source }),
      }),
    )

    await expectOk(response)
    const body = (await response.json()) as Array<{ name: string }>
    expect(body.map((skill) => skill.name).toSorted()).toEqual(["alpha-import", "beta-import"])
    await disposeTestInstance(tmp.path)
  })

  test("POST /skills/import imports a zip and cleans extracted files", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    const zipPath = path.join(tmp.path, "zip-skill.zip")
    await Bun.write(
      zipPath,
      createStoredZip({
        "zip-root/SKILL.md": `---\nname: zip-import\ndescription: Zip import.\n---\n\n# Zip Import\n`,
      }),
    )

    const response = await withManagedPaths(tmp.path, () =>
      Server.Default().app.request("/skills/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ kind: "zip", source: zipPath }),
      }),
    )

    await expectOk(response)
    const body = (await response.json()) as Array<{ name: string; location: string }>
    expect(body.map((skill) => skill.name)).toEqual(["zip-import"])
    expect(body[0]?.location).toContain(path.join("skills", "zip-root", "SKILL.md"))
    expect(await Bun.file(path.join(tmp.path, "tmp", "skill-import")).exists()).toBe(false)
    await disposeTestInstance(tmp.path)
  })

  test("POST /skills/import rejects directory imports that exceed bounded file, size, or depth limits", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    const sources = path.join(tmp.path, "external")
    const tooMany = path.join(sources, "too-many")
    await writeSkill(tooMany, "too-many", "Too many files.")
    await Promise.all(
      Array.from({ length: 128 }, (_, index) => Bun.write(path.join(tooMany, `reference-${index}.md`), "x")),
    )
    const tooLarge = path.join(sources, "too-large")
    await writeSkill(tooLarge, "too-large", "Large file.")
    await Bun.write(path.join(tooLarge, "reference.bin"), Buffer.alloc(1024 * 1024 + 1))
    const tooDeep = path.join(sources, "too-deep")
    await writeSkill(tooDeep, "too-deep", "Deep path.")
    const deepFile = path.join(tooDeep, ...Array.from({ length: 13 }, (_, index) => `nested-${index}`), "reference.md")
    await fs.mkdir(path.dirname(deepFile), { recursive: true })
    await Bun.write(deepFile, "x")

    for (const source of [tooMany, tooLarge, tooDeep]) {
      const response = await withManagedPaths(tmp.path, () =>
        Server.Default().app.request("/skills/import", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lfcode-directory": tmp.path,
          },
          body: JSON.stringify({ kind: "folder", source }),
        }),
      )
      expect(response.status).toBe(400)
    }

    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "too-many", "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "too-large", "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "too-deep", "SKILL.md")).exists()).toBe(false)
    await disposeTestInstance(tmp.path)
  }, 20_000)

  test("POST /skills/import rejects unsafe and over-budget zip entries before extraction", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    const sources = [
      {
        name: "unsafe-path.zip",
        files: { "../outside/SKILL.md": "---\nname: outside\ndescription: Unsafe path.\n---\n" },
      },
      {
        name: "too-many.zip",
        files: Object.fromEntries(
          Array.from({ length: 129 }, (_, index) => [
            `too-many/${index === 0 ? "SKILL.md" : `reference-${index}.md`}`,
            index === 0 ? "---\nname: too-many\ndescription: Too many zip entries.\n---\n" : "x",
          ]),
        ),
      },
      {
        name: "too-large.zip",
        files: {
          "too-large/SKILL.md": "---\nname: too-large\ndescription: Large zip entry.\n---\n",
          "too-large/reference.bin": Buffer.alloc(1024 * 1024 + 1),
        },
      },
      {
        name: "case-collision.zip",
        files: {
          "case-collision/SKILL.md": "---\nname: case-collision\ndescription: First entry.\n---\n",
          "Case-Collision/SKILL.md": "---\nname: case-collision\ndescription: Second entry.\n---\n",
        },
      },
    ]
    for (const source of sources) {
      const zipPath = path.join(tmp.path, source.name)
      await Bun.write(zipPath, createStoredZip(source.files))
      const response = await withManagedPaths(tmp.path, () =>
        Server.Default().app.request("/skills/import", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lfcode-directory": tmp.path,
          },
          body: JSON.stringify({ kind: "zip", source: zipPath }),
        }),
      )
      expect(response.status).toBe(400)
    }

    expect(await Bun.file(path.join(tmp.path, "outside", "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "too-many", "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "too-large", "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "tmp", "skill-import")).exists()).toBe(false)
    await disposeTestInstance(tmp.path)
  }, 20_000)

  test("POST /skills/import returns a clear error for missing preset skill roots", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    await withManagedPaths(tmp.path, async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalHome = process.env.HOME
          const originalUserProfile = process.env.USERPROFILE
          process.env.HOME = path.join(tmp.path, "home")
          process.env.USERPROFILE = path.join(tmp.path, "home")
          try {
            const response = await Server.Default().app.request("/skills/import", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-lfcode-directory": tmp.path,
              },
              body: JSON.stringify({ kind: "codex" }),
            })

            expect(response.status).toBe(404)
            const text = await response.text()
            expect(text).toContain("Preset skill root not found")
            expect(text).toContain(".codex")
          } finally {
            if (originalHome === undefined) delete process.env.HOME
            else process.env.HOME = originalHome
            if (originalUserProfile === undefined) delete process.env.USERPROFILE
            else process.env.USERPROFILE = originalUserProfile
            await disposeTestInstance(tmp.path)
          }
        },
      })
    })
  })

  test("POST /skills/import from Codex stores every imported skill under the canonical root", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    const home = path.join(tmp.path, "home")
    await fs.mkdir(path.join(home, ".codex", "skills"), { recursive: true })
    await writeSkill(path.join(home, ".codex", "skills", "playwright"), "playwright", "Playwright automation.")
    await writeSkill(path.join(home, ".codex", "skills", "inspect-readonly"), "inspect-readonly", "Readonly inspection.")
    await writeSkill(path.join(home, ".codex", "skills", "chatgpt-apps"), "chatgpt-apps", "ChatGPT app workflow.")
    await writeSkill(path.join(home, ".codex", "skills", "cloudflare__web-perf"), "cloudflare__web-perf", "Cloudflare web perf.")

    await withManagedPaths(tmp.path, async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalHome = process.env.HOME
          const originalUserProfile = process.env.USERPROFILE
          process.env.HOME = home
          process.env.USERPROFILE = home
          try {
            const response = await Server.Default().app.request("/skills/import", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-lfcode-directory": tmp.path,
              },
              body: JSON.stringify({ kind: "codex" }),
            })

            await expectOk(response)
            const body = (await response.json()) as Array<{ name: string }>
            expect(body.map((skill) => skill.name).toSorted()).toEqual([
              "chatgpt-apps",
              "cloudflare__web-perf",
              "inspect-readonly",
              "playwright",
            ])
            expect(await Bun.file(path.join(home, ".lfcode", "skills", "chatgpt-apps", "SKILL.md")).exists()).toBe(true)
          } finally {
            if (originalHome === undefined) delete process.env.HOME
            else process.env.HOME = originalHome
            if (originalUserProfile === undefined) delete process.env.USERPROFILE
            else process.env.USERPROFILE = originalUserProfile
            await disposeTestInstance(tmp.path)
          }
        },
      })
    })
  })

  test("POST /skills/import overwrites duplicate target directories and refreshes", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    await withManagedPaths(tmp.path, async () => {
      await writeSkill(path.join(tmp.path, "global-home", ".lfcode", "skills", "dup"), "old-dup", "Old duplicate.")
      await writeSkill(path.join(tmp.path, "external", "dup"), "new-dup", "New duplicate.")
    })

    const response = await withManagedPaths(tmp.path, () =>
      Server.Default().app.request("/skills/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ kind: "folder", source: path.join(tmp.path, "external", "dup") }),
      }),
    )

    await expectOk(response)
    const body = (await response.json()) as Array<{ name: string; description: string }>
    expect(body).toEqual([
      expect.objectContaining({
        name: "new-dup",
        description: "New duplicate.",
      }),
    ])
    await disposeTestInstance(tmp.path)
  })

  test("POST /skills/import keeps an existing skill when the replacement frontmatter is invalid", async () => {
    await using tmp = await tmpdir(tmpdirWithGit)
    await withManagedPaths(tmp.path, async () => {
      await writeSkill(path.join(tmp.path, "global-home", ".lfcode", "skills", "dup"), "old-dup", "Old duplicate.")
      await Bun.write(
        path.join(tmp.path, "external", "dup", "SKILL.md"),
        `---\nname: invalid skill\ndescription: ${"A".repeat(1_025)}\n---\n\n# Invalid\n`,
      )
    })

    const response = await withManagedPaths(tmp.path, () =>
      Server.Default().app.request("/skills/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lfcode-directory": tmp.path,
        },
        body: JSON.stringify({ kind: "folder", source: path.join(tmp.path, "external", "dup") }),
      }),
    )

    expect(response.status).toBe(400)
    const existing = await Bun.file(path.join(tmp.path, "global-home", ".lfcode", "skills", "dup", "SKILL.md")).text()
    expect(existing).toContain("name: old-dup")
    expect(existing).toContain("Old duplicate.")
    await disposeTestInstance(tmp.path)
  })

  test("DELETE /skills/manage/delete removes only managed skill directories", async () => {
    const root = await fs.mkdtemp(path.join(process.env["LFCODE_TEST_TMPDIR_ROOT"] ?? os.tmpdir(), "lfcode-test-delete-"))
    try {
      await Bun.$`git init`.cwd(root).quiet()
      await Bun.$`git config core.fsmonitor false`.cwd(root).quiet()
      await Bun.$`git config commit.gpgsign false`.cwd(root).quiet()
      await Bun.$`git config user.email "test@lfcode.test"`.cwd(root).quiet()
      await Bun.$`git config user.name "Test"`.cwd(root).quiet()
      await Bun.$`git commit --allow-empty -m "root commit ${root}"`.cwd(root).quiet()

      await withManagedPaths(root, async () => {
        await writeSkill(path.join(root, "global-home", ".lfcode", "skills", "managed"), "managed-skill", "Managed skill.")
      })

      const response = await withManagedPaths(root, () =>
        Server.Default().app.request("/skills/manage/delete", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-lfcode-directory": root,
          },
          body: JSON.stringify({ directory: "managed" }),
        }),
      )

      await expectOk(response)
      expect(await Bun.file(path.join(root, "global-home", ".lfcode", "skills", "managed")).exists()).toBe(false)

      const bad = await withManagedPaths(root, () =>
        Server.Default().app.request("/skills/manage/delete", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-lfcode-directory": root,
          },
          body: JSON.stringify({ directory: ".." }),
        }),
      )

      expect(bad.status).toBe(404)
      await disposeTestInstance(root)
    } finally {
      await cleanupTmpdir(root, retryRemove).catch(() => undefined)
    }
  })
})

async function withManagedPaths<T>(root: string, fn: () => T | Promise<T>) {
  const original = {
    config: Global.Path.config,
    state: Global.Path.state,
    home: process.env.HOME,
    userprofile: process.env.USERPROFILE,
  }
  Object.assign(Global.Path, { config: root, state: root })
  process.env.HOME = path.join(root, "global-home")
  process.env.USERPROFILE = path.join(root, "global-home")
  try {
    return await fn()
  } finally {
    Object.assign(Global.Path, { config: original.config, state: original.state })
    if (original.home === undefined) delete process.env.HOME
    else process.env.HOME = original.home
    if (original.userprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = original.userprofile
  }
}

async function writeSkill(dir: string, name: string, description: string) {
  await Bun.write(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
}

async function expectOk(response: Response) {
  if (response.status === 200) return
  throw new Error(await response.text())
}

async function disposeTestInstance(directory: string) {
  await Instance.provide({
    directory,
    fn: () => Instance.dispose(),
  }).catch(() => undefined)
  Bun.gc(true)
  await sleep(1200)
}

async function retryRemove(target: string) {
  await sleep(1500)
  await fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 80,
    retryDelay: 150,
  })
}

function createStoredZip(files: Record<string, string | Buffer>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name.replaceAll("\\", "/"))
    const data = typeof content === "string" ? Buffer.from(content) : Buffer.from(content)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(input: Buffer) {
  let crc = 0xffffffff
  for (const value of input) {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
