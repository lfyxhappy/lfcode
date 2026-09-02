import z from "zod"
import os from "os"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@/filesystem"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { fileURLToPath } from "url"
import { Shell } from "@/shell/shell"

import { SessionCwd } from "./session-cwd"
import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as BashInteractive from "./bash-interactive"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"

const PS = new Set(["powershell", "pwsh"])
const CWD = new Set(["cd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

const Parameters = z.object({
  command: z
    .string()
    .describe(
      "The command to execute. On Windows, this `shell` tool is actually a PowerShell 7 (`pwsh`) terminal. Generate `pwsh` syntax only; do not use cmd.exe, Bash, or Windows PowerShell 5-only syntax.",
    ),
  timeout: z
    .number()
    .describe("Optional reminder threshold in milliseconds. It never terminates the command.")
    .optional(),
  workdir: z
    .string()
    .describe(
      `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    )
    .optional(),
  interactive: z
    .boolean()
    .describe(
      "Set to true when the command requires user interaction (password input, y/N confirmation, SSH key passphrase, etc). The terminal will be handed to the user for direct interaction.",
    )
    .optional(),
  background: z
    .boolean()
    .describe(
      "Deprecated no-op. Every non-interactive shell command is already a tracked shell process; inspect one with shell_process only when needed.",
    )
    .optional(),
  description: z
    .string()
    .describe(
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
    ),
})

export type ShellToolInput = z.infer<typeof Parameters>
export type PreparedShellExecution = {
  shell: string
  shellName: string
  cwd: string
  env: NodeJS.ProcessEnv
}

type ShellMetadata = {
  output: string
  exit: number | null
  description: string
  truncated: boolean
  jobID?: string
  status?: string
}

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

export const log = Log.create({ service: "bash-tool" })
const INLINE_SHELL_WAIT_MS = 1_250

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean) {
  if (!ps) {
    return list
      .slice(1)
      .filter((item) => !item.text.startsWith("-") && !(list[0]?.text === "chmod" && item.text.startsWith("+")))
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function pwshGuardMessage(command: string) {
  const trimmed = command.trimStart()

  const exportMatch = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.+)$/s)
  if (exportMatch) {
    return [
      "This Windows terminal tool only accepts PowerShell 7 (`pwsh`) syntax.",
      `Bash-style \`export\` is not supported here. Rewrite it as \`$env:${exportMatch[1]} = ${exportMatch[2].trim()}\`.`,
    ].join(" ")
  }

  const inlineEnvMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=([^\s;|&]+)\s+(.+)$/s)
  if (inlineEnvMatch) {
    return [
      "This Windows terminal tool only accepts PowerShell 7 (`pwsh`) syntax.",
      `Inline Bash environment assignment is not supported here. Rewrite it as \`$env:${inlineEnvMatch[1]} = ${inlineEnvMatch[2]}; ${inlineEnvMatch[3].trim()}\`.`,
    ].join(" ")
  }

  const sourceMatch = trimmed.match(/^source\s+(.+)$/s)
  if (sourceMatch) {
    return [
      "This Windows terminal tool only accepts PowerShell 7 (`pwsh`) syntax.",
      `Bash-style \`source\` is not supported here. Use \`. ${sourceMatch[1].trim()}\` to dot-source a PowerShell script, or \`& ${sourceMatch[1].trim()}\` to run it.`,
    ].join(" ")
  }

  const heredocMatch = trimmed.match(/^[^\r\n]*<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
  if (heredocMatch) {
    return [
      "This Windows terminal tool only accepts PowerShell 7 (`pwsh`) syntax.",
      "Bash heredocs are not supported here.",
      "Use a PowerShell here-string like `@' ... '@` or `@\" ... \"@` instead.",
    ].join(" ")
  }

  const testMatch = trimmed.match(/^(?:if\s+)?\[\[.*\]\]/s)
  if (testMatch) {
    return [
      "This Windows terminal tool only accepts PowerShell 7 (`pwsh`) syntax.",
      "Bash `[[ ... ]]` tests are not supported here. Rewrite them with PowerShell conditionals such as `if (Test-Path ...) { ... }` or `if ($value -eq ... ) { ... }`.",
    ].join(" ")
  }
}

const parse = Effect.fn("BashTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree.rootNode
})

const ask = Effect.fn("BashTool.ask")(function* (ctx: Tool.Context, scan: Scan) {
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => {
      if (process.platform === "win32") return AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: "shell",
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })
})

const cygpath = Effect.fn("BashTool.cygpath")(function* (shell: string, text: string) {
  const spawner = yield* ChildProcessSpawner
  const lines = yield* spawner
    .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  const file = lines[0]?.trim()
  if (!file) return
  return AppFileSystem.normalizePath(file)
})

export const resolveShellPath = Effect.fn("BashTool.resolvePath")(function* (
  text: string,
  root: string,
  shell: string,
) {
  if (process.platform === "win32") {
    if (Shell.posix(shell) && text.startsWith("/") && AppFileSystem.windowsPath(text) === text) {
      const file = yield* cygpath(shell, text)
      if (file) return file
    }
    return AppFileSystem.normalizePath(path.resolve(root, AppFileSystem.windowsPath(text)))
  }
  return path.resolve(root, text)
})

const argPath = Effect.fn("BashTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
  const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
  const file = text && prefix(text)
  if (!file || dynamic(file, ps)) return
  const next = ps ? provider(file) : file
  if (!next) return
  return yield* resolveShellPath(next, cwd, shell)
})

const collectPermissionScan = Effect.fn("BashTool.collect")(function* (
  root: Node,
  cwd: string,
  ps: boolean,
  shell: string,
) {
  const fs = yield* AppFileSystem.Service
  const scan: Scan = {
    dirs: new Set<string>(),
    patterns: new Set<string>(),
    always: new Set<string>(),
  }

  for (const node of commands(root)) {
    const command = parts(node)
    const tokens = command.map((item) => item.text)
    const cmd = ps ? tokens[0]?.toLowerCase() : tokens[0]

    if (cmd && FILES.has(cmd)) {
      for (const arg of pathArgs(command, ps)) {
        const resolved = yield* argPath(arg, cwd, ps, shell)
        log.info("resolved path", { arg, resolved })
        if (!resolved || Instance.containsPath(resolved)) continue
        const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
        scan.dirs.add(dir)
      }
    }

    if (tokens.length && (!cmd || !CWD.has(cmd))) {
      scan.patterns.add(source(node))
      scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
    }
  }

  return scan
})

const shellEnv = Effect.fn("BashTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
  const plugin = yield* Plugin.Service
  const extra = yield* plugin.trigger("shell.env", { cwd, sessionID: ctx.sessionID, callID: ctx.callID }, { env: {} })
  return {
    ...process.env,
    ...extra.env,
  }
})

export const prepareShellExecution = Effect.fn("BashTool.prepareShellExecution")(function* (
  params: Pick<ShellToolInput, "command" | "timeout" | "workdir" | "interactive" | "background">,
  ctx: Tool.Context,
) {
  const shell = Shell.acceptable()
  const shellName = Shell.name(shell)
  const effectiveCwd = SessionCwd.get(ctx.sessionID)
  const cwd = params.workdir ? yield* resolveShellPath(params.workdir, effectiveCwd, shell) : effectiveCwd
  if (params.timeout !== undefined && params.timeout < 0) {
    throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
  }
  if (params.interactive && params.background) {
    throw new Error("`interactive: true` cannot be combined with `background: true`.")
  }
  const ps = PS.has(shellName)
  if (process.platform === "win32" && ps) {
    const guard = pwshGuardMessage(params.command)
    if (guard) throw new Error(guard)
  }
  const root = yield* parse(params.command, ps)
  const scan = yield* collectPermissionScan(root, cwd, ps, shell)
  if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)
  yield* ask(ctx, scan)
  const env = yield* shellEnv(ctx, cwd)
  return {
    shell,
    shellName,
    cwd,
    env,
  } satisfies PreparedShellExecution
})

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

function defineShellTool() {
  return Tool.define(
    "shell",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const fs = yield* AppFileSystem.Service
      const plugin = yield* Plugin.Service

      return () =>
        Effect.sync(() => {
          const shell = Shell.acceptable()
          const name = Shell.name(shell)
          const shellContract =
            process.platform === "win32"
              ? "On Windows, this `shell` tool always runs PowerShell 7 (`pwsh`). Treat every invocation as a `pwsh` terminal. Do NOT rely on cmd.exe syntax, Git Bash syntax, or Windows PowerShell 5-only behavior."
              : "On macOS and Linux, this tool runs the current POSIX shell. Generate shell syntax that matches the reported shell."
          const shellQuickstart =
            process.platform === "win32"
              ? [
                  "PowerShell 7 quick reference:",
                  "- Treat this tool as `pwsh`.",
                  "- Dependent commands: prefer `cmd1; if ($?) { cmd2 }`.",
                  '- Environment variables: use `$env:NAME = "value"`, and read them with `$env:NAME`.',
                  "- Multi-line scripts: use PowerShell here-strings such as `$script = @' ... '@` or `$script = @\" ... \"@`.",
                  "- File and directory listing: use `Get-ChildItem` or `Get-ChildItem -Force`.",
                  "- Current directory: use `Get-Location`.",
                  "- Search text/files: prefer `rg`, `Get-ChildItem -Recurse`, or dedicated tools.",
                  '- Read file content when the terminal is truly needed: use `Get-Content -LiteralPath "path"`.',
                  "- Filesystem mutations: prefer `New-Item`, `Copy-Item`, `Move-Item`, `Remove-Item`, and use `-LiteralPath` when paths may contain special characters.",
                  "- Paths with spaces: always wrap them in double quotes.",
                  "- Do NOT use Bash-only forms such as `export NAME=value`, `source file.sh`, `VAR=value cmd`, or Bash heredocs.",
                ].join("\n")
              : [
                  "POSIX shell quick reference:",
                  "- Dependent commands: use `cmd1 && cmd2` when later commands require earlier success.",
                  "- Environment variables: use `NAME=value cmd` or `export NAME=value` as appropriate for the shell.",
                  "- Paths with spaces: always wrap them in double quotes.",
                ].join("\n")
          const chain =
            process.platform === "win32" && PS.has(name)
              ? "If the commands depend on each other and must run sequentially in `pwsh`, prefer `cmd1; if ($?) { cmd2 }` or separate tool calls. Use `;` only when later commands should run even if earlier commands fail."
              : "If the commands depend on each other and must run sequentially, use a single shell call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts, run these operations sequentially instead."
          log.info("terminal tool using shell", { shell })

          return {
            description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
              .replaceAll("${os}", process.platform)
              .replaceAll("${shell}", name)
              .replaceAll("${shell_contract}", shellContract)
              .replaceAll("${shell_quickstart}", shellQuickstart)
              .replaceAll("${tool_identity}", "The public tool name is `shell`. Use it for all terminal operations.")
              .replaceAll("${chaining}", chain)
              .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
              .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
            parameters: Parameters,
            execute: (
              params: z.infer<typeof Parameters>,
              ctx: Tool.Context,
            ): Effect.Effect<Tool.ExecuteResult<ShellMetadata>> =>
              Effect.gen(function* () {
                const execution = {
                  ...params,
                  // Every non-interactive model command is durable. The legacy
                  // background flag remains accepted for schema compatibility,
                  // but it no longer controls process ownership.
                  background: !params.interactive,
                }
                const preparedResult = yield* prepareShellExecution(execution, ctx).pipe(
                  Effect.provideService(ChildProcessSpawner, spawner),
                  Effect.provideService(AppFileSystem.Service, fs),
                  Effect.provideService(Plugin.Service, plugin),
                  Effect.map((value) => ({ ok: true as const, value })),
                  // A missing parser asset must be reported as a tool failure,
                  // never allowed to escape as an unhandled rejection that
                  // terminates the Electron main process. Packaging validates
                  // these assets, but this guard also protects dev/old installs.
                  Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
                )
                if (!preparedResult.ok) {
                  const reason = String(preparedResult.error)
                  log.error("shell preparation failed", { error: reason, sessionID: ctx.sessionID, callID: ctx.callID })
                  return {
                    title: params.description,
                    metadata: { output: reason, description: params.description, exit: null, truncated: false },
                    output: `Shell is unavailable because command parsing failed: ${reason}`,
                  }
                }
                const prepared = preparedResult.value

                // Interactive mode: hand terminal to user for direct interaction
                if (params.interactive) {
                  yield* ctx.metadata({
                    metadata: {
                      output: "(waiting for user interaction...)",
                      description: params.description,
                    },
                  })
                  const interactiveResult = yield* Effect.tryPromise(() =>
                    BashInteractive.request({
                      command: params.command,
                      cwd: prepared.cwd,
                      env: prepared.env as Record<string, string>,
                      description: params.description,
                    }),
                  ).pipe(Effect.orDie)
                  return {
                    title: params.description,
                    metadata: {
                      output: interactiveResult.output || "(interactive command completed)",
                      exit: interactiveResult.exitCode,
                      description: params.description,
                      truncated: false,
                    },
                    output:
                      interactiveResult.output ||
                      `(interactive command completed with exit code ${interactiveResult.exitCode})`,
                  }
                }

                const runtime = shellBackgroundRuntimeRef.current
                if (!runtime) {
                  const reason = "Shell background runtime is not available in this process."
                  log.error("shell execution unavailable", { error: reason, sessionID: ctx.sessionID, callID: ctx.callID })
                  return {
                    title: params.description,
                    metadata: { output: reason, description: params.description, exit: null, truncated: false },
                    output: reason,
                  }
                }
                const job = yield* runtime.start({
                  sessionID: ctx.sessionID,
                  title: params.description,
                  command: params.command,
                  cwd: prepared.cwd,
                  env: Object.fromEntries(
                    Object.entries(prepared.env).filter(
                      (entry): entry is [string, string] => typeof entry[1] === "string",
                    ),
                  ),
                  shell: prepared.shell,
                  shellName: prepared.shellName,
                  source: "shell",
                  ...(params.timeout !== undefined ? { remindAfterMs: params.timeout } : {}),
                  ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
                  ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
                })
                const settled = yield* runtime.wait({ jobID: job.id, timeoutMs: INLINE_SHELL_WAIT_MS })
                const latest = settled.job ?? job
                if (!settled.timedOut) {
                  const output = BackgroundJobPersistence.listLogs({ jobID: job.id })
                    .filter((entry) => entry.stream === "stdout" || entry.stream === "stderr")
                    .map((entry) => entry.text)
                    .join("")
                    .trim()
                  return {
                    title: params.description,
                    metadata: {
                      output,
                      description: params.description,
                      exit: latest.exitCode ?? null,
                      truncated: false,
                      jobID: latest.id,
                      status: latest.status,
                    },
                    output: output || `Shell command finished with status ${latest.status}.`,
                  }
                }
                return {
                  title: params.description,
                  metadata: {
                    output: `Started shell process ${job.id}`,
                    description: params.description,
                    exit: null,
                    truncated: false,
                    jobID: job.id,
                    status: job.status,
                  },
                  output: [
                    `Started tracked shell process.`,
                    `<job_id>${job.id}</job_id>`,
                    `<status>${job.status}</status>`,
                    `<cwd>${job.cwd}</cwd>`,
                    `<title>${job.title}</title>`,
                  ].join("\n"),
                }
              }),
          }
        })
    }),
  )
}

export const ShellTool = defineShellTool()
