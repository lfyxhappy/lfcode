import { Hono, type Context, type MiddlewareHandler } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Effect } from "effect"
import fsNode from "fs/promises"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { GlobalBus } from "@/bus/global"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@/flag/flag"
import { AsyncQueue } from "@/util/queue"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { InstallationVersion } from "@/installation/version"
import { Log } from "../../util"
import { lazy } from "../../util/lazy"
import { Config } from "../../config"
import { ConfigProvider } from "../../config"
import { ProviderID } from "@/provider/schema"
import { errors } from "../error"
import { NamedError } from "@lfcode-ai/shared/util/error"
import { PlaywrightMcpRoutes } from "./global-playwright"
import { MaintenanceRoutes } from "./global-maintenance"
import { GlobalAutomationRoutes } from "./global-automation"
import { createAppControlClient } from "@/app-control/client"
import { Session } from "@/session"
import {
  getRuntimeManageState,
  activateRuntime,
  installRuntime,
  listRuntimeOperationLogs,
  repairRuntime,
  updateRuntime,
  RuntimeManageItemID,
  RuntimeOperationLogState,
  RuntimeManageMutationResult,
  RuntimeManageState,
} from "@/runtime-registry"

const log = Log.create({ service: "server" })

const AppControlEvent = z.object({
  id: z.number(),
  at: z.number(),
  timestamp: z.number(),
  isoTime: z.string(),
  scope: z.string(),
  type: z.string(),
  windowID: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

const AppControlMetadata = z.object({
  protocolVersion: z.number().int().positive(),
  instanceID: z.string(),
  pid: z.number().int().positive(),
  startedAt: z.number(),
  version: z.string(),
  capability: z.string(),
  features: z.array(z.string()),
})

const AppControlNextEvents = z.object({
  events: z.array(AppControlEvent),
  nextCursor: z.number().int().nonnegative(),
  oldestID: z.number().int().positive(),
  latestID: z.number().int().nonnegative(),
  resetRequired: z.boolean(),
})

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

async function streamEvents(c: Context, subscribe: (q: AsyncQueue<string | null>) => () => void) {
  return streamSSE(c, async (stream) => {
    const q = new AsyncQueue<string | null>()
    let done = false

    q.push(
      JSON.stringify({
        payload: {
          type: "server.connected",
          properties: {},
        },
      }),
    )

    // Send heartbeat every 10s to prevent stalled proxy streams.
    const heartbeat = setInterval(() => {
      q.push(
        JSON.stringify({
          payload: {
            type: "server.heartbeat",
            properties: {},
          },
        }),
      )
    }, 10_000)

    const stop = () => {
      if (done) return
      done = true
      clearInterval(heartbeat)
      unsub()
      q.push(null)
      log.info("global event disconnected")
    }

    const unsub = subscribe(q)

    stream.onAbort(stop)

    try {
      for await (const data of q) {
        if (data === null) return
        await stream.writeSSE({ data })
      }
    } finally {
      stop()
    }
  })
}

export const GlobalRoutes = lazy(() =>
  new Hono()
    .route("/", PlaywrightMcpRoutes())
    .route("/maintenance", MaintenanceRoutes())
    .use("/automation", desktopAutomationOnly)
    .use("/automation/*", desktopAutomationOnly)
    .route("/automation", GlobalAutomationRoutes())
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the Lfcode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: InstallationVersion })
      },
    )
    .get(
      "/app-control/meta",
      describeRoute({
        summary: "Get desktop app-control protocol metadata",
        description: "Read authenticated capability and protocol metadata from the running local desktop automation bridge.",
        operationId: "global.appControl.meta",
        responses: {
          200: {
            description: "Desktop automation protocol metadata",
            content: {
              "application/json": {
                schema: resolver(AppControlMetadata),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(
          await AppRuntime.runPromise(
            Config.Service.use(() =>
              Effect.promise(async () => {
                const client = await createAppControlClient()
                return client.getMetadata()
              }),
            ),
          ),
        )
      },
    )
    .get(
      "/app-control/events/next",
      describeRoute({
        summary: "Wait for the next desktop app-control events",
        description: "Read cursor-based desktop automation events without polling the full diagnostic history.",
        operationId: "global.appControl.eventsNext",
        responses: {
          200: {
            description: "Cursor-based desktop automation events",
            content: {
              "application/json": {
                schema: resolver(AppControlNextEvents),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          after: z.coerce.number().int().nonnegative().optional(),
          scope: z.enum(["main", "renderer", "server"]).optional(),
          type: z.string().optional(),
          limit: z.coerce.number().int().positive().max(200).optional(),
          waitMs: z.coerce.number().int().nonnegative().max(30_000).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          await AppRuntime.runPromise(
            Config.Service.use(() =>
              Effect.promise(async () => {
                const client = await createAppControlClient()
                const params = new URLSearchParams()
                if (query.after !== undefined) params.set("after", String(query.after))
                if (query.scope) params.set("scope", query.scope)
                if (query.type) params.set("type", query.type)
                if (query.limit) params.set("limit", String(query.limit))
                if (query.waitMs !== undefined) params.set("waitMs", String(query.waitMs))
                return client.get(`/diagnostics/events/next${params.size ? `?${params.toString()}` : ""}`)
              }),
            ),
          ),
        )
      },
    )
    .post(
      "/session/temporary/cleanup",
      describeRoute({
        summary: "Clean up temporary sessions",
        description: "Remove temporary desktop sessions and their associated data.",
        operationId: "global.session.temporary.cleanup",
        responses: {
          200: {
            description: "Temporary sessions removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ removed: z.number().int().nonnegative() })),
              },
            },
          },
          403: {
            description: "Only the local desktop server may clean up temporary sessions",
          },
        },
      }),
      async (c) => {
        if (Flag.LFCODE_CLIENT !== "desktop") return c.json({ error: "desktop only" }, 403)
        const removed = await AppRuntime.runPromise(Session.Service.use((service) => service.cleanupTemporary()))
        return c.json({ removed })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the Lfcode system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      project: z.string().optional(),
                      workspace: z.string().optional(),
                      payload: z.union([...BusEvent.payloads(), ...SyncEvent.payloads()]),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")

        return streamEvents(c, (q) => {
          async function handler(event: any) {
            q.push(JSON.stringify(event))
          }
          GlobalBus.on("event", handler)
          return () => GlobalBus.off("event", handler)
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global Lfcode configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.PublicInfo),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal().pipe(Effect.map(Config.withoutWorkflow)))))
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global Lfcode configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Patch),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Patch),
      async (c) => {
        const config = c.req.valid("json")
        const next = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.updateGlobal(config)))
        return c.json(next)
      },
    )
    .get(
      "/personalization",
      describeRoute({
        summary: "Get global personalization",
        description: "Retrieve managed global personalization settings and instruction content.",
        operationId: "global.personalization.get",
        responses: {
          200: {
            description: "Get global personalization info",
            content: {
              "application/json": {
                schema: resolver(Config.GlobalPersonalization),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobalPersonalization())))
      },
    )
    .put(
      "/personalization",
      describeRoute({
        summary: "Save global personalization",
        description: "Persist managed global personalization instructions and memory preferences.",
        operationId: "global.personalization.save",
        responses: {
          200: {
            description: "Saved global personalization info",
            content: {
              "application/json": {
                schema: resolver(Config.GlobalPersonalization),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.GlobalPersonalizationSave),
      async (c) => {
        const personalization = c.req.valid("json")
        const saved = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.saveGlobalPersonalization(personalization)))
        return c.json(saved)
      },
    )
    .get(
      "/runtime/manage",
      describeRoute({
        summary: "Get managed runtime status",
        description: "List locally detected runtimes and voice dependencies managed by the desktop app.",
        operationId: "global.runtime.manage",
        responses: {
          200: {
            description: "Runtime dependency status",
            content: {
              "application/json": {
                schema: resolver(RuntimeManageState),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Effect.promise(() => getRuntimeManageState())))
      },
    )
    .post(
      "/runtime/install",
      describeRoute({
        summary: "Install a managed runtime",
        description: "Install or initialize a managed runtime supported by Lfcode.",
        operationId: "global.runtime.install",
        responses: {
          200: {
            description: "Runtime installation result",
            content: {
              "application/json": {
                schema: resolver(RuntimeManageMutationResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          id: RuntimeManageItemID,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("json")
        return AppRuntime.runPromise(installRuntime(id))
          .then((result) => c.json(result))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            return c.json(new NamedError.Unknown({ message }).toObject(), 400)
          })
      },
    )
    .post(
      "/runtime/activate",
      describeRoute({
        summary: "Activate a runtime target",
        description: "Switch the active managed or system runtime target used by Lfcode for a given capability.",
        operationId: "global.runtime.activate",
        responses: {
          200: {
            description: "Runtime activation result",
            content: {
              "application/json": {
                schema: resolver(RuntimeManageMutationResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          id: RuntimeManageItemID,
          target: z.string().min(1),
        }),
      ),
      async (c) => {
        const { id, target } = c.req.valid("json")
        return AppRuntime.runPromise(activateRuntime(id, target))
          .then((result) => c.json(result))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            return c.json(new NamedError.Unknown({ message }).toObject(), 400)
          })
      },
    )
    .post(
      "/runtime/update",
      describeRoute({
        summary: "Update a managed runtime",
        description:
          "Check the official release and atomically update a managed runtime when a verified version is available.",
        operationId: "global.runtime.update",
        responses: {
          200: {
            description: "Runtime update result",
            content: {
              "application/json": {
                schema: resolver(RuntimeManageMutationResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          id: RuntimeManageItemID,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("json")
        return AppRuntime.runPromise(updateRuntime(id))
          .then((result) => c.json(result))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            return c.json(new NamedError.Unknown({ message }).toObject(), 400)
          })
      },
    )
    .post(
      "/runtime/repair",
      describeRoute({
        summary: "Repair a managed runtime",
        description: "Repair a managed runtime supported by Lfcode.",
        operationId: "global.runtime.repair",
        responses: {
          200: {
            description: "Runtime repair result",
            content: {
              "application/json": {
                schema: resolver(RuntimeManageMutationResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          id: RuntimeManageItemID,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("json")
        return AppRuntime.runPromise(repairRuntime(id))
          .then((result) => c.json(result))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            return c.json(new NamedError.Unknown({ message }).toObject(), 400)
          })
      },
    )
    .get(
      "/runtime/logs",
      describeRoute({
        summary: "Get recent managed runtime operation logs",
        description: "List recent install and repair results for locally managed runtimes.",
        operationId: "global.runtime.logs",
        responses: {
          200: {
            description: "Recent runtime logs",
            content: {
              "application/json": {
                schema: resolver(RuntimeOperationLogState),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().min(1).max(100).optional(),
          id: RuntimeManageItemID.optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await AppRuntime.runPromise(Effect.promise(() => listRuntimeOperationLogs(query))))
      },
    )
    .get(
      "/app-control/events",
      describeRoute({
        summary: "Get recent desktop app-control events",
        description:
          "Proxy recent desktop automation events from the running local desktop app for settings diagnostics.",
        operationId: "global.appControl.events",
        responses: {
          200: {
            description: "Recent desktop automation events",
            content: {
              "application/json": {
                schema: resolver(z.array(AppControlEvent)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          scope: z.enum(["main", "renderer", "server"]).optional(),
          type: z.string().optional(),
          limit: z.coerce.number().int().positive().max(500).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          await AppRuntime.runPromise(
            Config.Service.use(() =>
              Effect.promise(async () => {
                const client = await createAppControlClient()
                const params = new URLSearchParams()
                if (query.scope) params.set("scope", query.scope)
                if (query.type) params.set("type", query.type)
                if (query.limit) params.set("limit", String(query.limit))
                return client.get(`/diagnostics/events${params.size ? `?${params.toString()}` : ""}`)
              }),
            ),
          ),
        )
      },
    )
    .post(
      "/app-control/diagnostics-bundle",
      describeRoute({
        summary: "Capture a desktop diagnostics bundle",
        description:
          "Proxy a compact desktop diagnostics bundle from the running local desktop app, including ui-state, recent events, and a screenshot.",
        operationId: "global.appControl.diagnosticsBundle",
        responses: {
          200: {
            description: "Desktop diagnostics bundle",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    state: z.unknown(),
                    events: z.unknown(),
                    capture: z.unknown(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          windowID: z.number().optional(),
          eventLimit: z.number().int().positive().max(500).optional(),
          label: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")
        return c.json(
          await AppRuntime.runPromise(
            Config.Service.use(() =>
              Effect.promise(async () => {
                const client = await createAppControlClient()
                const state = await client.get(
                  `/diagnostics/ui-state${input.windowID ? `?windowID=${input.windowID}` : ""}`,
                )
                const params = new URLSearchParams()
                if (input.eventLimit) params.set("limit", String(input.eventLimit))
                const events = await client.get(`/diagnostics/events${params.size ? `?${params.toString()}` : ""}`)
                const capture = await client.post("/capture/window", {
                  windowID: input.windowID,
                  label: input.label ?? "app-control-settings",
                })
                return {
                  state,
                  events,
                  capture,
                }
              }),
            ),
          ),
        )
      },
    )
    .post(
      "/app-control/diagnostics-bundle/export",
      describeRoute({
        summary: "Export a desktop diagnostics bundle",
        description:
          "Capture a desktop diagnostics bundle from the running local desktop app and save it as a JSON file on this machine.",
        operationId: "global.appControl.exportDiagnosticsBundle",
        responses: {
          200: {
            description: "Exported desktop diagnostics bundle",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string(),
                    capturePath: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string().min(1),
          windowID: z.number().optional(),
          eventLimit: z.number().int().positive().max(500).optional(),
          label: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")
        return c.json(
          await AppRuntime.runPromise(
            Config.Service.use(() =>
              Effect.promise(async () => {
                const client = await createAppControlClient()
                const state = await client.get(
                  `/diagnostics/ui-state${input.windowID ? `?windowID=${input.windowID}` : ""}`,
                )
                const params = new URLSearchParams()
                if (input.eventLimit) params.set("limit", String(input.eventLimit))
                const events = await client.get(`/diagnostics/events${params.size ? `?${params.toString()}` : ""}`)
                const capture = await client.post("/capture/window", {
                  windowID: input.windowID,
                  label: input.label ?? "app-control-settings",
                })
                await fsNode.writeFile(
                  input.path,
                  JSON.stringify(
                    {
                      exportedAt: Date.now(),
                      state,
                      events,
                      capture,
                    },
                    null,
                    2,
                  ),
                  "utf8",
                )
                return {
                  path: input.path,
                  capturePath:
                    typeof capture === "object" && capture && "path" in capture
                      ? (capture as { path?: string }).path
                      : undefined,
                }
              }),
            ),
          ),
        )
      },
    )
    .get(
      "/app-control",
      describeRoute({
        summary: "Get global app control settings",
        description: "Retrieve host-level app-control settings and current desktop automation discovery status.",
        operationId: "global.appControl.get",
        responses: {
          200: {
            description: "Get global app control info",
            content: {
              "application/json": {
                schema: resolver(Config.GlobalAppControl),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobalAppControl())))
      },
    )
    .put(
      "/app-control",
      describeRoute({
        summary: "Save global app control settings",
        description: "Persist host-level app-control settings for the desktop app.",
        operationId: "global.appControl.save",
        responses: {
          200: {
            description: "Saved global app control info",
            content: {
              "application/json": {
                schema: resolver(Config.GlobalAppControl),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.GlobalAppControlSave),
      async (c) => {
        const appControl = c.req.valid("json")
        return c.json(await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.saveGlobalAppControl(appControl))))
      },
    )
    .delete(
      "/config/custom-provider/:providerID",
      describeRoute({
        summary: "Remove custom provider",
        description: "Delete a custom global provider configuration and its stored authentication.",
        operationId: "global.config.removeCustomProvider",
        responses: {
          200: {
            description: "Successfully removed custom provider",
            content: {
              "application/json": {
                schema: resolver(Config.PublicInfo),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod,
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        return AppRuntime.runPromise(Config.Service.use((cfg) => cfg.removeGlobalCustomProvider(providerID)))
          .then((next) => c.json(Config.withoutWorkflow(next)))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            if (
              message === `Provider ${providerID} is not configured in global config files` ||
              message === `Provider ${providerID} is not a custom provider` ||
              message.startsWith("A6API configuration")
            ) {
              return c.json(new NamedError.Unknown({ message }).toObject(), 400)
            }
            throw err
          })
      },
    )
    .put(
      "/config/custom-provider/:providerID",
      describeRoute({
        summary: "Save custom provider",
        description: "Create or update a custom global provider configuration and optional stored authentication.",
        operationId: "global.config.upsertCustomProvider",
        responses: {
          200: {
            description: "Successfully saved custom provider",
            content: {
              "application/json": {
                schema: resolver(Config.PublicInfo),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          provider: ConfigProvider.Info.zod,
          key: z.string().optional(),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { provider, key } = c.req.valid("json")
        return AppRuntime.runPromise(
          Config.Service.use((cfg) => cfg.upsertGlobalCustomProvider(providerID, provider, key)),
        )
          .then((next) => c.json(Config.withoutWorkflow(next)))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            if (
              message === `Provider ${providerID} is not configured in global config files` ||
              message === `Provider ${providerID} is not a custom provider`
            ) {
              return c.json(new NamedError.Unknown({ message }).toObject(), 400)
            }
            throw err
          })
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all Lfcode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .post(
      "/upgrade",
      describeRoute({
        summary: "Upgrade lfcode",
        description: "Upgrade lfcode to the specified version or latest if not specified.",
        operationId: "global.upgrade",
        responses: {
          200: {
            description: "Upgrade result",
            content: {
              "application/json": {
                schema: resolver(
                  z.union([
                    z.object({
                      success: z.literal(true),
                      version: z.string(),
                    }),
                    z.object({
                      success: z.literal(false),
                      error: z.string(),
                    }),
                  ]),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          target: z.string().optional(),
        }),
      ),
      async (c) => {
        const result = await AppRuntime.runPromise(
          Installation.Service.use((svc) =>
            Effect.gen(function* () {
              const method = yield* svc.method()
              if (method === "unknown") {
                return { success: false as const, status: 400 as const, error: "Unknown installation method" }
              }

              const target = c.req.valid("json").target || (yield* svc.latest(method))
              const result = yield* Effect.catch(
                svc.upgrade(method, target).pipe(Effect.as({ success: true as const, version: target })),
                (err) =>
                  Effect.succeed({
                    success: false as const,
                    status: 500 as const,
                    error: err instanceof Error ? err.message : String(err),
                  }),
              )
              if (!result.success) return result
              return { ...result, status: 200 as const }
            }),
          ),
        )
        if (!result.success) {
          return c.json({ success: false, error: result.error }, result.status)
        }
        const target = result.version
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Installation.Event.Updated.type,
            properties: { version: target },
          },
        })
        return c.json({ success: true, version: target })
      },
    ),
)

const desktopAutomationOnly: MiddlewareHandler = async (c, next) => {
  if (Flag.LFCODE_CLIENT !== "desktop" || Flag.LFCODE_WORKSPACE_ID) return c.json({ error: "desktop only" }, 403)
  return await next()
}
