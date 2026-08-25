import { expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { globalSkillRoot } from "../../src/skill/global-directory"
import { tmpdir } from "../fixture/fixture"

test("uses only the canonical managed global Skill root", async () => {
  await using tmp = await tmpdir()
  const home = Object.getOwnPropertyDescriptor(Global.Path, "home")
  Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })
  try {
    expect(globalSkillRoot()).toBe(path.join(tmp.path, ".lfcode", "skills"))
  } finally {
    Object.defineProperty(Global.Path, "home", home!)
  }
})

test("uses the explicit runtime configuration root for managed Skills", () => {
  const config = Object.getOwnPropertyDescriptor(Global.Path, "config")
  const original = process.env.LFCODE_CONFIG_DIR
  Object.defineProperty(Global.Path, "config", { configurable: true, value: "C:\\Users\\liangfeng\\.lfcodepre" })
  process.env.LFCODE_CONFIG_DIR = "C:\\Users\\liangfeng\\.lfcodepre"
  try {
    expect(globalSkillRoot()).toBe(path.join("C:\\Users\\liangfeng\\.lfcodepre", "skills"))
  } finally {
    Object.defineProperty(Global.Path, "config", config!)
    if (original === undefined) delete process.env.LFCODE_CONFIG_DIR
    else process.env.LFCODE_CONFIG_DIR = original
  }
})
