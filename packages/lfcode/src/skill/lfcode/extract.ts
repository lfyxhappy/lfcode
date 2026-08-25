import path from "path"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Path as GlobalPath } from "@/global"
import { InstallationVersion } from "@/installation/version"
import { Log } from "@/util"
import { loadLfcodeBundle } from "./bundle.macro" with { type: "macro" }
import { loadLfcodeBundle as loadLfcodeBundleDev } from "./bundle.macro"

function safeLoadLfcodeBundle() {
  try {
    return loadLfcodeBundle()
  } catch (e) {
    if (e instanceof ReferenceError) {
      return loadLfcodeBundleDev()
    }
    throw e
  }
}

const LFCODE_BUNDLE = safeLoadLfcodeBundle()
const BUNDLE_MARKER = JSON.stringify({
  format: 2,
  version: InstallationVersion,
  fingerprint: createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(LFCODE_BUNDLE)
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([skillName, files]) => [
            skillName,
            Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b)),
          ]),
      ),
    )
    .digest("hex"),
})
const log = Log.create({ service: "skill.lfcode" })

export const extractLfcodeBundle = Effect.fn("Skill.extractLfcodeBundle")(function* (
  fsys: AppFileSystem.Interface,
) {
  const root = path.join(GlobalPath.data, "lfcode-skills", InstallationVersion)
  const marker = path.join(root, ".extracted")

  const markerMatches = yield* fsys.readFileString(marker).pipe(
    Effect.map((value) => value === BUNDLE_MARKER),
    Effect.catch(() => Effect.succeed(false)),
  )
  if (markerMatches) return root

  for (const [skillName, files] of Object.entries(LFCODE_BUNDLE)) {
    const skillDir = path.join(root, "skills", skillName)
    for (const [relPath, content] of Object.entries(files)) {
      yield* fsys.writeWithDirs(path.join(skillDir, relPath), content)
    }
  }
  yield* fsys.writeWithDirs(marker, BUNDLE_MARKER)
  log.info("extracted lfcode skills", { root })
  return root
})
