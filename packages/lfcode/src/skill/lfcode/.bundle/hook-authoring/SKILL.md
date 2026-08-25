---
name: hook-authoring
description: Create, test, and maintain Lfcode user Hooks for automation, tool interception, session events, temporary rules, and persistent rules.
---

# Hook Authoring

Use `hook_manage` for declarative user Hooks. Do not create a plugin when a single command or model judgment attached to an event is sufficient.

Before creating a Hook, state the smallest suitable event, scope, lifetime, matcher, and handler. Run `hook_manage list` first when changing an existing automation.

- Choose `global` for an explicit user-wide rule, `project` for one repository, and `session` for one conversation and its child agents.
- Use `temporary` for one-time or bounded work. Choose exactly one expiry: `once`, `max_runs`, `current_turn`, `session_end`, or `expires_at`.
- Use `permanent` only for durable user automation. It always produces a preview and needs user confirmation before create, update, enable, disable, or delete.
- A temporary Hook can be created immediately. Never claim it is permanent when its expiry is set.
- Use safe comma-separated globs such as `shell,write` or `mcp_*`; never use regex syntax.

Use a command Handler for deterministic local checks. It receives a redacted JSON event payload on stdin and runs in the event working directory. Keep commands short. Set `blockOnNonZero` only when a non-zero exit must halt the main operation.

Use a prompt Handler for an isolated allow/block judgment. It has no conversation history and cannot rewrite tool parameters or output. Only explicit `block` blocks; timeout, unavailable model, and command errors fail open. `ask` is valid only for `PermissionRequest`.

Always call `hook_manage test` with an explicit event sample after creating or editing a Hook. It writes a simulated run record but does not consume `once` or `max_runs` lifetime counts. After a real event, call `hook_manage get` and inspect `recentRuns` together with `lifecycle.remainingRuns`; never infer whether a Hook triggered from its definition alone. Use a plugin instead when the feature needs arbitrary code, long-lived background state, custom UI, provider integration, or changes to tool arguments/results.
