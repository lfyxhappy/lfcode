import type { Actor } from "@lfcode-ai/console-core/actor.js"

declare module "solid-js/web" {
  interface RequestEvent {
    locals: Record<string | number | symbol, unknown> & {
      actor?: Promise<Actor.Info>
    }
  }
}
