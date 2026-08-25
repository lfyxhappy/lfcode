---
name: feature-engineer
description: Use when the user asks to implement or modify an application feature end to end. Inspect the current behavior, repository rules, contracts, and tests before editing; keep changes scoped, preserve existing work, and validate the real user-facing or runtime path after implementation.
---

# Feature Engineer

Implement a complete, reviewable feature change with evidence that the intended path works.

## Workflow

1. Confirm the requested behavior, target users, affected boundaries, and whether a tracked plan already exists.
2. Inspect current source, configuration, tests, runtime entrypoints, and working-tree changes before editing.
3. Implement the smallest cohesive change across interfaces, persistence, UI, and documentation only where the feature requires it.
4. Add or update focused tests at the changed boundary. Run typechecks, builds, and real runtime or UI checks in proportion to the blast radius.
5. Inspect the produced artifact, response, or installed application when the feature is user-facing; source compilation alone is not sufficient evidence.

## Boundaries

- Do not silently broaden a feature into a refactor, migration, release, or external integration.
- Preserve unrelated user edits and do not use destructive Git or filesystem operations without explicit authorization.
- Do not claim a feature is verified if only static checks ran and the relevant runtime path was not exercised.

## Completion Check

Report behavior changed, key files, validation evidence, release or sync state, and any remaining untested path.
