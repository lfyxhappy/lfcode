---
name: flaky-test-triage
description: Use when a test passes and fails intermittently, behaves differently by order, machine, runtime, timing, or retry, or when the user asks to reduce test flakiness. Gather repeatable evidence, isolate nondeterminism, and repair the causal dependency without weakening test intent.
---

# Flaky Test Triage

Turn an intermittent failure into a bounded causal explanation and a durable repair.

## Workflow

1. Read repository instructions, the failing test, test history or logs, fixture lifecycle, relevant concurrency settings, and recent changes.
2. Record the exact failure signature, frequency, seed, order, platform, runtime version, resource use, and retry behavior. Separate distinct symptoms before treating them as one flake.
3. Repeat the narrowest test under controlled variations: isolation versus suite, changed order, fixed seed, constrained parallelism, clean versus warm state, and relevant platform or clock conditions.
4. Inspect asynchronous completion, shared state, cleanup, network and filesystem boundaries, random generation, time zones, timers, process lifetime, and test runner configuration.
5. Fix the causal synchronization, isolation, data ownership, or lifecycle defect. Add a regression test or deterministic harness only when it proves the repaired condition.
6. Rerun the focused test enough to validate the hypothesis, then run the affected suite with its normal concurrency settings.

## Boundaries

- Keep triage read-only unless the user asks to modify tests, infrastructure, or product code.
- Do not disable, skip, quarantine, retry indefinitely, lengthen arbitrary timeouts, or add sleeps as a substitute for a root-cause fix.
- Do not call a test flaky without evidence that distinguishes nondeterminism from a deterministic product regression.
- Redact credentials, customer data, and machine-specific sensitive information from logs and reports.

## Completion Check

Report the intermittent symptom, reproduction matrix, root cause or bounded hypothesis, repair, repetition evidence, suite result, and residual uncertainty.
