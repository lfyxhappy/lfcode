import { Cause, Effect } from "effect"
import { Config } from "@/config"
import { Maintenance } from "@/maintenance"
import * as Session from "@/session/session"
import { Service as SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message-v2"
import { AUTO_DISTILL_TITLE, AUTO_DREAM_TITLE, DISTILL_TASK, DREAM_TASK, parseDistillCandidates } from "@/session/auto-dream"

export function execute(input: { run: Maintenance.MaintenanceRun; sessionID: string }) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt
    const config = yield* Config.Service
    const session = yield* sessions.get(input.sessionID as Session.Info["id"])
    const messages = yield* sessions.messages({ sessionID: session.id, agentID: "main" })
    const user = messages.findLast((message) => message.info.role === "user")?.info
    if (!user || user.role !== "user") throw new Error("Maintenance needs a prior user message to resolve a model")
    const settings = config.get().pipe(Effect.map((value) => value.maintenance))
    const maintenance = yield* settings
    const dreamEnabled = maintenance?.dream_enabled ?? true
    const distillEnabled = maintenance?.distill_enabled ?? true
    const model = { providerID: user.model.providerID, modelID: user.model.modelID }

    if (input.run.jobKind !== "distill" && dreamEnabled) {
      Maintenance.updateStage({ runID: input.run.id, stage: "dream", status: "running" })
      const dream = yield* sessions.create({ title: AUTO_DREAM_TITLE })
      yield* prompt.prompt({ sessionID: dream.id, agent: "dream", model, parts: [{ type: "text", text: DREAM_TASK }] })
      Maintenance.updateStage({ runID: input.run.id, stage: "dream", status: "completed" })
    }

    if (input.run.jobKind !== "dream" && distillEnabled) {
      Maintenance.updateStage({ runID: input.run.id, stage: "distill", status: "running" })
      const distill = yield* sessions.create({ title: AUTO_DISTILL_TITLE })
      const result = yield* prompt.prompt({
        sessionID: distill.id,
        agent: "distill",
        model,
        parts: [{ type: "text", text: DISTILL_TASK }],
      })
      const candidates = parseDistillCandidates(
        result.parts
          .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
          .map((part) => part.text)
          .join("\n"),
      ).map((candidate) => ({
        candidateKind: candidate.candidate_kind,
        targetKind: candidate.target_kind,
        targetPath: candidate.target_path,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        proposedSummary: candidate.proposed_summary,
        proposedPatchPreview: candidate.proposed_patch_preview,
      }))
      Maintenance.insertCandidates(input.run.id, candidates)
      Maintenance.updateStage({ runID: input.run.id, stage: "distill", status: "completed" })
    }

    Maintenance.complete({ runID: input.run.id, status: "completed", summary: "Dream and Distill maintenance completed." })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        Maintenance.fail(input.run.id, Cause.squash(cause))
      }),
    ),
  )
}
