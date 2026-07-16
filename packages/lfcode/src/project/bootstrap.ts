import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share"
import { Log } from "@/util"
import * as Effect from "effect/Effect"
import { Config } from "@/config"
import { Metrics } from "@/metrics"
import { Memory } from "@/memory"
import { WriterService, BackfillService } from "@/history"
import { Session } from "@/session"

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  // everything depends on config so eager load it for nice traces
  yield* Config.Service.use((svc) => svc.get())
  // Plugin can mutate config so it has to be initialized before anything else.
  yield* Plugin.Service.use((svc) => svc.init())
  yield* Effect.sync(() =>
    Session.clearOrphanAssistants({
      directory: Instance.directory,
      limit: 10_000,
      minAgeMs: 0,
      message: "Interrupted: previous request was stopped because Lfcode restarted",
    }),
  )
  yield* Effect.all(
    [
      LSP.Service,
      ShareNext.Service,
      Format.Service,
      File.Service,
      FileWatcher.Service,
      Vcs.Service,
      WriterService,
      BackfillService,
    ].map((s) => Effect.forkDetach(s.use((i) => i.init()))),
  ).pipe(Effect.withSpan("InstanceBootstrap.init"))

  // Warm the FTS index off the boot path. Off-tool writes between
  // process invocations are picked up here without blocking startup;
  // a missing memory dir or partial sync must not fail boot.
  yield* Memory.Service.use((svc) => svc.reconcile()).pipe(
    Effect.catch((err: unknown) =>
      Effect.sync(() => Log.Default.warn("memory reconcile failed", { error: String(err) })),
    ),
    Effect.forkDetach,
  )

  const projectID = Instance.project.id
  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name !== Command.Default.INIT) return
      Project.setInitialized(projectID)
    }),
  )

  yield* Metrics.subscribe()
}).pipe(Effect.withSpan("InstanceBootstrap"))
