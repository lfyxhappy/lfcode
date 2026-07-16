import whichPkg from "which"
import path from "path"
import { existsSync } from "node:fs"
import { Global } from "../global"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const direct = resolveBundledCommand(cmd, env)
  if (direct) return direct
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base ? base + path.delimiter + Global.Path.bin : Global.Path.bin
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}

function resolveBundledCommand(cmd: string, env?: NodeJS.ProcessEnv) {
  const normalized = path.basename(cmd).toLowerCase()
  const candidate =
    normalized === "git" || normalized === "git.exe"
      ? env?.LFCODE_GIT_PATH ?? process.env.LFCODE_GIT_PATH
      : normalized === "ssh" || normalized === "ssh.exe"
        ? env?.LFCODE_GIT_SSH_PATH ?? process.env.LFCODE_GIT_SSH_PATH
        : normalized === "less" || normalized === "less.exe"
          ? env?.LFCODE_GIT_LESS_PATH ?? process.env.LFCODE_GIT_LESS_PATH
          : undefined
  return candidate && existsSync(candidate) ? candidate : null
}
