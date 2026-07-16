import { Effect } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

const REASON_LIMIT = 1024

function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `... (${reason.length - REASON_LIMIT} more chars)`
}

export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@lfcode/HttpApiSchemaError",
  { error: InvalidRequestError },
) {}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error) => {
  const reason = truncateReason(error.message)
  return Effect.logWarning("schema rejection").pipe(
    Effect.annotateLogs({ kind: error._tag, reason }),
    Effect.andThen(Effect.fail(new InvalidRequestError({ message: reason, kind: error._tag }))),
  )
})
