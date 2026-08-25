import path from "path"
import fs from "fs/promises"
import yauzl from "yauzl"
import { Effect } from "effect"
import matter from "gray-matter"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { ConfigMarkdown } from "@/config"
import { AppFileSystem } from "@/filesystem"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Skill } from "@/skill"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { runRequest } from "./trace"
import { NotFoundError } from "@/storage"
import { globalSkillRoot } from "@/skill/global-directory"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"

const skillName = Skill.Name
const SKILL_IMPORT_LIMITS = {
  maxFiles: 128,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxDepth: 12,
  maxArchiveBytes: 8 * 1024 * 1024,
  maxRemoteMetadataBytes: 8 * 1024 * 1024,
  maxRemoteTreeEntries: 20_000,
}

const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
  displayName: z.string().optional(),
  shortDescription: z.string().optional(),
})

const LocalSkillInfo = SkillInfo.extend({
  directory: z.string(),
})

const LocalSkillDeleteInput = z.object({
  directory: z.string().min(1),
})

const ImportInput = z.object({
  kind: z.enum(["folder", "zip", "claude", "codex", "agents"]).optional(),
  source: z.string().min(1).optional(),
  name: skillName.optional(),
})

const CreateInput = z.object({
  name: skillName,
  description: Skill.Description,
})

const OpenAISkillMetadata = z
  .object({
    interface: z
      .object({
        display_name: z.string().min(1).optional(),
        short_description: z.string().min(1).max(64).optional(),
        default_prompt: z.string().min(1).optional(),
      })
      .passthrough(),
    policy: z.object({ allow_implicit_invocation: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough()

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
              return yield* Effect.forEach(yield* skill.all(), loadSkillPresentation)
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
              const gate = decideCapabilityOperation({
                caller: "route:skills.manage.delete",
                capability: "skill_manage",
                risk: "destructive",
                source: "local",
                operation: "delete",
                previewed: true,
                reversible: false,
                target: input.directory,
                reason: "Explicit managed skill deletion",
              })
              requireCapabilityDecision(gate.decision)
              const fs = yield* AppFileSystem.Service
              const { root, target } = resolveLocalSkillTarget(input.directory)
              if (!(yield* fs.existsSafe(target))) {
                completeCapabilityOperation(gate.auditID, "already absent")
                return true
              }
              if (target === root) throw new NotFoundError({ message: "Invalid skill directory" })

              yield* fs.remove(target, { recursive: true }).pipe(Effect.catch(() => Effect.void))
              const skill = yield* Skill.Service
              yield* skill.refresh()
              completeCapabilityOperation(gate.auditID, "completed")
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
              const gate = decideCapabilityOperation({
                caller: "route:skills.discover.install",
                capability: "skill_manage",
                risk: "install",
                source: "public",
                operation: "install",
                previewed: true,
                reversible: true,
                target: input.url,
                reason: "Explicit installation of a discovered skill",
                metadata: { owner: input.owner, repo: input.repo, skill: input.skill },
              })
              requireCapabilityDecision(gate.decision)
              const result = yield* installDiscoverySkill(assertDiscoveryInstallInput(input))
              completeCapabilityOperation(gate.auditID, "completed", { action: "delete", skill: result.name })
              return result
            }).pipe(Effect.catch((error) => Effect.fail(skillImportError(error)))),
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
              const gate = decideCapabilityOperation({
                caller: "route:skills.import",
                capability: "skill_manage",
                risk: "install",
                source: input.kind === "codex" || input.kind === "agents" || input.kind === "claude" ? "local" : "public",
                operation: "install",
                previewed: true,
                reversible: true,
                target: input.source ?? input.kind ?? "managed-skill-source",
                reason: "Explicit managed skill import",
                metadata: { kind: input.kind ?? "folder", name: input.name },
              })
              requireCapabilityDecision(gate.decision)
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
              const result = yield* importedItems(skill, targets)
              completeCapabilityOperation(gate.auditID, `completed (${result.length} skills)`, {
                action: "delete",
                skills: result.map((item) => item.name),
              })
              return result
            }).pipe(Effect.catch((error) => Effect.fail(skillImportError(error)))),
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
              const gate = decideCapabilityOperation({
                caller: "route:skills.create",
                capability: "skill_manage",
                risk: "modify",
                source: "local",
                operation: "install",
                previewed: true,
                reversible: true,
                target: name,
                reason: "Explicit creation of a managed skill",
              })
              requireCapabilityDecision(gate.decision)
              const fs = yield* AppFileSystem.Service
              const target = path.join(localSkillRoot(), name)
              if (yield* fs.existsSafe(target)) {
                throw new Error(`Skill already exists: ${name}`)
              }

               yield* fs.writeWithDirs(
                 path.join(target, "SKILL.md"),
                 matter.stringify(`# ${name}\n`, { name, description }),
               )
               yield* fs.writeWithDirs(path.join(target, "agents", "openai.yaml"), openAIYaml({ name, description }))

              const skill = yield* Skill.Service
              yield* skill.refresh()
              const item = yield* skill.get(name)
              if (!item) throw new Error(`Created skill not found after refresh: ${name}`)
              completeCapabilityOperation(gate.auditID, "completed", { action: "delete", skill: name })
              return item
            }),
          ),
        ),
    ),
)

function normalize(value?: string) {
  return value?.trim().toLowerCase() ?? ""
}

function openAIYaml(input: z.infer<typeof CreateInput>) {
  const description = input.description.replace(/\s+/g, " ").trim()
  const metadata = {
    interface: {
      display_name: input.name.split(/[-_.]/).map(capitalize).join(" "),
      short_description: Array.from(description).slice(0, 64).join(""),
      default_prompt: `Use $${input.name} for: ${Array.from(description).slice(0, 160).join("")}`,
    },
    policy: { allow_implicit_invocation: true },
  }
  OpenAISkillMetadata.parse(metadata)
  return [
    "interface:",
    `  display_name: ${JSON.stringify(metadata.interface.display_name)}`,
    `  short_description: ${JSON.stringify(metadata.interface.short_description)}`,
    `  default_prompt: ${JSON.stringify(metadata.interface.default_prompt)}`,
    "policy:",
    "  allow_implicit_invocation: true",
    "",
  ].join("\n")
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
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

export function assertDiscoveryInstallInput(input: z.infer<typeof DiscoveryInstallInput>) {
  const url = new URL(input.url)
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (
    url.protocol !== "https:" ||
    !["skills.sh", "www.skills.sh"].includes(url.hostname) ||
    url.port ||
    url.search ||
    url.hash ||
    parts.length !== 3 ||
    parts[0] !== input.owner ||
    parts[1] !== input.repo ||
    parts[2] !== input.skill
  ) {
    throw new HTTPException(400, { message: "Discovery installs must use the exact HTTPS skills.sh entry URL" })
  }
  return input
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
        fetchBoundedText("https://www.skills.sh/sitemap-skills-1.xml", SKILL_IMPORT_LIMITS.maxRemoteMetadataBytes),
        fetchBoundedText("https://www.skills.sh/sitemap-skills-2.xml", SKILL_IMPORT_LIMITS.maxRemoteMetadataBytes),
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

    const html = yield* fetchBoundedText(input.item.url, SKILL_IMPORT_LIMITS.maxRemoteMetadataBytes)
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
    const html = yield* fetchBoundedText(input.url, SKILL_IMPORT_LIMITS.maxRemoteMetadataBytes)
    const detail = parseDiscoveryMetadata(html, {
      source: "skills.sh",
      owner: input.owner,
      repo: input.repo,
      repository: `${input.owner}/${input.repo}`,
      skill: input.skill,
      url: input.url,
    })

    const targetName = Skill.Name.parse(input.name ?? detail.name)
    const rootDirectory = localSkillRoot()
    const target = path.join(rootDirectory, targetName)

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

    const files = tree.tree.filter(
      (entry) => entry.type === "blob" && (entry.path === root || entry.path.startsWith(`${root}/`)),
    )
    if (files.length === 0) throw new Error(`No files found for ${owner}/${repo}#${skill}`)
    if (files.length > SKILL_IMPORT_LIMITS.maxFiles) {
      throw new Error(`Skill contains ${files.length} files, above the ${SKILL_IMPORT_LIMITS.maxFiles}-file import limit`)
    }

    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const staging = path.join(rootDirectory, `.${targetName}.${suffix}.tmp`)
    const backup = path.join(rootDirectory, `.${targetName}.${suffix}.backup`)
    yield* fs.ensureDir(rootDirectory)
    yield* Effect.gen(function* () {
      let totalBytes = 0
      yield* Effect.forEach(
        files,
        (entry) =>
          Effect.gen(function* () {
            const relative = entry.path === root ? "SKILL.md" : entry.path.slice(root.length + 1)
            const destination = skillImportTarget(staging, relative)
            const source = `https://raw.githubusercontent.com/${owner}/${repo}/${tree.defaultBranch}/${entry.path}`
            const bytes = yield* fetchBoundedBytes(source, SKILL_IMPORT_LIMITS.maxFileBytes)
            totalBytes += bytes.byteLength
            if (totalBytes > SKILL_IMPORT_LIMITS.maxTotalBytes) {
              throw new Error(`Remote Skill exceeds the ${SKILL_IMPORT_LIMITS.maxTotalBytes}-byte total import limit`)
            }
            yield* fs.writeWithDirs(destination, bytes)
          }),
        { concurrency: 1 },
      )
      const skillFile = path.join(staging, "SKILL.md")
      const downloaded = yield* fs.readFileString(skillFile)
      const parsed = yield* Effect.try({
        try: () => matter(downloaded),
        catch: () => invalidSkillFrontmatter("Downloaded SKILL.md has invalid YAML frontmatter"),
      })
      const frontmatter = Skill.Frontmatter.safeParse(parsed.data)
      if (!frontmatter.success) throw invalidSkillFrontmatter(frontmatter.error.message)
      if (frontmatter.data.name !== targetName) {
        throw new Error(`Downloaded Skill name ${frontmatter.data.name} does not match target ${targetName}`)
      }

      const replacing = yield* fs.existsSafe(target)
      if (replacing) yield* fs.rename(target, backup)
      yield* fs.rename(staging, target).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (replacing && (yield* fs.existsSafe(backup))) yield* fs.rename(backup, target).pipe(Effect.catch(() => Effect.void))
            return yield* Effect.fail(error)
          }),
        ),
      )
      if (replacing) yield* fs.remove(backup, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))
    }).pipe(Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))))

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
  return Effect.tryPromise({
    try: async () => {
      const repoJson = JSON.parse(
        await fetchBoundedTextValue(`https://api.github.com/repos/${owner}/${repo}`, SKILL_IMPORT_LIMITS.maxRemoteMetadataBytes),
      ) as { default_branch?: string }
      const defaultBranch = repoJson.default_branch ?? "main"
      const treeJson = JSON.parse(
        await fetchBoundedTextValue(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
          SKILL_IMPORT_LIMITS.maxRemoteMetadataBytes,
        ),
      ) as { tree?: Array<{ path?: string; type?: string }> }
      if ((treeJson.tree?.length ?? 0) > SKILL_IMPORT_LIMITS.maxRemoteTreeEntries) {
        throw new Error(`Repository tree contains more than ${SKILL_IMPORT_LIMITS.maxRemoteTreeEntries} entries`)
      }
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
    },
    catch: (error) => error,
  })
}

function fetchBoundedText(url: string, limit: number) {
  return Effect.tryPromise({ try: () => fetchBoundedTextValue(url, limit), catch: (error) => error })
}

async function fetchBoundedTextValue(url: string, limit: number) {
  const bytes = await fetchBoundedBytesValue(url, limit)
  return new TextDecoder().decode(bytes)
}

function fetchBoundedBytes(url: string, limit: number) {
  return Effect.tryPromise({ try: () => fetchBoundedBytesValue(url, limit), catch: (error) => error })
}

async function fetchBoundedBytesValue(url: string, limit: number) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > limit) throw new Error(`Remote response exceeds the ${limit}-byte limit: ${url}`)
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw new Error(`Remote response exceeds the ${limit}-byte limit: ${url}`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      total += chunk.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error(`Remote response exceeds the ${limit}-byte limit: ${url}`)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
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

function invalidSkillFrontmatter(message: string) {
  return new HTTPException(400, { message: `Invalid Skill frontmatter: ${message}` })
}

export function skillImportError(error: unknown) {
  if (error instanceof HTTPException || error instanceof NotFoundError) return error
  return new HTTPException(400, {
    message: error instanceof Error ? error.message : "Invalid Skill import",
  })
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
      const target = path.join(Global.Path.osHome, ".claude", "skills")
      if (!(yield* fs.existsSafe(target))) throw new NotFoundError({ message: `Preset skill root not found: ${target}` })
      return {
        path: target,
        cleanup: Effect.void,
        fallbackName: undefined,
      }
    }
      if (kind === "codex") {
        const target = path.join(Global.Path.osHome, ".codex", "skills")
        if (!(yield* fs.existsSafe(target))) throw new NotFoundError({ message: `Preset skill root not found: ${target}` })
        return {
          path: target,
          cleanup: Effect.void,
          fallbackName: undefined,
        }
      }
    if (kind === "agents") {
      const target = path.join(Global.Path.osHome, ".agents", "skills")
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
    yield* Effect.tryPromise({ try: () => extractSkillZip(source, temp), catch: (error) => error }).pipe(
      Effect.catch((error) =>
        fs
          .remove(temp, { recursive: true, force: true })
          .pipe(Effect.catch(() => Effect.void), Effect.andThen(Effect.fail(error))),
      ),
    )
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

    const budget = createSkillImportBudget()
    return yield* Effect.forEach(candidates, (candidate) => importSkillCandidate(fs, candidate, budget), {
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
  budget: ReturnType<typeof createSkillImportBudget>,
): Effect.Effect<{ target: string; targetName: string }, unknown, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const targetName = Skill.Name.safeParse(candidate.targetName)
    if (!targetName.success) throw invalidSkillFrontmatter(targetName.error.message)
    const root = localSkillRoot()
    const target = path.join(root, targetName.data)
    if (AppFileSystem.resolve(candidate.source) === AppFileSystem.resolve(target)) {
      throw new Error("Source and destination are the same")
    }

    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const staging = path.join(root, `.${targetName.data}.${suffix}.tmp`)
    const backup = path.join(root, `.${targetName.data}.${suffix}.backup`)
    yield* fs.ensureDir(root)

    return yield* Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => copySkillImportDirectory(fs, candidate.source, staging, budget),
        catch: (error) => error,
      })
      const skillFile = path.join(staging, "SKILL.md")
      const copied = yield* fs.readFileString(skillFile)
      const parsed = yield* Effect.try({
        try: () => matter(copied),
        catch: () => invalidSkillFrontmatter("Imported SKILL.md has invalid YAML frontmatter"),
      })
      const frontmatter = Skill.Frontmatter.safeParse(parsed.data)
      if (!frontmatter.success) throw invalidSkillFrontmatter(frontmatter.error.message)
      yield* fs.writeWithDirs(skillFile, matter.stringify(parsed.content, frontmatter.data))

      const replacing = yield* fs.existsSafe(target)
      if (replacing) yield* fs.rename(target, backup)
      yield* fs.rename(staging, target).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (replacing && (yield* fs.existsSafe(backup))) {
              yield* fs.rename(backup, target).pipe(Effect.catch(() => Effect.void))
            }
            return yield* Effect.fail(error)
          }),
        ),
      )
      if (replacing) yield* fs.remove(backup, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))
      return { target, targetName: targetName.data }
    }).pipe(Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))))
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

function createSkillImportBudget() {
  let files = 0
  let totalBytes = 0
  return {
    add(relative: string, byteLength: number) {
      if (!Number.isFinite(byteLength) || byteLength < 0) throw new Error(`Invalid Skill import size: ${relative}`)
      if (byteLength > SKILL_IMPORT_LIMITS.maxFileBytes) {
        throw new Error(`Skill import file exceeds the ${SKILL_IMPORT_LIMITS.maxFileBytes}-byte limit: ${relative}`)
      }
      files += 1
      if (files > SKILL_IMPORT_LIMITS.maxFiles) {
        throw new Error(`Skill import contains more than ${SKILL_IMPORT_LIMITS.maxFiles} files`)
      }
      totalBytes += byteLength
      if (totalBytes > SKILL_IMPORT_LIMITS.maxTotalBytes) {
        throw new Error(`Skill import exceeds the ${SKILL_IMPORT_LIMITS.maxTotalBytes}-byte total limit`)
      }
    },
  }
}

function skillImportTarget(root: string, relative: string) {
  const normalized = relative.replaceAll("\\", "/")
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Invalid Skill import path: ${relative}`)
  }
  const segments = normalized.split("/")
  if (
    segments.length > SKILL_IMPORT_LIMITS.maxDepth ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))
  ) {
    throw new Error(`Invalid Skill import path: ${relative}`)
  }
  const target = path.resolve(root, ...segments)
  const fromRoot = path.relative(root, target)
  if (!fromRoot || path.isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid Skill import path: ${relative}`)
  }
  return target
}

async function copySkillImportDirectory(
  appFs: AppFileSystem.Interface,
  source: string,
  target: string,
  budget: ReturnType<typeof createSkillImportBudget>,
) {
  const copy = async (directory: string, relative: string) => {
    const entries = await Effect.runPromise(appFs.readDirectoryEntries(directory))
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      if (entry.type === "symlink") continue
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name
      const destination = skillImportTarget(target, nextRelative)
      const from = path.join(directory, entry.name)
      if (entry.type === "directory") {
        await copy(from, nextRelative)
        continue
      }
      if (entry.type !== "file") throw new Error(`Unsupported Skill import entry: ${nextRelative}`)
      const stat = await fs.stat(from)
      budget.add(nextRelative, stat.size)
      const bytes = await Effect.runPromise(appFs.readFile(from))
      if (bytes.byteLength !== stat.size) throw new Error(`Skill import changed while reading: ${nextRelative}`)
      await Effect.runPromise(appFs.writeWithDirs(destination, bytes))
    }
  }
  await copy(source, "")
}

async function extractSkillZip(zipPath: string, target: string) {
  const stat = await fs.stat(zipPath)
  if (stat.size > SKILL_IMPORT_LIMITS.maxArchiveBytes) {
    throw new Error(`Skill import archive exceeds the ${SKILL_IMPORT_LIMITS.maxArchiveBytes}-byte limit`)
  }
  // The archive input is capped before reading. Reusing this immutable buffer avoids
  // a second disk scan between metadata preflight and bounded stream extraction.
  const archive = await fs.readFile(zipPath)
  if (archive.byteLength !== stat.size) throw new Error("Skill import archive changed while reading")
  const reader = await openSkillZip(archive)
  try {
    const entries = await readSkillZipEntries(reader)
    if (entries.length > SKILL_IMPORT_LIMITS.maxFiles) {
      throw new Error(`Skill import archive contains more than ${SKILL_IMPORT_LIMITS.maxFiles} entries`)
    }
    const budget = createSkillImportBudget()
    const normalizedPaths = new Set<string>()
    const files = entries.filter((entry) => !entry.fileName.endsWith("/"))
    for (const entry of files) {
      const relative = entry.fileName.replaceAll("\\", "/")
      const destination = skillImportTarget(target, relative)
      const normalized = path.relative(target, destination).split(path.sep).join("/").toLowerCase()
      if (normalizedPaths.has(normalized)) {
        throw new Error(`Skill import archive contains duplicate path after normalization: ${relative}`)
      }
      normalizedPaths.add(normalized)
      if (entry.isEncrypted()) throw new Error(`Encrypted Skill import entries are not supported: ${relative}`)
      if (entry.compressedSize > SKILL_IMPORT_LIMITS.maxFileBytes) {
        throw new Error(`Skill import archive file exceeds the ${SKILL_IMPORT_LIMITS.maxFileBytes}-byte compressed limit: ${relative}`)
      }
      budget.add(relative, entry.uncompressedSize)
    }

    await writePreflightSkillZipEntries(archive, target, entries)
  } finally {
    reader.close()
  }
}

async function writePreflightSkillZipEntries(archive: Buffer, target: string, expected: yauzl.Entry[]) {
  const reader = await openSkillZip(archive)
  let actualTotal = 0
  let index = 0
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        reader.close()
        reject(error)
      }
      reader.once("error", fail)
      reader.once("end", () => {
        if (settled) return
        if (index !== expected.length) {
          fail(new Error("Skill import archive changed after validation"))
          return
        }
        settled = true
        resolve()
      })
      reader.on("entry", (entry: yauzl.Entry) => {
        const preflight = expected[index++]
        if (!preflight || preflight.fileName !== entry.fileName || preflight.uncompressedSize !== entry.uncompressedSize) {
          fail(new Error("Skill import archive changed after validation"))
          return
        }
        if (entry.fileName.endsWith("/")) {
          reader.readEntry()
          return
        }
        void (async () => {
          try {
            const relative = entry.fileName.replaceAll("\\", "/")
            const destination = skillImportTarget(target, relative)
            const chunks: Uint8Array[] = []
            let actualSize = 0
            const stream = await openSkillZipEntry(reader, entry)
            for await (const chunk of stream) {
              const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
              const nextSize = actualSize + bytes.byteLength
              const nextTotal = actualTotal + bytes.byteLength
              if (nextSize > SKILL_IMPORT_LIMITS.maxFileBytes || nextTotal > SKILL_IMPORT_LIMITS.maxTotalBytes) {
                stream.destroy(new Error(`Skill import archive output exceeds the configured size limit: ${relative}`))
                throw new Error(`Skill import archive output exceeds the configured size limit: ${relative}`)
              }
              actualSize = nextSize
              actualTotal = nextTotal
              chunks.push(bytes)
            }
            const bytes = new Uint8Array(actualSize)
            let offset = 0
            for (const chunk of chunks) {
              bytes.set(chunk, offset)
              offset += chunk.byteLength
            }
            await fs.mkdir(path.dirname(destination), { recursive: true })
            await fs.writeFile(destination, bytes)
            reader.readEntry()
          } catch (error) {
            fail(error)
          }
        })()
      })
      reader.readEntry()
    })
  } finally {
    reader.close()
  }
}

function openSkillZip(archive: Buffer) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(archive, { autoClose: false, lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, reader) => {
      if (error || !reader) {
        reject(error ?? new Error("Could not read Skill import archive"))
        return
      }
      resolve(reader)
    })
  })
}

function readSkillZipEntries(reader: yauzl.ZipFile) {
  return new Promise<yauzl.Entry[]>((resolve, reject) => {
    const entries: yauzl.Entry[] = []
    reader.once("error", reject)
    reader.on("entry", (entry: yauzl.Entry) => {
      entries.push(entry)
      reader.readEntry()
    })
    reader.once("end", () => resolve(entries))
    reader.readEntry()
  })
}

function openSkillZipEntry(reader: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<import("stream").Readable>((resolve, reject) => {
    reader.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stream)
    })
  })
}

function localSkillRoot() {
  return globalSkillRoot()
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
    const parsed = Skill.Frontmatter.safeParse(md.data)
    if (!parsed.success) return undefined
    const metadata = yield* loadOpenAISkillMetadata(path.join(path.dirname(item.file), "agents", "openai.yaml"))
    return {
      directory: item.directory,
      name: parsed.data.name,
      description: parsed.data.description,
      location: item.file,
      content: md.content,
      ...(metadata?.interface.display_name ? { displayName: metadata.interface.display_name } : {}),
      ...(metadata?.interface.short_description ? { shortDescription: metadata.interface.short_description } : {}),
    } satisfies z.infer<typeof LocalSkillInfo>
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function loadSkillPresentation(skill: z.infer<typeof SkillInfo>): Effect.Effect<z.infer<typeof SkillInfo>, never, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const metadata = yield* loadOpenAISkillMetadata(path.join(path.dirname(skill.location), "agents", "openai.yaml"))
    return {
      ...skill,
      ...(metadata?.interface.display_name ? { displayName: metadata.interface.display_name } : {}),
      ...(metadata?.interface.short_description ? { shortDescription: metadata.interface.short_description } : {}),
    }
  })
}

function loadOpenAISkillMetadata(file: string): Effect.Effect<z.infer<typeof OpenAISkillMetadata> | undefined, never, AppFileSystem.Service> {
  return Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    if (!(yield* fs.existsSafe(file))) return undefined
    const parsed = matter(`---\n${yield* fs.readFileString(file)}---`)
    return OpenAISkillMetadata.safeParse(parsed.data).data
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}
