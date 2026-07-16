import { existsSync } from "node:fs"

export function resolveGitCommand(env: NodeJS.ProcessEnv = process.env) {
  const bundled = env.LFCODE_GIT_PATH
  return bundled && existsSync(bundled) ? bundled : "git"
}
