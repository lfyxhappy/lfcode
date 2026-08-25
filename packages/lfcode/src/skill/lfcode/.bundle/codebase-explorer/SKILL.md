---
name: codebase-explorer
description: Use when the user asks to understand, map, trace, or locate behavior in an unfamiliar repository. Inspect the actual code, configuration, runtime entrypoints, and tests before proposing changes; stay read-only unless a change is explicitly requested, and report evidence and remaining uncertainty.
---

# Codebase Explorer

Build an evidence-based map of the repository before drawing conclusions.

## Workflow

1. Establish the repository root, applicable `AGENTS.md` files, package boundaries, and the user's requested scope.
2. Check `git status`, the current branch, and relevant diffs. Preserve unrelated user changes.
3. Inventory files with `rg --files`, then inspect manifests, entrypoints, configuration, scripts, and the tests closest to the behavior.
4. Trace the requested symbol or data through callers, persistence, APIs, and runtime consumers with `rg`. Follow the real execution path instead of relying on names alone.
5. When runtime behavior matters, run the smallest safe diagnostic or inspect the actual response, logs, or generated artifact.
6. Report concrete file paths and line locations, separating confirmed facts, likely inferences, and unanswered questions.

## Boundaries

- Treat an exploration request as read-only. Do not edit files, install dependencies, commit, push, or contact external services unless the user explicitly asks.
- Do not infer that a source change is deployed or that a build artifact is current without checking the process, path, timestamp, or response that uses it.
- Avoid dumping credentials, cookies, tokens, personal data, or unredacted request bodies into notes or the final report.

## Completion check

End with the discovered entrypoints, important dependencies, relevant tests, and the narrowest next action. State what was not verified.
