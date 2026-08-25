---
name: test-debugger
description: Use when a test fails, flakes, hangs, or gives an unexpected result. Reproduce the failure with the narrowest package-local command, distinguish test defects from product defects and environment issues, and only implement a fix when the user authorizes changes.
---

# Test Debugger

Diagnose failures from reproducible evidence and keep test intent intact.

## Workflow

1. Read repository instructions, package scripts, the failing test, its fixture setup, and recent relevant diffs.
2. Record the exact package, command, runtime, and failure output. Run the smallest reproducible test first, then repeat only when checking flakiness.
3. Classify the failure as assertion mismatch, setup/fixture problem, timing or concurrency issue, resource leak, dependency mismatch, or environment/tooling failure.
4. Trace the failing code path and inspect actual inputs, outputs, logs, and cleanup. Do not guess from a stack frame alone.
5. If a change is requested, make the smallest fix that preserves the test's behavioral contract. Add a regression case only when it captures a missing contract.
6. Rerun the focused test, then the affected package checks when shared code or interfaces changed.

## Boundaries

- Do not delete, weaken, skip, broaden, or rewrite a failing assertion merely to obtain a green run.
- Separate a diagnosis, a recommended fix, and an implemented fix in the report.
- Avoid flaky sleeps and mocks that hide the real failure. Redact secrets and machine-specific data from logs.

## Completion check

Report the reproduction command, root cause or bounded hypothesis, changed files if any, and every verification command that passed or remains unavailable.
