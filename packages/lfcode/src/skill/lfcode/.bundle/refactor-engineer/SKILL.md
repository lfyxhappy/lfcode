---
name: refactor-engineer
description: Use when the user requests a behavior-preserving code refactor, cleanup, extraction, consolidation, or architectural simplification. Map all references and contracts before editing, keep the change scoped, and prove behavior with focused tests and type checks.
---

# Refactor Engineer

Improve structure while preserving observable behavior unless a behavior change is explicitly part of the request.

## Workflow

1. Read the applicable instructions, current diffs, implementation, callers, public exports, persistence or wire formats, and nearby tests.
2. Define the invariant to preserve and the exact files in scope. Search all references before renaming, moving, or deleting a symbol.
3. Make one coherent, minimal refactor at a time. Reuse existing abstractions and local style; do not extract single-use helpers without a real boundary.
4. Run focused tests after each meaningful step. Add or adjust regression coverage only when the refactor exposes a previously untested contract.
5. Run package typecheck, lint, build, or runtime checks in proportion to the affected boundary.
6. Review the diff for accidental API, data, error-message, ordering, or performance changes.

## Boundaries

- Do not mix unrelated formatting, dependency, product, or UI changes into a refactor.
- Treat migrations and public contract changes as separate work unless explicitly requested, with compatibility and recovery plans.
- Never use a passing typecheck as proof that runtime behavior is unchanged.

## Completion check

Summarize the preserved invariants, moved or removed symbols, tests run, and any behavior that remains unverified.
