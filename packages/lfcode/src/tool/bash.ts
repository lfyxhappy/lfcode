import z from "zod"
import os from "os"
import { createWriteStream, readFileSync } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag"
import { Shell } from "@/shell/shell"

import { SessionCwd } from "./session-cwd"
import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as BashInteractive from "./bash-interactive"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import { Identifier } from "@/id/id"
import * as PatchRecovery from "./patch-recovery"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.LFCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const RETRY_WINDOW_MS = 10 * 60 * 1000
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
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
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
      "Set to true to start this command as a durable background shell job. Background jobs continue after this tool call returns and can later be inspected or awaited with the background_job tool.",
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
  timeout: number
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

type Chunk = {
  text: string
  size: number
}

export const log = Log.create({ service: "bash-tool" })

const failedCommands = new Map<string, { failures: number; updatedAt: number }>()

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

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

const ERROR_PATTERN = /error|exception|failed|fatal|traceback|panic|exit code/i
const HEAD_BYTES = Math.floor(Truncate.MAX_BYTES * 0.7)
const HEAD_LINES = Math.floor(Truncate.MAX_LINES * 0.7)

function head(text: string, maxLines: number, maxBytes: number): string {
  const lines = text.split("\n")
  const out: string[] = []
  let bytes = 0
  for (let i = 0; i < lines.length && out.length < maxLines; i++) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
    if (bytes + size > maxBytes) break
    out.push(lines[i])
    bytes += size
  }
  return out.join("\n")
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
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

function shouldRunInBackground(command: string) {
  return /\b(?:vite|next|nuxt|astro|webpack|parcel|storybook)\s+(?:dev|serve|watch)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|watch)\b|\bjupyter\s+(?:lab|notebook)\b|\b(?:node|python|python3|pwsh)\b[^\n]*(?:--watch|\bserve\b)/i.test(
    command,
  )
}

function classifyShellFailure(input: { code: number | null; expired: boolean; aborted: boolean; output: string }) {
  if (input.aborted) return "aborted"
  if (input.expired) return "timeout"
  if (input.code === 0) return
  if (/parsererror|unexpected token|syntax error|not recognized as the name of a cmdlet/i.test(input.output))
    return "syntax"
  if (/cannot find path|no such file|does not exist|path not found|file not found/i.test(input.output)) return "path"
  if (/access is denied|permission denied|unauthorized|not permitted/i.test(input.output)) return "permission"
  return "process"
}

function commandSignature(sessionID: string, cwd: string, command: string) {
  return `${sessionID}\0${cwd}\0${command.toLowerCase().replace(/[\s'"`()\[\]{}]+/g, "")}`
}

function assertRetryBudget(sessionID: string, cwd: string, command: string) {
  const entry = failedCommands.get(commandSignature(sessionID, cwd, command))
  if (!entry || Date.now() - entry.updatedAt > RETRY_WINDOW_MS) return
  if (entry.failures < 2) return
  throw new Error(
    "This equivalent shell command has already failed twice in this session. Stop retrying it, summarize the classified failure, then inspect the relevant path, permission, process state, or syntax before choosing a different verified approach.",
  )
}

function rememberCommandResult(
  sessionID: string,
  cwd: string,
  command: string,
  failed: boolean,
) {
  const signature = commandSignature(sessionID, cwd, command)
  if (!failed) {
    failedCommands.delete(signature)
    return
  }
  const previous = failedCommands.get(signature)
  failedCommands.set(signature, {
    failures: (previous?.failures ?? 0) + 1,
    updatedAt: Date.now(),
  })
}

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
  if (params.background && params.timeout !== undefined) {
    throw new Error(
      '`timeout` only applies to blocking shell execution. Start the job in background mode, then use `background_job` with `operation="wait"` and `timeout_ms` if you need bounded waiting.',
    )
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
    timeout: params.timeout ?? DEFAULT_TIMEOUT,
  } satisfies PreparedShellExecution
})

function cmd(shell: string, name: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && PS.has(name)) {
    const utf8 = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$OutputEncoding = [Console]::OutputEncoding",
      `& { ${command} }`,
    ].join("; ")
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", utf8], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}

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

function defineShellTool(id: "shell" | "bash", legacy: boolean) {
  return Tool.define(
    id,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const fs = yield* AppFileSystem.Service
      const plugin = yield* Plugin.Service
      const trunc = yield* Truncate.Service

      const run = Effect.fn("BashTool.run")(function* (
        input: {
          shell: string
          name: string
          command: string
          cwd: string
          env: NodeJS.ProcessEnv
          timeout: number
          description: string
        },
        ctx: Tool.Context,
      ) {
        const patchBypass = PatchRecovery.blockedShellWrite(ctx.sessionID, ctx.messageID, input.cwd, input.command)
        if (patchBypass) throw new Error(patchBypass)
        assertRetryBudget(ctx.sessionID, input.cwd, input.command)
        const bytes = Truncate.MAX_BYTES
        const lines = Truncate.MAX_LINES
        const keep = bytes * 2
        let full = ""
        let last = ""
        const list: Chunk[] = []
        let used = 0
        let file = ""
        let sink: ReturnType<typeof createWriteStream> | undefined
        let cut = false
        let expired = false
        let aborted = false
        let foregroundJobID: string | undefined
        let foregroundJobLogSequence = 0
        let pendingForegroundJobLog = ""

        const flushForegroundJobLog = () => {
          const jobID = foregroundJobID
          if (!jobID || !pendingForegroundJobLog) return
          const job = BackgroundJobPersistence.load(jobID)
          if (!job || job.status !== "running") return
          BackgroundJobPersistence.appendLog({
            jobID,
            sessionID: job.sessionID,
            seq: ++foregroundJobLogSequence,
            stream: "stdout",
            text: pendingForegroundJobLog,
          })
          pendingForegroundJobLog = ""
        }

        const flushForegroundJobLogIfNeeded = () => {
          if (pendingForegroundJobLog.length < 4096) return Effect.void
          return Effect.sync(flushForegroundJobLog).pipe(Effect.ignore)
        }

        yield* ctx.metadata({
          metadata: {
            output: "",
            description: input.description,
          },
        })

        const code: number | null = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(cmd(input.shell, input.name, input.command, input.cwd, input.env))
            foregroundJobID = Identifier.ascending("job")
            BackgroundJobPersistence.recordStart({
              id: foregroundJobID,
              sessionID: ctx.sessionID,
              kind: "shell",
              source: "shell",
              title: input.description,
              cwd: input.cwd,
              payload: {
                command: input.command,
                shell: input.shell,
                shellName: input.name,
              },
              env: Object.fromEntries(
                Object.entries(input.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
              ),
              ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
              ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
              metadata: { mode: "foreground" },
            })
            BackgroundJobPersistence.attachProcess({
              id: foregroundJobID,
              pid: Number(handle.pid),
            })

            yield* Effect.forkScoped(
              Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
                const safeChunk = Truncate.redact(chunk)
                const size = Buffer.byteLength(safeChunk, "utf-8")
                pendingForegroundJobLog += safeChunk
                list.push({ text: safeChunk, size })
                used += size
                while (used > keep && list.length > 1) {
                  const item = list.shift()
                  if (!item) break
                  used -= item.size
                  cut = true
                }

                last = preview(last + safeChunk)

                if (file) {
                  sink?.write(safeChunk)
                } else {
                  full += safeChunk
                  if (Buffer.byteLength(full, "utf-8") > bytes) {
                    return trunc.write(full).pipe(
                      Effect.andThen((next) =>
                        Effect.sync(() => {
                          file = next
                          cut = true
                          sink = createWriteStream(next, { flags: "a" })
                          full = ""
                        }),
                      ),
                      Effect.andThen(
                        ctx.metadata({
                          metadata: {
                            output: last,
                            description: input.description,
                          },
                        }),
                      ),
                      Effect.andThen(flushForegroundJobLogIfNeeded()),
                    )
                  }
                }

                return flushForegroundJobLogIfNeeded().pipe(
                  Effect.andThen(
                    ctx.metadata({
                      metadata: {
                        output: last,
                        description: input.description,
                      },
                    }),
                  ),
                )
              }),
            )

            const abort = Effect.callback<void>((resume) => {
              if (ctx.abort.aborted) return resume(Effect.void)
              const handler = () => resume(Effect.void)
              ctx.abort.addEventListener("abort", handler, { once: true })
              return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
            })

            const timeout = Effect.sleep(`${input.timeout + 100} millis`)

            const exit = yield* Effect.raceAll([
              handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
              abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
              timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
            ])

            if (exit.kind === "abort") {
              aborted = true
              yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
            }
            if (exit.kind === "timeout") {
              expired = true
              yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
            }

            return exit.kind === "exit" ? exit.code : null
          }),
        ).pipe(Effect.orDie)

        const meta: string[] = []
        if (expired) {
          meta.push(
            `terminal tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
          )
        }
        if (aborted) meta.push("User aborted the command")
        const raw = list.map((item) => item.text).join("")
        const end = tail(raw, lines, bytes)
        if (end.cut) cut = true
        if (!file && end.cut) {
          file = yield* trunc.write(raw)
        }

        let output = end.text
        if (!output) output = "(no output)"

        const outputRef = file ? Truncate.outputReference(file) : undefined
        if (cut && file && outputRef) {
          // Check if tail contains error patterns — if so, prepend head for context
          const tailScan = end.text.length > 2048 ? end.text.slice(-2048) : end.text
          const hasErrors = ERROR_PATTERN.test(tailScan)
          if (hasErrors) {
            let fileContent: string | undefined
            try {
              fileContent = readFileSync(file, "utf-8")
            } catch {
              fileContent = undefined
            }
            if (fileContent) {
              const headText = head(fileContent, HEAD_LINES, HEAD_BYTES)
              output = `...output truncated (head+tail shown due to errors)...\n\nFull output is available as ${outputRef}. Use tool_output with a bounded read or search.\n\n${headText}\n\n...middle omitted...\n\n${end.text}`
            } else {
              output = `...output truncated...\n\nFull output is available as ${outputRef}. Use tool_output with a bounded read or search.\n\n` + output
            }
          } else {
            output = `...output truncated...\n\nFull output is available as ${outputRef}. Use tool_output with a bounded read or search.\n\n` + output
          }
        }

        if (meta.length > 0) {
          output += "\n\n<bash_metadata>\n" + meta.join("\n") + "\n</bash_metadata>"
        }
        const errorKind = classifyShellFailure({ code, expired, aborted, output: raw })
        rememberCommandResult(ctx.sessionID, input.cwd, input.command, Boolean(errorKind && errorKind !== "aborted"))
        if (errorKind) output += `\n\n<bash_error_kind>${errorKind}</bash_error_kind>`
        if (foregroundJobID) {
          yield* Effect.sync(() => {
            const job = BackgroundJobPersistence.load(foregroundJobID!)
            if (!job || job.status !== "running") return
            flushForegroundJobLog()
            const status = aborted ? "cancelled" : expired || errorKind || code !== 0 ? "failed" : "completed"
            BackgroundJobPersistence.recordTerminal({
              id: job.id,
              status,
              ...(code === null ? {} : { exitCode: code }),
              ...(status === "failed"
                ? {
                    error: expired
                      ? `Shell command exceeded timeout ${input.timeout} ms.`
                      : errorKind
                        ? `Shell command failed: ${errorKind}.`
                        : "Shell command exited with a non-zero status.",
                  }
                : {}),
              pid: null,
            })
          }).pipe(Effect.ignore)
        }
        if (sink) {
          const stream = sink
          yield* Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                stream.end(() => resolve())
                stream.on("error", () => resolve())
              }),
          )
        }

        return {
          title: input.description,
          metadata: {
            output: last || preview(output),
            exit: code,
            description: input.description,
            truncated: cut,
            ...(errorKind ? { errorKind } : {}),
            ...(outputRef ? { outputRef } : {}),
          },
          output,
        }
      })

      return () =>
        Effect.sync(() => {
          const shell = Shell.acceptable()
          const name = Shell.name(shell)
          const shellContract =
            process.platform === "win32"
              ? legacy
                ? "On Windows, this legacy `bash` alias always runs PowerShell 7 (`pwsh`). Treat every invocation as a `pwsh` terminal. Do NOT rely on cmd.exe syntax, Git Bash syntax, or Windows PowerShell 5-only behavior."
                : "On Windows, this `shell` tool always runs PowerShell 7 (`pwsh`). Treat every invocation as a `pwsh` terminal. Do NOT rely on cmd.exe syntax, Git Bash syntax, or Windows PowerShell 5-only behavior."
              : "On macOS and Linux, this tool runs the current POSIX shell. Generate shell syntax that matches the reported shell."
          const shellQuickstart =
            process.platform === "win32"
              ? [
                  "PowerShell 7 quick reference:",
                  legacy
                    ? "- Treat this tool as `pwsh` even though the compatibility alias is `bash`."
                    : "- Treat this tool as `pwsh`.",
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
              : "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead."
          log.info("terminal tool using shell", { shell })

          return {
            description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
              .replaceAll("${os}", process.platform)
              .replaceAll("${shell}", name)
              .replaceAll("${shell_contract}", shellContract)
              .replaceAll("${shell_quickstart}", shellQuickstart)
              .replaceAll(
                "${tool_identity}",
                legacy
                  ? "This legacy compatibility alias still routes to the public `shell` tool. Prefer `shell` in new calls."
                  : "The public tool name is `shell`. Use it for all terminal operations.",
              )
              .replaceAll("${chaining}", chain)
              .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
              .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
            parameters: Parameters,
            execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
              Effect.gen(function* () {
                const execution = {
                  ...params,
                  background:
                    params.background ??
                    (!params.interactive && params.timeout === undefined && shouldRunInBackground(params.command)),
                }
                const prepared = yield* prepareShellExecution(execution, ctx).pipe(
                  Effect.provideService(ChildProcessSpawner, spawner),
                  Effect.provideService(AppFileSystem.Service, fs),
                  Effect.provideService(Plugin.Service, plugin),
                )

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

                if (execution.background) {
                  const runtime = shellBackgroundRuntimeRef.current
                  if (!runtime) {
                    throw new Error("Shell background runtime is not available in this process.")
                  }
                  const job = yield* runtime.start({
                    sessionID: ctx.sessionID,
                    title: params.description,
                    command: params.command,
                    cwd: prepared.cwd,
                    env: prepared.env as Record<string, string>,
                    shell: prepared.shell,
                    shellName: prepared.shellName,
                    source: "shell",
                    ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
                    ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
                  })
                  return {
                    title: params.description,
                    metadata: {
                      output: `Started background shell job ${job.id}`,
                      description: params.description,
                      exit: null,
                      truncated: false,
                      jobID: job.id,
                      status: job.status,
                    },
                    output: [
                      `Started durable background shell job.`,
                      `<job_id>${job.id}</job_id>`,
                      `<status>${job.status}</status>`,
                      `<cwd>${job.cwd}</cwd>`,
                      `<title>${job.title}</title>`,
                    ].join("\n"),
                  }
                }

                return yield* run(
                  {
                    shell: prepared.shell,
                    name: prepared.shellName,
                    command: params.command,
                    cwd: prepared.cwd,
                    env: prepared.env,
                    timeout: prepared.timeout,
                    description: params.description,
                  },
                  ctx,
                )
              }),
          }
        })
    }),
  )
}

export const ShellTool = defineShellTool("shell", false)
export const BashTool = defineShellTool("bash", true)
