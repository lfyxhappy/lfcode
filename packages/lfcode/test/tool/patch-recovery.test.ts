import { afterEach, expect, test } from "bun:test"
import path from "path"
import * as PatchRecovery from "../../src/tool/patch-recovery"

const sessionID = "ses_patch-recovery"
const messageID = "msg_patch-recovery"
const cwd = path.resolve("patch-recovery-fixture")
const target = path.join(cwd, "target.ts")

afterEach(() => {
  PatchRecovery.clear(sessionID, messageID, target)
})

test("blocks Python writes after structured patch recovery starts", () => {
  PatchRecovery.markContextFailure(sessionID, messageID, target)

  expect(
    PatchRecovery.blockedShellWrite(
      sessionID,
      messageID,
      cwd,
      'with open("target.ts", "w", encoding="utf-8") as file:\n    file.write("replacement")',
    ),
  ).toContain("Shell or Python writes are blocked")
})

test("does not block reads or unrelated targets", () => {
  PatchRecovery.markContextFailure(sessionID, messageID, target)

  expect(PatchRecovery.blockedShellWrite(sessionID, messageID, cwd, 'open("other.ts").read()')).toBeUndefined()
})
