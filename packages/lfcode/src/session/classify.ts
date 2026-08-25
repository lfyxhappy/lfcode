import { MessageV2 } from "./message-v2"
import { isRetryableToolValidationFailure } from "./part-helpers"

/**
 * Outcome of classifying a single assistant step. Pure data — `runLoop` decides
 * what side effect (nudge / retry / error / break) each category triggers.
 *
 * T00 establishes the categories; downstream tasks (T01–T05) attach distinct
 * behavior to `filtered` / `think-only` / `invalid` / `failed`. Until then
 * `runLoop` collapses every non-`continue` result to the existing break.
 */
export type StepClassification =
  | { type: "final"; degraded?: boolean }
  | { type: "continue" }
  | { type: "filtered" }
  | { type: "think-only" }
  | { type: "invalid"; reason: string }
  | { type: "failed"; reason: string }

/**
 * Single source of truth for "is this assistant step terminal, or should the
 * loop keep going?". Called from all three classification sites in `runLoop`
 * (existing-assistant top break, fork json_schema gate, main json_schema gate)
 * so a fix lands in one place instead of three.
 *
 * Pure: no Effect, no I/O, no mutation.
 *
 * Core guarantee (all downstream tasks depend on it): any finish reason plus a
 * pending non-`providerExecuted` client tool part ⇒ `continue`, with higher
 * priority than final/refusal text or any other category.
 */
export function classifyAssistantStep(input: {
  lastUser: MessageV2.User
  assistant: MessageV2.Assistant
  parts: MessageV2.Part[]
  phase: "existing-assistant" | "after-process"
  // Reserved for T01–T05 (stop/overflow control flow stays in runLoop for T00).
  processResult?: "continue" | "stop" | "overflow"
}): StepClassification {
  const assistant = input.assistant

  // 1. Core guarantee — beats everything: a pending client tool call must
  // re-loop so its observation is fed back to the model. EXCLUDE error-state
  // tool parts: cleanup after SSE timeout / abort marks pending tool parts
  // as state.status === "error". Those are NOT pending observation — they're
  // terminal failures. Without this guard, classify mis-routes errored steps
  // to "continue", runLoop re-enters and gets stranded on permission.ask
  // from the in-flight tool that won't ever resolve. See Spec ③.
  if (
    input.parts.some(
      (part) =>
        part.type === "tool" &&
        !part.metadata?.providerExecuted &&
        part.state.status !== "error",
    )
  )
    return { type: "continue" }

  // A terminal syntax guard is a completed observation, not an interrupted
  // execution. Feed it back to the model so it can rewrite the command.
  if (
    input.parts.some(
      (part) =>
        part.type === "tool" &&
        !part.metadata?.providerExecuted &&
        part.state.status === "error" &&
        isRetryableToolValidationFailure(part.state.error),
    )
  )
    return { type: "continue" }

  // 2. Errored step — checked before finish because some abnormal terminations
  // never emit a finish reason (for example a stream that dies before the
  // provider sends a completion event). Those must not be mis-routed to
  // `continue`.
  if (assistant.error) return { type: "failed", reason: assistant.error.name }

  // 3. Nothing finalized yet.
  if (!assistant.finish) return { type: "continue" }

  // 4. Stale assistant predating the current user turn — don't terminate on it.
  if (input.phase === "existing-assistant" && !(input.lastUser.id < assistant.id))
    return { type: "continue" }

  // 5. Already-resolved structured output / summary — terminal, never nudge-able.
  if (assistant.structured !== undefined) return { type: "final" }
  if (assistant.summary) return { type: "final" }

  // 6. Safety / error finish reasons.
  if (assistant.finish === "content-filter") return { type: "filtered" }
  if (assistant.finish === "error") return { type: "failed", reason: "model error finish" }

  // 7. Inspect completed provider-side tools like any other finished step. A
  // provider-executed tool has no local result to feed into another model turn;
  // only the pending client-tool check above may continue the loop.
  // An "other" finish that still produced usable text is a usable-but-abnormal
  // completion: surface it as `degraded` so runLoop can record it.
  if (
    input.parts.some(
      (part) => part.type === "text" && !part.synthetic && !part.ignored && part.text.trim().length > 0,
    )
  )
    return assistant.finish === "other" ? { type: "final", degraded: true } : { type: "final" }
  if (input.parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0))
    return { type: "think-only" }
  return { type: "invalid", reason: "empty output" }
}
