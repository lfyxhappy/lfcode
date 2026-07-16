import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: z.object({
      tool: z.string(),
      error: z.string(),
    }),
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        output: params.error.includes("is not available in this turn")
          ? `The requested tool call could not run: ${params.error}`
          : `The arguments provided to the tool are invalid: ${params.error}`,
        metadata: {},
      }),
  }),
)
