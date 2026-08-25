- To regenerate the JavaScript SDK, run `bun run --cwd packages/sdk/js build`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Treat `.codex/*.md` plans as execution-tracking documents, not just notes: before starting plan-scoped work, read the referenced plan and respect its current `Status:`.
- If the user asks for a plan first, or the task is being tracked in `.codex/`, create or update the relevant plan file before implementation starts and give it an explicit `Status:`.
- Keep the plan lifecycle synchronized with reality: use `planned`/`pending` before execution, switch to `in_progress` once implementation actually starts, and leave it non-completed if work is only partially done or verification is still missing.
- When implementing a task from a plan under `.codex/`, update that plan in the same change flow: adjust scope/details if they changed, record any remaining gaps, and mark the plan's `Status:` as `completed` only after the task is fully implemented and verified.
- When a `.codex/` plan is completed and its changes affect the desktop app, runtime, settings, MCP/tools, or other behavior the user is expected to test locally, finish the same flow with the pre-release package/sync lane below; do not touch the production use-copy unless the user explicitly asks to “同步到使用版” or “更新使用版”.
- Keep `.codex/*.md` reserved for plans and execution tracking. Store standalone HTML design mockups, visual replicas, and reviewable static UI drafts under `.codex/design-html/` instead of `output/` or scattered temp locations.
- When creating a design draft in `.codex/design-html/`, prefer a self-contained `.html` file with inline CSS/assets when practical so it can be opened and reviewed directly without extra build steps.

## Project Structure

- This repo is a Bun workspace monorepo rooted at `package.json`.
- Most product code lives under `packages/`.
- The core runtime and session engine live in `packages/lfcode`.
- The web UI lives in `packages/app`, and the Electron host lives in `packages/desktop`.
- Shared packages such as `packages/core`, `packages/ui`, `packages/plugin`, `packages/sdk/js`, `packages/shared`, and `packages/script` support the app/runtime layers.
- Cross-repo specs live in `specs/`.
- User-local project config and content under the repo root belong in `.lfcode/` (`agent/`, `command/`, `skills/`, `themes/`, `plugins/`, `tool/`, `glossary/`, plus `opencode.jsonc` and `tui.json`).
- App settings surfaces now include `packages/app/src/components/settings-skills.tsx` and `packages/app/src/components/settings-archives.tsx`; skill-management and archive changes should be validated through those settings views, not only through server routes.
- Instance-side skill APIs live under `packages/lfcode/src/server/routes/instance/skills.ts`; when changing local skill import, discovery, hiding, or deletion flows, keep the app settings UI and this route in sync.

## Issue Records

- Keep repository issue investigations and recommended solutions under `issue/`.
- Use one Markdown file for one problem. Each file must contain `问题`, `原因`, `推荐解决方案`, and `状态` sections.
- Allowed status values are `未解决`, `解决中`, and `已解决`. Update the status only when code or runtime verification supports the change.
- Issue records describe findings and solution direction; they are not execution plans. Use `.codex/*.md` for implementation tracking when a task becomes plan-scoped.
- Include concrete source paths in issue records when the finding is grounded in repository code. Do not include secrets, tokens, cookies, or full sensitive command output.

## Build and Test

- Package management is pinned to Bun (`packageManager: bun@1.3.11`); use Bun scripts rather than npm or yarn.
- Use Bun workspace commands from the repo root unless a section below says otherwise.
- Main dev entrypoints are `bun run dev`, `bun run dev:web`, and `bun run dev:desktop`. Root `bun run dev` sets `LFCODE_HOME=$PWD/.dev-home` and launches `packages/lfcode` with `--conditions=browser`.
- Root validation commands are `bun run lint` and `bun run typecheck`; today those resolve to `oxlint` and `bun turbo typecheck`.
- The root `bun run test` command is a guard that intentionally fails; run tests from package directories instead.
- From `packages/lfcode`, run targeted tests with `bun test path/to/test.ts` or the package suite with `bun test --timeout 30000`.
- From `packages/app`, run unit tests with `bun run test:unit`.
- Do not run `bun run test:e2e`, `bunx playwright test`, or any isolated source/Electron E2E suite. For all desktop or UI automation, first package and sync the current build to `C:\算法\小应用\Lfcodepre`, then drive only the running pre-release copy through `bun run app:control` or its installed automation bridge. Do not treat a source dev server or temporary sandbox as product verification.
- All desktop/UI automation must explicitly target the pre-release lane: use `bun run app:control --pre ...` and the `C:\Users\liangfeng\.lfcodepre` automation state. A bare `bun run app:control ...`, default automation discovery, or any command that may target `C:\算法\小应用\Lfcode` / `C:\Users\liangfeng\.lfcode` is prohibited unless the user explicitly authorizes operating the production use-copy in the current request.
- `packages/app` uses `happydom.ts` for unit tests; when adding narrow UI helpers, prefer package-local `bun test --preload ./happydom.ts ./src/...` over root-level test commands.
- After completing changes in this repo, default to the fast pre-release Windows packaging path: run `bun ./scripts/package-win-pre-fast.ts` from `packages/desktop` unless the user explicitly asks for the full slow package flow or explicitly targets the production use-copy.
- When a task includes pushing changes to GitHub, treat the push as release-facing work by default: update the GitHub release for that pushed version in the same flow, attach the Windows installer produced by `packages/desktop/dist/lfcode-win-x64.exe`, and include a concise release summary. Do not stop at `git push` unless the user explicitly says to skip the release update.
- For desktop/runtime changes that the user will test in the local installed copy, do the development checks, then default to the pre-release fast sync flow from `packages/desktop`: `bun ./scripts/sync-win-pre.ts`; do not stop at dev-server validation. Close the pre-release copy before syncing because running Electron files are locked.
- Unless the user explicitly says not to, treat verified desktop/runtime changes as pre-release sync-followed work by default: after code changes land, stop only `C:\算法\小应用\Lfcodepre\LfcodePre.exe`, run `sync-win-pre.ts`, and relaunch the pre-release copy. Never stop or sync `C:\算法\小应用\Lfcode\Lfcode.exe` without an explicit “同步到使用版” or “更新使用版” instruction.
- For desktop app testing/debugging, default to the pre-release installed-copy workflow instead of lingering in source `dev` mode: build or use the latest packaged output, sync to `C:\算法\小应用\Lfcodepre`, launch `C:\算法\小应用\Lfcodepre\LfcodePre.exe`, and reproduce/debug there unless the user explicitly asks for source-mode or CI-only verification.
- Every desktop-app launch or relaunch must result in a visible, foregrounded main window. A background process without a visible application window does not count as a successful launch.
- Code that can execute in Electron main/renderer processes or an installed desktop runtime must not use Bun-only globals or APIs such as `Bun.file`, even if source-mode Bun tests pass. Use Node-compatible APIs and verify through the packaged pre-release copy.
- Unless the user explicitly narrows the scope, apply the same fast pre-release package-sync-relaunch rule when closing out a completed `.codex/` plan whose result is user-testable locally; “plan 完成” itself should be treated as a pre-release sync trigger for this repo.
- When the user explicitly asks to sync the installed-use copy, default to the fast flow: stop `C:\算法\小应用\Lfcode\Lfcode.exe`, run `sync:win-use-copy:fast`, then relaunch the synced copy. If Windows leaves `Lfcode.exe` in `Status=Unknown` or `sync:win-use-copy` fails with `EACCES` on `resources\app.asar.unpacked`, treat it as a local OS-level stuck-process/lock condition and restart Explorer or Windows before retrying.
- `bun run package:win` round-trips the current Windows runtime entries listed in `packages/desktop/scripts/preserve-win-runtime.ts`: `cache`, `data`, `state`, `config.json`, `lfcode.json`, `lfcode.jsonc`, and `opencode.jsonc`. Keep new persistent runtime data under those preserved entries, or update the preserve/restore scripts before relying on packaging.
- Packaged Windows root config is preserved through `packages/desktop/local-config/lfcode.jsonc`; `packages/desktop/scripts/sync-local-config.ts` refreshes that template from the current `dist/win-unpacked/lfcode.jsonc`, and `packages/desktop/electron-builder.config.ts` copies it back into the packaged app root via `extraFiles`.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

Follow `.github/pull_request_template.md` when opening a PR, especially the local verification and UI screenshot/recording sections.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@lfcode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/lfcode`.

## Type Checking

- Run package-local type checks with `bun run typecheck`; never invoke `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash activity recovery requires a separate explicit design before it may retry provider work.
- Keep delivery vocabulary explicit. Prompts steer by default and coalesce into the active activity at the next safe provider-turn boundary. Explicit `queue` inputs open FIFO future activities one at a time after the active activity settles.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## Local Windows Desktop Release Lanes

- The production use-copy is `C:\算法\小应用\Lfcode`; never stop, sync, overwrite, or relaunch it during ordinary development or ordinary “同步” requests.
- The pre-release/test use-copy is `C:\算法\小应用\Lfcodepre`. After a verified Windows build, ordinary “同步” means package and sync this pre-release copy only. Use `packages/desktop/scripts/package-win-pre-fast.ts` followed by `packages/desktop/scripts/sync-win-pre.ts`.
- Update the production copy only when the user explicitly asks to “同步到使用版” or “更新使用版”. Before doing so, stop the running use-copy, use the verified `Lfcodepre` payload as the source, merge `C:\Users\liangfeng\.lfcodepre` into `C:\Users\liangfeng\.lfcode` with target-missing-only semantics, and then relaunch `C:\算法\小应用\Lfcode\Lfcode.exe`. Never overwrite or delete an existing use-copy data entry, especially its database, chats, attachments, snapshots, tool output, or logs.
- The pre-release data root is `C:\Users\liangfeng\.lfcodepre`; the production use-copy data root is `C:\Users\liangfeng\.lfcode`. Keep the roots separate.
- When explicitly promoting data from pre to the production use-copy, use a one-way additive migration: copy only entries missing from `C:\Users\liangfeng\.lfcode`; never overwrite or delete existing production data. Production chat history, session databases, attachments, snapshots, tool output, and logs are always preserved.
- Run one copy at a time while packaging, synchronizing, or switching lanes.
- The pre-release package uses the blue outer-ring icon from `packages/desktop/icons/dev`; the production package keeps the normal production icon. Keep the two icon lanes distinct.
- These local release-lane rules take precedence over the generic installed-use-copy target examples above: routine desktop verification targets `Lfcodepre`, while `Lfcode` is an explicit promotion target only.
