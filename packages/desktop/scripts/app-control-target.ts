import { homedir } from "node:os"
import { join } from "node:path"

export function resolveAppControlTarget(args: string[], env = process.env) {
  if (args[0] !== "--pre") return { args, env, channel: "default" as const }
  if (env.LFCODE_AUTOMATION_STATE_FILE) {
    throw new Error("--pre cannot be combined with LFCODE_AUTOMATION_STATE_FILE")
  }
  return {
    args: args.slice(1),
    env: { ...env, LFCODE_STATE_DIR: join(homedir(), ".lfcodepre", "state") },
    channel: "pre" as const,
  }
}
