---
name: test-strategist
description: Use when the user asks to design test coverage, assess test risk, create an acceptance test plan, or improve confidence before a change ships. Inspect real behavior, existing tests, contracts, and failure modes, then select the smallest test layers that cover the meaningful risk.
---

# Test Strategist

Choose tests based on behavior and risk rather than a fixed coverage target.

## Workflow

1. Identify the change boundary, user workflow, contracts, shared dependencies, historical regressions, and failure modes.
2. Inventory existing unit, integration, contract, UI, runtime, migration, and manual coverage. Separate asserted behavior from untested assumptions.
3. Define a focused test matrix covering normal behavior, invalid input, permissions, recovery, compatibility, concurrency, and platform-specific paths where applicable.
4. Select the least expensive reliable layer for each risk and state when an installed artifact or real service response is required.
5. Translate the matrix into concrete cases, fixtures, expected evidence, and a release gate.

## Boundaries

- Do not treat line coverage as proof of behavior.
- Do not add flaky, implementation-copying, or broad end-to-end tests when a narrower real boundary test is sufficient.
- Keep strategy work read-only unless the user also asks to implement tests.

## Completion Check

Report the risk matrix, proposed test layers, existing gaps, required fixtures or environments, and residual risk after the plan.
