---
name: implementation-planner
description: Use when the user asks to plan a feature, fix, migration, refactor, or technical project before coding. Read the repository's planning rules and current code first, split work into verifiable steps with dependencies and ownership, and preserve uncertainty instead of fabricating implementation details.
---

# Implementation Planner

Produce an execution plan that follows the existing repository rather than a generic checklist.

## Workflow

1. Read applicable repository instructions, current plan documents, branch status, and relevant diffs before defining work.
2. Trace the affected behavior through source, contracts, storage, tests, packaging, and runtime entrypoints.
3. Define the target state, scope exclusions, dependencies, risks, and decisions that must precede implementation.
4. Break the work into ordered, independently verifiable steps. Name expected files or modules, validation commands, and release or migration actions where known.
5. Keep the plan status synchronized with actual execution and record remaining gaps rather than marking work complete early.

## Boundaries

- Treat a request for a plan as read-only unless implementation is also explicitly requested.
- Do not prescribe generated files, destructive migrations, releases, or external actions without confirming their repository-specific path and authorization.
- Preserve existing user changes and existing plans; update only the plan that owns the requested work.

## Completion Check

Report the plan location, target state, sequence, verification strategy, dependencies, and unresolved choices.
