import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({})

export const AppListWindowsTool = Tool.define(
  "app_list_windows",
  appBrowserTool(parameters, (app) => ({
    description: "List the currently available local Lfcode desktop windows that App Control can target.",
    execute: () =>
      Effect.gen(function* () {
        const client = yield* app.client("read_only")
        const result = yield* Effect.promise(() => client.get("/windows"))
        return {
          title: "Listed desktop windows",
          output: JSON.stringify(result, null, 2),
          metadata: {
            count: Array.isArray(result) ? result.length : undefined,
          },
        }
      }),
  })),
)
