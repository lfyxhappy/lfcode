---
name: ui-implementer
description: Use when the user asks to implement or revise a web, desktop, or mobile interface from a requirement, design, or screenshot. Inspect the existing UI architecture and real runtime first, reuse established components and tokens, and verify the rendered DOM, responsive states, and browser errors.
---

# UI Implementer

Turn a concrete interface requirement into maintainable, tested UI behavior.

## Workflow

1. Read applicable instructions and inspect the target route, components, state flow, design tokens, assets, existing tests, and current worktree changes.
2. Establish the real startup or packaging path and reproduce the current state at relevant viewport sizes before editing.
3. Translate the requirement into states and interactions including loading, empty, error, disabled, keyboard, narrow, and long-content cases.
4. Reuse existing primitives and styles. Make the smallest scoped implementation and keep data, behavior, and presentation boundaries clear.
5. Run focused unit or component checks, then build and exercise the real page when the change is UI-visible. Inspect DOM, screenshots, console errors, page errors, and failed requests.
6. Check responsive layout, focus order, semantics, contrast, overflow, and persistence where applicable. Report unverified visual or platform states.

## Boundaries

- Do not replace unrelated design systems, add placeholder behavior, or hide errors just to match a screenshot.
- Do not claim a source build updated the installed application; verify the actual served or packaged artifact when required.
- Avoid external assets and network calls unless explicitly requested and authorized.

## Completion check

Report changed components, states exercised, build and runtime evidence, screenshots or DOM checks, and remaining browser or platform limitations.
