import path from "path"
import { Global } from "@/global"

export function globalSkillRoot() {
  if (process.env.LFCODE_CONFIG_DIR) return path.join(Global.Path.config, "skills")
  if (process.env.LFCODE_HOME) return path.join(Global.Path.home, "skills")
  return path.join(Global.Path.home, ".lfcode", "skills")
}
