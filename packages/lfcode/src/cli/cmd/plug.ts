import { confirm, intro, isCancel, log, outro, spinner } from "@clack/prompts"
import path from "path"
import type { Argv } from "yargs"

import { ConfigPaths } from "../../config"
import { Global } from "../../global"
import { installPlugin, patchPluginConfig, readPluginManifest } from "../../plugin/install"
import { resolvePluginTarget } from "../../plugin/shared"
import {
  commitImport,
  exportPlugin,
  listInstalledPlugins,
  previewDirectoryImport,
  previewNpmImport,
  previewZipImport,
  setPluginEnabled,
  uninstallPlugin,
} from "../../plugin/library"
import { Instance } from "../../project/instance"
import { errorMessage } from "../../util/error"
import { Filesystem } from "../../util"
import { Process } from "../../util"
import { UI } from "../ui"
import { cmd } from "./cmd"

type Spin = {
  start: (msg: string) => void
  stop: (msg: string, code?: number) => void
}

export type PlugDeps = {
  spinner: () => Spin
  log: {
    error: (msg: string) => void
    info: (msg: string) => void
    success: (msg: string) => void
  }
  resolve: (spec: string) => Promise<string>
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: "lfcode" | "tui") => string[]
  global: string
}

export type PlugInput = {
  mod: string
  global?: boolean
  force?: boolean
}

export type PlugCtx = {
  vcs?: string
  worktree: string
  directory: string
}

const defaultPlugDeps: PlugDeps = {
  spinner: () => spinner(),
  log: {
    error: (msg) => log.error(msg),
    info: (msg) => log.info(msg),
    success: (msg) => log.success(msg),
  },
  resolve: (spec) => resolvePluginTarget(spec),
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
  global: Global.Path.config,
}

function cause(err: unknown) {
  if (!err || typeof err !== "object") return
  if (!("cause" in err)) return
  return (err as { cause?: unknown }).cause
}

export function createPlugTask(input: PlugInput, dep: PlugDeps = defaultPlugDeps) {
  const mod = input.mod
  const force = Boolean(input.force)
  const global = Boolean(input.global)

  return async (ctx: PlugCtx) => {
    const install = dep.spinner()
    install.start("Installing plugin package...")
    const target = await installPlugin(mod, dep)
    if (!target.ok) {
      install.stop("Install failed", 1)
      dep.log.error(`Could not install "${mod}"`)
      const hit = cause(target.error) ?? target.error
      if (hit instanceof Process.RunFailedError) {
        const lines = hit.stderr
          .toString()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const errs = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
        const detail = errs[0] ?? lines.at(-1)
        if (detail) dep.log.error(detail)
        if (lines.some((line) => line.includes("No version matching"))) {
          dep.log.info("This package depends on a version that is not available in your npm registry.")
          dep.log.info("Check npm registry/auth settings and try again.")
        }
      }
      if (!(hit instanceof Process.RunFailedError)) {
        dep.log.error(errorMessage(hit))
      }
      return false
    }
    install.stop("Plugin package ready")

    const inspect = dep.spinner()
    inspect.start("Reading plugin manifest...")
    const manifest = await readPluginManifest(target.target)
    if (!manifest.ok) {
      if (manifest.code === "manifest_read_failed") {
        inspect.stop("Manifest read failed", 1)
        dep.log.error(`Installed "${mod}" but failed to read ${manifest.file}`)
        dep.log.error(errorMessage(cause(manifest.error) ?? manifest.error))
        return false
      }

      if (manifest.code === "manifest_no_targets") {
        inspect.stop("No plugin targets found", 1)
        dep.log.error(`"${mod}" does not expose plugin entrypoints in package.json`)
        dep.log.info(
          'Expected one of: exports["./tui"], exports["./server"], package.json main for server, or package.json["oc-themes"] for tui themes.',
        )
        return false
      }

      inspect.stop("Manifest read failed", 1)
      return false
    }

    inspect.stop(
      `Detected ${manifest.targets.map((item) => item.kind).join(" + ")} target${manifest.targets.length === 1 ? "" : "s"}`,
    )

    const patch = dep.spinner()
    patch.start("Updating plugin config...")
    const out = await patchPluginConfig(
      {
        spec: mod,
        targets: manifest.targets,
        force,
        global,
        vcs: ctx.vcs,
        worktree: ctx.worktree,
        directory: ctx.directory,
        config: dep.global,
      },
      dep,
    )
    if (!out.ok) {
      if (out.code === "invalid_json") {
        patch.stop(`Failed updating ${out.kind} config`, 1)
        dep.log.error(`Invalid JSON in ${out.file} (${out.parse} at line ${out.line}, column ${out.col})`)
        dep.log.info("Fix the config file and run the command again.")
        return false
      }

      patch.stop("Failed updating plugin config", 1)
      dep.log.error(errorMessage(out.error))
      return false
    }
    patch.stop("Plugin config updated")
    for (const item of out.items) {
      if (item.mode === "noop") {
        dep.log.info(`Already configured in ${item.file}`)
        continue
      }
      if (item.mode === "replace") {
        dep.log.info(`Replaced in ${item.file}`)
        continue
      }
      dep.log.info(`Added to ${item.file}`)
    }

    dep.log.success(`Installed ${mod}`)
    dep.log.info(global ? `Scope: global (${out.dir})` : `Scope: local (${out.dir})`)
    return true
  }
}

export const PluginCommand = cmd({
  command: "plugin [module]",
  aliases: ["plug"],
  describe: "install legacy plugins or manage the reviewed plugin library",
  builder: (yargs: Argv) => {
    return yargs
      .command(PluginListCommand)
      .command(PluginInspectCommand)
      .command(PluginImportCommand)
      .command(PluginCommitCommand)
      .command(PluginEnableCommand)
      .command(PluginDisableCommand)
      .command(PluginUninstallCommand)
      .command(PluginExportCommand)
      .positional("module", {
        type: "string",
        describe: "npm module name",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "install in global config",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "replace existing plugin version",
      })
  },
  handler: async (args) => {
    const mod = String(args.module ?? "").trim()
    if (!mod) {
      UI.error("module or plugin subcommand is required")
      process.exitCode = 1
      return
    }

    UI.empty()
    intro(`Install plugin ${mod}`)

    const run = createPlugTask({
      mod,
      global: Boolean(args.global),
      force: Boolean(args.force),
    })
    let ok = true

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        ok = await run({
          vcs: Instance.project.vcs,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    })

    outro("Done")
    if (!ok) process.exitCode = 1
  },
})

function json(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n")
}

function spec(value: unknown) {
  const result = String(value ?? "").trim()
  if (!result) throw new Error("managed plugin spec is required")
  return result.startsWith("lfplugin:") ? result : `lfplugin:${result}`
}

function report(value: Awaited<ReturnType<typeof previewDirectoryImport>>) {
  log.info(`${value.report.name} ${value.report.version} (${value.report.category})`)
  log.info(`ID: ${value.report.id}`)
  log.info(`Operation: ${value.report.operation}`)
  log.info(`Source: ${value.report.source.type} ${value.report.source.label}`)
  log.info(`SHA-256: ${value.report.source.digest}`)
  log.info(`Files: ${value.report.files.count}, bytes: ${value.report.files.bytes}`)
  if (value.report.entrypoints.length) log.info(`Entrypoints: ${value.report.entrypoints.join(", ")}`)
  for (const warning of value.report.warnings) log.warn(warning)
  log.info(`Preview token: ${value.token}`)
}

export const PluginListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list managed plugins",
  builder: (yargs) => yargs.option("json", { type: "boolean", default: false }),
  async handler(args) {
    const items = await listInstalledPlugins()
    if (args.json) return json(items)
    if (!items.length) return log.info("No managed plugins installed")
    for (const item of items)
      log.info(`${item.enabled ? "enabled" : "disabled"} ${item.spec} ${item.version} ${item.category}`)
  },
})

export const PluginInspectCommand = cmd({
  command: "inspect <spec>",
  describe: "inspect a managed plugin",
  builder: (yargs) => yargs.positional("spec", { type: "string" }).option("json", { type: "boolean", default: false }),
  async handler(args) {
    const target = spec(args.spec)
    const item = (await listInstalledPlugins()).find((entry) => entry.spec === target)
    if (!item) throw new Error(`Managed plugin not found: ${target}`)
    if (args.json) return json(item)
    log.info(`${item.name} ${item.version} (${item.category})`)
    log.info(`${item.spec} ${item.enabled ? "enabled" : "disabled"}`)
    log.info(`Source: ${item.source.type} ${item.source.label}`)
    log.info(`SHA-256: ${item.source.digest}`)
  },
})

export const PluginImportCommand = cmd({
  command: "import <source>",
  describe: "preview and optionally import an npm, directory, or ZIP plugin",
  builder: (yargs) =>
    yargs
      .positional("source", { type: "string" })
      .option("type", { choices: ["npm", "directory", "zip"] as const, demandOption: true })
      .option("json", { type: "boolean", default: false })
      .option("yes", {
        type: "boolean",
        default: false,
        describe: "confirm the reviewed preview in an interactive terminal",
      }),
  async handler(args) {
    const source = String(args.source)
    const preview =
      args.type === "npm"
        ? await previewNpmImport({ spec: source })
        : args.type === "zip"
          ? await previewZipImport({ file: source })
          : await previewDirectoryImport({ directory: source })
    if (args.json) json(preview)
    else report(preview)
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      log.info("Preview only. Commit explicitly with: lfcode plugin commit <token>")
      return
    }
    const accepted =
      args.yes || (await confirm({ message: `Install ${preview.report.name} ${preview.report.version}?` }))
    if (isCancel(accepted) || !accepted) return log.info("Preview not committed")
    const item = await commitImport(preview.token)
    log.success(`Installed ${item.spec}`)
  },
})

export const PluginCommitCommand = cmd({
  command: "commit <token>",
  describe: "commit a previously reviewed plugin preview token",
  builder: (yargs) => yargs.positional("token", { type: "string" }).option("json", { type: "boolean", default: false }),
  async handler(args) {
    const item = await commitImport(String(args.token))
    if (args.json) return json(item)
    log.success(`Installed ${item.spec}`)
  },
})

function toggleCommand(enabled: boolean) {
  return cmd({
    command: `${enabled ? "enable" : "disable"} <spec>`,
    describe: `${enabled ? "enable" : "disable"} a managed plugin`,
    builder: (yargs) =>
      yargs.positional("spec", { type: "string" }).option("json", { type: "boolean", default: false }),
    async handler(args) {
      const item = await setPluginEnabled(spec(args.spec), enabled)
      if (args.json) return json(item)
      log.success(`${enabled ? "Enabled" : "Disabled"} ${item.spec}`)
    },
  })
}

export const PluginEnableCommand = toggleCommand(true)
export const PluginDisableCommand = toggleCommand(false)

export const PluginUninstallCommand = cmd({
  command: "uninstall <spec>",
  describe: "uninstall a managed plugin",
  builder: (yargs) =>
    yargs.positional("spec", { type: "string" }).option("json", { type: "boolean", default: false }).option("yes", {
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    const target = spec(args.spec)
    if (!args.yes) {
      if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error("Use --yes to uninstall non-interactively")
      const accepted = await confirm({ message: `Uninstall ${target}?` })
      if (isCancel(accepted) || !accepted) return log.info("Uninstall cancelled")
    }
    const item = await uninstallPlugin(target)
    if (args.json) return json(item)
    log.success(`Uninstalled ${item.spec}`)
  },
})

export const PluginExportCommand = cmd({
  command: "export <spec> <output>",
  describe: "export a managed plugin as a deterministic ZIP",
  builder: (yargs) =>
    yargs
      .positional("spec", { type: "string" })
      .positional("output", { type: "string" })
      .option("json", { type: "boolean", default: false }),
  async handler(args) {
    const item = await exportPlugin(spec(args.spec), path.resolve(String(args.output)))
    if (args.json) return json(item)
    log.success(`Exported ${item.file}`)
  },
})
