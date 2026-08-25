import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const target = {
  ref: z.string().regex(/^r[a-z0-9]+$/i).optional().describe("Stable ref returned by a prior app_dom snapshot."),
  fingerprint: z.string().max(1_000).optional().describe("Fingerprint returned with the ref. It rejects stale targets."),
  selector: z.string().min(1).max(512).optional().describe("Optional CSS selector for a first lookup when no ref exists."),
}

const readWindow = z.number().optional().describe("Optional desktop window ID. Defaults to an available Lfcode window.")
const writeWindow = z.number().describe("Explicit desktop window ID for this write action. Read app_list_windows or a DOM snapshot first.")

const domAction = z.object({
  operation: z.literal("act"),
  action: z.enum(["click", "setText", "appendText", "toggle", "setChecked", "setExpanded", "setSelected", "select", "scroll"]),
  ...target,
  window_id: writeWindow,
  snapshot_id: z.string().min(1).max(256).optional().describe("Versioned snapshot ID returned by app_dom snapshot. Pass it with ref actions to reject stale UI."),
  text: z.string().optional().describe("Text for setText or appendText; also accepted as a select label."),
  value: z.string().optional().describe("Option value for select."),
  checked: z.boolean().optional().describe("Required target state when action=setChecked."),
  expanded: z.boolean().optional().describe("Required target state when action=setExpanded."),
  selected: z.boolean().optional().describe("Required target state when action=setSelected."),
  top: z.number().optional().describe("Absolute scroll top."),
  left: z.number().optional().describe("Absolute scroll left."),
  delta_x: z.number().optional().describe("Relative horizontal scroll amount."),
  delta_y: z.number().optional().describe("Relative vertical scroll amount."),
})

const parameters = z.union([
  z.object({
    operation: z.literal("snapshot"),
    selector: target.selector,
    region: z.string().min(1).max(512).optional().describe("Optional CSS region root. Pair with selector to page matching nodes inside that region."),
    offset: z.number().int().min(0).optional().describe("Zero-based snapshot page offset."),
    limit: z.number().int().min(1).max(500).optional().describe("Maximum nodes in this snapshot page, from 1 through 500."),
    window_id: readWindow,
  }),
  z.object({
    operation: z.literal("query"),
    selector: z.string().min(1).max(512).describe("CSS selector to inspect."),
    window_id: readWindow,
  }),
  domAction.extend({ action: z.enum(["click", "setText", "appendText", "toggle", "select", "scroll"]) }),
  domAction.extend({ action: z.literal("setChecked"), checked: z.boolean().describe("Target checked state.") }),
  domAction.extend({ action: z.literal("setExpanded"), expanded: z.boolean().describe("Target expanded state.") }),
  domAction.extend({ action: z.literal("setSelected"), selected: z.boolean().describe("Target selected state.") }),
  z.object({
    operation: z.literal("wait"),
    ...target,
    window_id: readWindow,
    visible: z.boolean().optional(),
    text: z.string().optional(),
    attribute_name: z.string().min(1).max(128).optional(),
    attribute_value: z.string().optional(),
    disabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    selected: z.boolean().optional(),
    timeout_ms: z.number().int().min(0).max(30_000).optional(),
    interval_ms: z.number().int().min(25).max(1_000).optional(),
  }),
])

export const AppDomTool = Tool.define(
  "app_dom",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Use the non-preemptive desktop DOM driver. Snapshot the visible UI, then act through a returned ref and fingerprint. It never injects mouse, keyboard, focus, or screen coordinates.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          const client = yield* Effect.promise(() => createAppControlClient())
          if (args.operation === "snapshot") {
            ensureAppControlAccess(current, "read_only")
            const result = yield* Effect.promise(() => client.get(snapshotPath(args)))
            return resultFor("Read desktop DOM snapshot", result, args)
          }
          if (args.operation === "query") {
            ensureAppControlAccess(current, "read_only")
            const result = yield* Effect.promise(() =>
              client.post("/dom/query", { windowID: args.window_id, selector: args.selector }),
            )
            return resultFor("Read desktop DOM node", result, args)
          }
          if (args.operation === "wait") {
            ensureAppControlAccess(current, "read_only")
            const result = yield* Effect.promise(() =>
              client.post("/dom/wait", {
                windowID: args.window_id,
                ref: args.ref,
                fingerprint: args.fingerprint,
                selector: args.selector,
                visible: args.visible,
                text: args.text,
                attribute:
                  args.attribute_name === undefined
                    ? undefined
                    : {
                        name: args.attribute_name,
                        value: args.attribute_value,
                      },
                disabled: args.disabled,
                checked: args.checked,
                selected: args.selected,
                timeoutMs: args.timeout_ms,
                intervalMs: args.interval_ms,
              }),
            )
            return resultFor("Waited for desktop DOM state", result, args)
          }
          if (args.action !== "scroll" && !args.ref && !args.selector) {
            throw new Error("A semantic DOM action requires ref or selector.")
          }
          ensureAppControlAccess(current, "full_app_control")
          const result = yield* Effect.promise(() =>
            client.post("/dom/act", {
              windowID: args.window_id,
              action: args.action,
              ref: args.ref,
              fingerprint: args.fingerprint,
              snapshotID: args.snapshot_id,
              selector: args.selector,
              text: args.text,
              value: args.value,
              checked: args.checked,
              expanded: args.expanded,
              selected: args.selected,
              top: args.top,
              left: args.left,
              deltaX: args.delta_x,
              deltaY: args.delta_y,
            }),
          )
          return resultFor(`Ran semantic DOM action ${args.action}`, result, args)
        }),
    }
  }),
)

function resultFor(title: string, result: unknown, args: z.infer<typeof parameters>) {
  return {
    title,
    output: JSON.stringify(result, null, 2),
    metadata: {
      operation: args.operation,
      windowID: args.window_id,
      ...(args.operation === "act" ? { action: args.action, ref: args.ref } : {}),
      ...(args.operation === "wait" ? { ref: args.ref } : {}),
    },
  }
}

function snapshotPath(args: Extract<z.infer<typeof parameters>, { operation: "snapshot" }>) {
  const query = new URLSearchParams()
  if (args.window_id !== undefined) query.set("windowID", String(args.window_id))
  if (args.selector !== undefined) query.set("selector", args.selector)
  if (args.region !== undefined) query.set("region", args.region)
  if (args.offset !== undefined) query.set("offset", String(args.offset))
  if (args.limit !== undefined) query.set("limit", String(args.limit))
  const search = query.toString()
  return `/dom/snapshot${search ? `?${search}` : ""}`
}
