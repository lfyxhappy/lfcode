---
name: unit-test-engineer
description: Use when the user asks to create, improve, review, or repair unit tests for a function, module, component, or isolated behavior. Derive observable contracts from real code, keep tests deterministic and focused, and use the repository's existing test runner and helpers.
---

# Unit Test Engineer

Test a small behavioral boundary without copying its implementation.

## Workflow

1. Read repository instructions, the target code, existing nearby tests, package scripts, and relevant recent changes.
2. State the observable contract: inputs, outputs, errors, side effects, state transitions, and important boundary values.
3. Select the narrowest public or stable internal seam. Reuse local test helpers and run the package-local test command before introducing a new pattern.
4. Write deterministic cases for normal behavior, invalid input, edge cases, and regression behavior that the code can actually exercise.
5. Isolate only nondeterministic or external boundaries. Prefer real values and small fakes over mocks that duplicate implementation details.
6. Run the focused test, inspect its assertions and cleanup, then expand to affected package checks when shared behavior changed.

## Boundaries

- Keep analysis and a test plan read-only unless the user asks to add or modify tests.
- Do not test private implementation details when callers cannot observe them.
- Do not weaken assertions, add arbitrary waits, suppress errors, or change production behavior solely to make a test pass.
- Do not use production data, credentials, or network calls in a unit test.

## Completion Check

Report the behavior covered, cases intentionally excluded, fixture or fake boundaries, changed files if any, and the exact verification commands with their result.
