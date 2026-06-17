/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { Effect } from "effect"
import { PluginV2 } from "../plugin"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeLfcodeContent from "./skill/customize-lfcode.md" with { type: "text" }

export const CustomizeLfcodeContent = customizeLfcodeContent

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("skill"),
  effect: Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    const transform = yield* skill.transform()

    yield* transform((editor) => {
      editor.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "customize-lfcode",
            description:
              "Use ONLY when the user is editing or creating lfcode's own configuration: lfcode.json, lfcode.jsonc, files under .lfcode/, or files under ~/.config/lfcode/. Also use when creating or fixing lfcode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring lfcode itself.",
            location: AbsolutePath.make("/builtin/customize-lfcode.md"),
            content: CustomizeLfcodeContent,
          }),
        }),
      )
    })
  }),
})
