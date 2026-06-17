import { AgentV2 } from "@lfcode-ai/core/agent"
import { PluginBoot } from "@lfcode-ai/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../groups/location"

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers.handle("agent.list", () =>
    Effect.gen(function* () {
      yield* PluginBoot.Service.use((plugin) => plugin.wait())
      return yield* response(AgentV2.Service.use((agent) => agent.all()))
    }),
  ),
)
