import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import matter from "gray-matter"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import z from "zod"
import { ConfigMarkdown } from "@/config"
import { AppFileSystem } from "@/filesystem"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Skill } from "@/skill"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { runRequest } from "./trace"
import { Archive } from "@/util"
import { NotFoundError } from "@/storage"

const skillName = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
  hidden: z.boolean().optional(),
})

const LocalSkillInfo = SkillInfo.extend({
  directory: z.string(),
})

const LocalSkillManageInput = z.object({
  directory: z.string().min(1),
  hidden: z.boolean().nullable().optional(),
})

const LocalSkillDeleteInput = z.object({
  directory: z.string().min(1),
})

const ImportInput = z.object({
  kind: z.enum(["folder", "zip", "claude", "codex", "agents"]).optional(),
  source: z.string().min(1).optional(),
  name: skillName.optional(),
})

const CODEX_IMPORT_ALLOWLIST = new Set([
  "archive-extract",
  "effect",
  "define-goal",
  "doc",
  "formula-pdf-ocr",
  "humanizer",
  "inspect-readonly",
  "pdf",
  "playwright",
  "playwright-interactive",
  "screenshot",
  "system__skill-creator",
  "system__skill-installer",
  "transcribe",
  "update",
])

const CreateInput = z.object({
  name: skillName,
  description: z.string().min(1),
})

const DiscoverySource = z.literal("skills.sh")
const DiscoveryQuery = z.object({
  source: DiscoverySource.optional(),
  q: z.string().optional(),
  repo: z.string().optional(),
  status: z.enum(["all", "installed", "available"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(48).optional(),
})

const DiscoveryInstallInput = z.object({
  url: z.string().url(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  skill: skillName,
  name: skillName.optional(),
})

const DiscoveryItem = z.object({
  source: DiscoverySource,
  owner: z.string(),
  repo: z.string(),
  repository: z.string(),
  skill: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  install: z.string(),
  installed: z.boolean(),
})

const DiscoveryRepository = z.object({
  id: z.string(),
  owner: z.string(),
  repo: z.string(),
  label: z.string(),
  count: z.number(),
})

const DiscoveryResponse = z.object({
  items: DiscoveryItem.array(),
  repositories: DiscoveryRepository.array(),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

type DiscoveryIndex = {
  skills: DiscoveryIndexSkill[]
  repositories: DiscoveryIndexRepo[]
}

type DiscoveryIndexSkill = {
  source: "skills.sh"
  owner: string
  repo: string
  repository: string
  skill: string
  url: string
}

type DiscoveryIndexRepo = {
  id: string
  owner: string
  repo: string
  label: string
  count: number
}

type DiscoverySkillDetail = {
  name: string
  description: string
  install: string
}

const discoveryIndexTTL = 24 * 60 * 60 * 1000
let discoveryIndexCache: Promise<DiscoveryIndex> | undefined

export const SkillsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List skills",
        description: "List available skills, including the managed global skills directory.",
        operationId: "skills.list",
        responses: {
          200: {
            description: "Skills",
            content: {
              "application/json": {
                schema: resolver(SkillInfo.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.list",
            c,
            Effect.gen(function* () {
              const skill = yield* Skill.Service
              return yield* skill.all()
            }),
          ),
        ),
    )
    .get(
      "/manage/list",
      describeRoute({
        summary: "List managed skills",
        description: "List skills directly from the managed global skills directory.",
        operationId: "skills.manage.list",
        responses: {
          200: {
            description: "Local skills",
            content: {
              "application/json": {
                schema: resolver(LocalSkillInfo.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.manage.list",
            c,
            Effect.gen(function* () {
              const fs = yield* AppFileSystem.Service
              return yield* loadLocalSkills(fs, localSkillRoot())
            }),
          ),
        ),
    )
    .patch(
      "/manage/update",
      describeRoute({
        summary: "Update a managed skill",
        description: "Update the hidden frontmatter of a skill in the managed global skills directory.",
        operationId: "skills.manage.update",
        responses: {
          200: {
            description: "Updated local skill",
            content: {
              "application/json": {
                schema: resolver(LocalSkillInfo),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", LocalSkillManageInput),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.manage.update",
            c,
            Effect.gen(function* () {
              const input = c.req.valid("json")
              const fs = yield* AppFileSystem.Service
              const { file } = resolveLocalSkillTarget(input.directory)
              if (!(yield* fs.existsSafe(file))) throw new NotFoundError({ message: `Skill not found: ${input.directory}` })

              const parsed = yield* Effect.promise(() => ConfigMarkdown.parse(file))
              const next = {
                ...parsed.data,
              } as Record<string, unknown>
              if (input.hidden === true) {
                next.hidden = true
              } else {
                delete next.hidden
              }

              yield* fs.writeWithDirs(file, matter.stringify(parsed.content, next))
              const skill = yield* Skill.Service
              yield* skill.refresh()
              return yield* loadLocalSkillInfo({ directory: input.directory, file }, parsed.content, next)
            }),
          ),
        ),
    )
    .delete(
      "/manage/delete",
      describeRoute({
        summary: "Delete a managed skill",
        description: "Permanently delete a skill directory from the managed global skills directory.",
        operationId: "skills.manage.delete",
        responses: {
          200: {
            description: "Deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", LocalSkillDeleteInput),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.manage.delete",
            c,
            Effect.gen(function* () {
              const input = c.req.valid("json")
              const fs = yield* AppFileSystem.Service
              const { root, target } = resolveLocalSkillTarget(input.directory)
              if (!(yield* fs.existsSafe(target))) return true
              if (target === root) throw new NotFoundError({ message: "Invalid skill directory" })

              yield* fs.remove(target, { recursive: true }).pipe(Effect.catch(() => Effect.void))
              const skill = yield* Skill.Service
              yield* skill.refresh()
              return true
            }),
          ),
        ),
    )
    .get(
      "/discover",
      describeRoute({
        summary: "Discover skills",
        description: "Discover skills from the public skills.sh directory.",
        operationId: "skills.discover",
        responses: {
          200: {
            description: "Discovered skills",
            content: {
              "application/json": {
                schema: resolver(DiscoveryResponse),
              },
            },
          },
        },
      }),
      validator("query", DiscoveryQuery),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.discover",
            c,
            Effect.gen(function* () {
              const query = c.req.valid("query")
              const index = yield* loadDiscoveryIndex()
              const skill = yield* Skill.Service
              const localNames = new Set((yield* skill.all()).map((item) => item.name))
              const search = query.q?.trim().toLowerCase() ?? ""
              const repo = query.repo?.trim().toLowerCase() ?? ""
              const status = query.status ?? "all"
              const page = query.page ?? 1
              const pageSize = query.pageSize ?? 24

              const candidates = index.skills.filter((item) => {
                if (query.source && query.source !== "skills.sh") return false
                if (repo && item.repository.toLowerCase() !== repo && !item.repository.toLowerCase().includes(repo)) return false
                if (search && !matchesDiscoveryQuery(item, search)) return false
                if (status === "installed" && !localNames.has(item.skill)) return false
                if (status === "available" && localNames.has(item.skill)) return false
                return true
              })

              const items = yield* Effect.forEach(
                candidates.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
                (item) => loadDiscoverySkill({ item, localNames }),
                { concurrency: 4 },
              )

              return {
                items,
                repositories: index.repositories,
                total: candidates.length,
                page,
                pageSize,
              }
            }),
          ),
        ),
    )
    .post(
      "/discover/install",
      describeRoute({
        summary: "Install a discovered skill",
        description: "Install a skill from a skills.sh repository into the managed global skills directory.",
        operationId: "skills.discover.install",
        responses: {
          200: {
            description: "Installed skill",
            content: {
              "application/json": {
                schema: resolver(SkillInfo),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", DiscoveryInstallInput),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.discover.install",
            c,
            Effect.gen(function* () {
              const input = c.req.valid("json")
              return yield* installDiscoverySkill(input)
            }),
          ),
        ),
    )
    .get(
      "/dirs",
      describeRoute({
        summary: "List skill directories",
        description: "List the directories currently contributing skills.",
        operationId: "skills.dirs",
        responses: {
          200: {
            description: "Skill directories",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.dirs",
            c,
            Effect.gen(function* () {
              const skill = yield* Skill.Service
              return yield* skill.dirs()
            }),
          ),
        ),
    )
    .post(
      "/refresh",
      describeRoute({
        summary: "Refresh skills",
        description: "Re-scan the local skill directories.",
        operationId: "skills.refresh",
        responses: {
          200: {
            description: "Refreshed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.refresh",
            c,
            Effect.gen(function* () {
              const skill = yield* Skill.Service
              yield* skill.refresh()
              return true
            }),
          ),
        ),
    )
    .post(
      "/import",
      describeRoute({
        summary: "Import a skill directory",
        description: "Copy skills into the managed global skills directory from a folder, zip file, or known external skill root.",
        operationId: "skills.import",
        responses: {
          200: {
            description: "Imported skills",
            content: {
              "application/json": {
                schema: resolver(SkillInfo.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ImportInput),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.import",
            c,
            Effect.gen(function* () {
                const input = c.req.valid("json")
                const fs = yield* AppFileSystem.Service
                const source = yield* resolveImportSource(fs, input)
                const targets = yield* importSkillCandidates(fs, source.path, {
                  fallbackName: source.fallbackName,
                  name: input.name,
                  allowedNames: source.allowedNames,
                }).pipe(
                  Effect.ensuring(source.cleanup),
                )
              const skill = yield* Skill.Service
              yield* skill.refresh()
              return yield* importedItems(skill, targets)
            }),
          ),
        ),
    )
    .post(
      "/create",
      describeRoute({
        summary: "Create a new skill",
        description: "Create a new skill skeleton under the managed global skills directory.",
        operationId: "skills.create",
        responses: {
          200: {
            description: "Created skill",
            content: {
              "application/json": {
                schema: resolver(SkillInfo),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CreateInput),
      async (c) =>
        c.json(
          await runRequest(
            "SkillsRoutes.create",
            c,
            Effect.gen(function* () {
              const { name, description } = c.req.valid("json")
              const fs = yield* AppFileSystem.Service
              const target = path.join(localSkillRoot(), name)
              if (yield* fs.existsSafe(target)) {
                throw new Error(`Skill already exists: ${name}`)
              }

              yield* fs.writeWithDirs(
                path.join(target, "SKILL.md"),
                `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
              )

              const skill = yield* Skill.Service
              yield* skill.refresh()
              const item = yield* skill.get(name)
              if (!item) throw new Error(`Created skill not found after refresh: ${name}`)
              return item
            }),
          ),
        ),
    ),
)

function normalize(value?: string) {
  return value?.trim().toLowerCase() ?? ""
}

function matchesDiscoveryQuery(item: DiscoveryIndexSkill, query: string) {
  return [item.owner, item.repo, item.repository, item.skill].some((part) => part.toLowerCase().includes(query))
}

function extractLocs(xml: string) {
  const locs: string[] = []
  const pattern = /<loc>(.*?)<\/loc>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) {
    locs.push(match[1]!)
  }
  return locs
}

function parseDiscoverySkillUrl(url: string) {
  try {
    const pathname = new URL(url).pathname.replace(/^\/+|\/+$/g, "")
    const parts = pathname.split("/")
    if (parts.length !== 3) return undefined
    const [owner, repo, skill] = parts
    if (!owner || !repo || !skill) return undefined
    return {
      source: "skills.sh" as const,
      owner,
      repo,
      repository: `${owner}/${repo}`,
      skill,
      url,
    }
  } catch {
    return undefined
  }
}

function parseSoftwareApplicationMetadata(html: string) {
  const scripts = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? []
  for (const script of scripts) {
    const json = script.replace(/^<script type="application\/ld\+json">/, "").replace(/<\/script>$/, "")
    try {
      const data = JSON.parse(json) as { ["@type"]?: string; name?: string; description?: string }
      if (data["@type"] !== "SoftwareApplication") continue
      return {
        name: typeof data.name === "string" ? data.name : undefined,
        description: typeof data.description === "string" ? data.description : undefined,
      }
    } catch {}
  }
  return {}
}

function parseInstallCommand(html: string, item: DiscoveryIndexSkill) {
  const match = html.match(/npx skills add ([^<]+?) --skill ([^<]+?)<\/code>/i)
  if (match?.[1] && match[2]) {
    return `npx skills add ${match[1].trim()} --skill ${match[2].trim()}`
  }
  return `npx skills add https://github.com/${item.owner}/${item.repo} --skill ${item.skill}`
}

function parseDiscoveryMetadata(html: string, item: DiscoveryIndexSkill): DiscoverySkillDetail {
  const metadata = parseSoftwareApplicationMetadata(html)
  return {
    name: metadata.name ?? item.skill,
    description: metadata.description ?? "",
    install: parseInstallCommand(html, item),
  }
}

const loadDiscoveryIndex = Effect.fn("SkillsRoutes.loadDiscoveryIndex")(function* () {
    const fs = yield* AppFileSystem.Service
    const cacheDir = path.join(Global.Path.cache, "skills-discovery")
    const cacheFile = path.join(cacheDir, "index.json")
    const cached = yield* readDiscoveryIndexCache(fs, cacheFile)
    if (cached) return cached

    if (!discoveryIndexCache) {
      discoveryIndexCache = Effect.runPromise(buildDiscoveryIndex(fs, cacheFile)).finally(() => {
        discoveryIndexCache = undefined
      })
    }

    return yield* Effect.promise(() => discoveryIndexCache!)
})

function readDiscoveryIndexCache(fs: AppFileSystem.Interface, cacheFile: string) {
  return Effect.gen(function* () {
    if (!(yield* fs.existsSafe(cacheFile))) return undefined
    const data = yield* fs.readFile(cacheFile)
    const parsed = JSON.parse(new TextDecoder().decode(data)) as { fetchedAt?: number; index?: DiscoveryIndex }
    if (!parsed.index || typeof parsed.fetchedAt !== "number") return undefined
    if (Date.now() - parsed.fetchedAt > discoveryIndexTTL) return undefined
    return parsed.index
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function buildDiscoveryIndex(fs: AppFileSystem.Interface, cacheFile: string) {
  return Effect.gen(function* () {
    const [skills1, skills2] = yield* Effect.all(
      [
        Effect.promise(() => fetch("https://www.skills.sh/sitemap-skills-1.xml").then((res) => res.text())),
        Effect.promise(() => fetch("https://www.skills.sh/sitemap-skills-2.xml").then((res) => res.text())),
      ],
      { concurrency: 2 },
    )

    const skills = [...extractLocs(skills1), ...extractLocs(skills2)]
      .map(parseDiscoverySkillUrl)
      .filter((item): item is DiscoveryIndexSkill => item !== undefined)

    const repositories = Array.from(
      skills.reduce((acc, item) => {
        const next = acc.get(item.repository) ?? {
          id: item.repository,
          owner: item.owner,
          repo: item.repo,
          label: item.repository,
          count: 0,
        }
        next.count += 1
        acc.set(item.repository, next)
        return acc
      }, new Map<string, DiscoveryIndexRepo>()),
      ([, repo]) => repo,
    )

    const index = { skills, repositories }
    yield* fs.writeWithDirs(cacheFile, JSON.stringify({ fetchedAt: Date.now(), index }, null, 2))
    return index
  })
}

function loadDiscoverySkill(input: { item: DiscoveryIndexSkill; localNames: Set<string> }) {
  return Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const cacheDir = path.join(Global.Path.cache, "skills-discovery", "details", input.item.owner, input.item.repo)
    const cacheFile = path.join(cacheDir, `${input.item.skill}.json`)
    if (yield* fs.existsSafe(cacheFile)) {
      const data = yield* fs.readFile(cacheFile)
      const cached = JSON.parse(new TextDecoder().decode(data)) as DiscoverySkillDetail
      return {
        ...input.item,
        ...cached,
        installed: input.localNames.has(input.item.skill),
      }
    }

    const html = yield* Effect.promise(() =>
      fetch(input.item.url).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${input.item.url}: ${res.status}`)
        return await res.text()
      }),
    )
    const detail = parseDiscoveryMetadata(html, input.item)
    yield* fs.writeWithDirs(cacheFile, JSON.stringify(detail, null, 2))
    return {
      ...input.item,
      ...detail,
      installed: input.localNames.has(input.item.skill),
    }
  })
}

function installDiscoverySkill(input: {
  url: string
  owner: string
  repo: string
  skill: string
  name?: string
}) {
  return Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const html = yield* Effect.promise(() =>
      fetch(input.url).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${input.url}: ${res.status}`)
        return await res.text()
      }),
    )
    const detail = parseDiscoveryMetadata(html, {
      source: "skills.sh",
      owner: input.owner,
      repo: input.repo,
      repository: `${input.owner}/${input.repo}`,
      skill: input.skill,
      url: input.url,
    })

    const targetName = input.name ?? detail.name
    const target = path.join(localSkillRoot(), targetName)
    if (yield* fs.existsSafe(target)) {
      yield* fs.remove(target, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    }

    const githubUrl = detail.install.match(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\s+--skill\s+([^\s]+)/i)
    if (!githubUrl?.[1] || !githubUrl[2] || !githubUrl[3]) {
      throw new Error(`Could not parse install command for ${input.url}`)
    }

    const owner = githubUrl[1]
    const repo = githubUrl[2]
    const skill = githubUrl[3]
    const tree = yield* fetchGithubTree(owner, repo)
    const root = findSkillRoot(tree.tree, skill)
    if (!root) throw new Error(`Could not find SKILL.md for ${owner}/${repo}#${skill}`)

    yield* fs.ensureDir(target)
    const files = tree.tree.filter(
      (entry) => entry.type === "blob" && (entry.path === root || entry.path.startsWith(`${root}/`)),
    )
    yield* Effect.forEach(
      files,
      (entry) =>
        Effect.gen(function* () {
          const relative = entry.path === root ? "SKILL.md" : entry.path.slice(root.length + 1)
          const source = `https://raw.githubusercontent.com/${owner}/${repo}/${tree.defaultBranch}/${entry.path}`
          const bytes = yield* Effect.promise(() =>
            fetch(source).then(async (res) => {
              if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.status}`)
              return await res.arrayBuffer()
            }),
          )
          yield* fs.writeWithDirs(path.join(target, relative), new Uint8Array(bytes))
        }),
      { concurrency: 8 },
    )

    const skillService = yield* Skill.Service
    yield* skillService.refresh()
    const item = yield* skillService.get(targetName)
    if (!item) throw new Error(`Installed skill not found after refresh: ${targetName}`)
    return item
  })
}

type GithubTree = {
  defaultBranch: string
  tree: Array<{ path: string; type: "blob" | "tree" }>
}

function fetchGithubTree(owner: string, repo: string) {
  return Effect.promise(async () => {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
    if (!repoRes.ok) throw new Error(`Failed to load repository ${owner}/${repo}: ${repoRes.status}`)
    const repoJson = (await repoRes.json()) as { default_branch?: string }
    const defaultBranch = repoJson.default_branch ?? "main"
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`)
    if (!treeRes.ok) throw new Error(`Failed to load repository tree ${owner}/${repo}: ${treeRes.status}`)
    const treeJson = (await treeRes.json()) as { tree?: Array<{ path?: string; type?: string }> }
    return {
      defaultBranch,
      tree: (treeJson.tree ?? [])
        .filter((entry): entry is { path: string; type: "blob" | "tree" } => {
          return typeof entry.path === "string" && (entry.type === "blob" || entry.type === "tree")
        })
        .map((entry) => ({
          path: entry.path,
          type: entry.type,
        })),
    } satisfies GithubTree
  })
}

function findSkillRoot(tree: GithubTree["tree"], skill: string) {
  const exact = tree.find((entry) => entry.type === "blob" && new RegExp(`(^|/)${escapeRegExp(skill)}/SKILL\\.md$`, "i").test(entry.path))
  if (exact) return exact.path.slice(0, -"/SKILL.md".length)
  const root = tree.find((entry) => entry.type === "blob" && entry.path === "SKILL.md")
  if (root) return ""
  const fallback = tree.find((entry) => entry.type === "blob" && entry.path.toLowerCase().endsWith("/skill.md"))
  if (fallback) return fallback.path.slice(0, -"/SKILL.md".length)
  return undefined
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

type ImportInputValue = z.infer<typeof ImportInput>

type ImportCandidate = {
  source: string
  targetName: string
}

type ImportSource = {
  path: string
  cleanup: Effect.Effect<void, never, AppFileSystem.Service>
  fallbackName?: string
  allowedNames?: ReadonlySet<string>
}

function resolveImportSource(
  fs: AppFileSystem.Interface,
  input: ImportInputValue,
): Effect.Effect<ImportSource, unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const kind = input.kind ?? "folder"
    if (kind === "claude") {
      const target = path.join(Global.Path.home, ".claude", "skills")
      if (!(yield* fs.existsSafe(target))) throw new NotFoundError({ message: `Preset skill root not found: ${target}` })
      return {
        path: target,
        cleanup: Effect.void,
        fallbackName: undefined,
      }
    }
      if (kind === "codex") {
        const target = path.join(Global.Path.home, ".codex", "skills")
        if (!(yield* fs.existsSafe(target))) throw new NotFoundError({ message: `Preset skill root not found: ${target}` })
        return {
          path: target,
          cleanup: Effect.void,
          fallbackName: undefined,
          allowedNames: CODEX_IMPORT_ALLOWLIST,
        }
      }
    if (kind === "agents") {
      const target = path.join(Global.Path.home, ".agents", "skills")
      if (!(yield* fs.existsSafe(target))) throw new NotFoundError({ message: `Preset skill root not found: ${target}` })
      return {
        path: target,
        cleanup: Effect.void,
        fallbackName: undefined,
      }
    }

    if (!input.source) throw new Error(`Import source is required for ${kind}`)
    const source = AppFileSystem.resolve(input.source)
    if (kind === "folder") {
      return {
        path: source,
        cleanup: Effect.void,
        fallbackName: undefined,
      }
    }

    if (!(yield* isFilePath(source))) throw new Error(`Source zip file not found: ${input.source}`)
    const temp = path.join(Global.Path.state, "tmp", "skill-import", `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    yield* fs.ensureDir(temp)
    yield* Effect.promise(() => Archive.extractZip(source, temp))
    return {
      path: temp,
      cleanup: fs.remove(temp, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void)),
      fallbackName: path.basename(source, path.extname(source)),
    }
  })
}

function importSkillCandidates(
  fs: AppFileSystem.Interface,
  source: string,
  options?: { fallbackName?: string; name?: string; allowedNames?: ReadonlySet<string> },
): Effect.Effect<Array<{ target: string; targetName: string }>, unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const resolvedSource = AppFileSystem.resolve(source)
    if (!(yield* isDirectoryPath(resolvedSource))) throw new Error(`Source skill directory not found: ${source}`)

    const candidates = yield* discoverImportCandidates(fs, resolvedSource, options)
    if (options?.name && candidates.length > 1) throw new Error("Cannot override the skill name when importing multiple skills")

    return yield* Effect.forEach(candidates, (candidate) => importSkillCandidate(fs, candidate), {
      concurrency: 4,
    })
  })
}

function discoverImportCandidates(
  fs: AppFileSystem.Interface,
  source: string,
  options?: { fallbackName?: string; name?: string; allowedNames?: ReadonlySet<string> },
): Effect.Effect<ImportCandidate[], unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const direct = path.join(source, "SKILL.md")
    if (yield* fs.isFile(direct)) {
      if (options?.allowedNames && !options.allowedNames.has(path.basename(source))) return []
      return [{ source, targetName: options?.name ?? options?.fallbackName ?? path.basename(source) }]
    }

    const entries = yield* fs.readDirectoryEntries(source)
    const candidates = yield* Effect.forEach(
      entries.filter(
        (entry) =>
          entry.type === "directory" &&
          entry.name !== ".git" &&
          entry.name !== "node_modules" &&
          (!options?.allowedNames || options.allowedNames.has(entry.name)),
      ),
      (entry) =>
        Effect.gen(function* () {
          const candidate = path.join(source, entry.name)
          if (!(yield* fs.isFile(path.join(candidate, "SKILL.md")))) return undefined
          return { source: candidate, targetName: entry.name }
        }),
      { concurrency: 8 },
    )
    const found = candidates.filter((item): item is ImportCandidate => item !== undefined)
    if (found.length > 0) return found

    const childDirs = entries.filter((entry) => entry.type === "directory" && entry.name !== ".git" && entry.name !== "node_modules")
    if (childDirs.length === 1) return yield* discoverImportCandidates(fs, path.join(source, childDirs[0]!.name), options)

    throw new Error(`No skill directories found in source: ${source}`)
  })
}

function importSkillCandidate(
  fs: AppFileSystem.Interface,
  candidate: ImportCandidate,
): Effect.Effect<{ target: string; targetName: string }, unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const target = path.join(localSkillRoot(), candidate.targetName)
    if (AppFileSystem.resolve(candidate.source) === AppFileSystem.resolve(target)) {
      throw new Error("Source and destination are the same")
    }

    if (yield* fs.existsSafe(target)) {
      yield* fs.remove(target, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    }

    yield* Effect.promise(() => copyDirectory(fs, candidate.source, target))
    return { target, targetName: candidate.targetName }
  })
}

function importedItems(
  skill: Skill.Interface,
  targets: Array<{ target: string; targetName: string }>,
): Effect.Effect<z.infer<typeof SkillInfo>[], unknown, Skill.Service | AppFileSystem.Service> {
  return Effect.gen(function* () {
    const all = yield* skill.all()
    return yield* Effect.forEach(targets, ({ target, targetName }) =>
      Effect.gen(function* () {
        const direct = yield* skill.get(targetName)
        if (direct) return direct
        const item = all.find((entry) => AppFileSystem.contains(path.resolve(target), path.resolve(entry.location)))
        if (!item) throw new Error(`Imported skill not found after refresh: ${targetName}`)
        return item
      }),
    )
  })
}

function isDirectoryPath(target: string) {
  return Effect.promise(() =>
    fs
      .stat(target)
      .then((info) => info.isDirectory())
      .catch(() => false),
  )
}

function isFilePath(target: string) {
  return Effect.promise(() =>
    fs
      .stat(target)
      .then((info) => info.isFile())
      .catch(() => false),
  )
}

async function copyDirectory(fs: AppFileSystem.Interface, source: string, target: string) {
  await Effect.runPromise(fs.ensureDir(target))
  const entries = await Effect.runPromise(fs.readDirectoryEntries(source))
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.type === "directory") {
      await copyDirectory(fs, from, to)
      continue
    }
    if (entry.type === "symlink") continue
    const bytes = await Effect.runPromise(fs.readFile(from))
    await Effect.runPromise(fs.writeWithDirs(to, bytes))
  }
}

function localSkillRoot() {
  return path.join(Global.Path.config, "skills")
}

function resolveLocalSkillTarget(directory: string) {
  const root = AppFileSystem.resolve(localSkillRoot())
  const target = AppFileSystem.resolve(path.resolve(root, directory))
  if (target === root || !AppFileSystem.contains(root, target)) {
    throw new NotFoundError({ message: `Invalid skill directory: ${directory}` })
  }
  return {
    root,
    target,
    file: path.join(target, "SKILL.md"),
  }
}

function loadLocalSkills(
  fs: AppFileSystem.Interface,
  root: string,
): Effect.Effect<z.infer<typeof LocalSkillInfo>[], unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    if (!(yield* fs.existsSafe(root))) return [] as z.infer<typeof LocalSkillInfo>[]
    const files = yield* collectLocalSkillFiles(fs, root)
    const present: z.infer<typeof LocalSkillInfo>[] = []
    for (const file of files) {
      const directory = path.relative(root, path.dirname(file))
      if (directory === "") continue
      const item = yield* loadLocalSkillInfo({ directory, file })
      if (!item) continue
      present.push(item)
    }
    return present.toSorted((a, b) => a.directory.localeCompare(b.directory))
  })
}

function collectLocalSkillFiles(
  fs: AppFileSystem.Interface,
  root: string,
): Effect.Effect<string[], unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const files: string[] = []
    const pending = [root]

    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue

      const entries = yield* fs.readDirectoryEntries(current).pipe(Effect.catch(() => Effect.succeed([] as AppFileSystem.DirEntry[])))
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") continue
        const next = path.join(current, entry.name)
        if (entry.type === "directory") {
          pending.push(next)
          continue
        }
        if (entry.type !== "file" || entry.name !== "SKILL.md") continue
        files.push(next)
      }
    }

    return files
  })
}

function loadLocalSkillInfo(
  item: { directory: string; file: string },
  content?: string,
  frontmatter?: Record<string, unknown>,
): Effect.Effect<z.infer<typeof LocalSkillInfo> | undefined, unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const md =
      content !== undefined && frontmatter !== undefined
        ? { content, data: frontmatter }
        : yield* Effect.gen(function* () {
            const fs = yield* AppFileSystem.Service
            const source = yield* fs.readFileString(item.file)
            const parsed = matter(source)
            return {
              content: parsed.content,
              data: parsed.data as Record<string, unknown>,
            }
          })
    const parsed = Skill.Info.pick({ name: true, description: true, hidden: true }).safeParse(md.data)
    if (!parsed.success) return undefined
    return {
      directory: item.directory,
      name: parsed.data.name,
      description: parsed.data.description,
      location: item.file,
      content: md.content,
      ...(parsed.data.hidden === undefined ? {} : { hidden: parsed.data.hidden }),
    } satisfies z.infer<typeof LocalSkillInfo>
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}
