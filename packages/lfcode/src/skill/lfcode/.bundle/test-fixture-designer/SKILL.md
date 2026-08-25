---
name: test-fixture-designer
description: Use when the user asks to design, create, simplify, repair, or review test fixtures, factories, builders, seeded datasets, temporary files, or test environment setup. Produce minimal, explicit, isolated data that makes tests readable, deterministic, and safe to clean up.
---

# Test Fixture Designer

Create test data and environments that reveal behavior instead of hiding it.

## Workflow

1. Read repository instructions, test framework conventions, target behavior, schemas, existing fixtures, and cleanup helpers.
2. Identify the smallest valid data shape, defaults that matter, invalid variants, ownership boundaries, and the relationship between fixture data and assertions.
3. Prefer named builders or factories when variation is recurring; keep a literal fixture inline when it is clearer and single-use.
4. Make important values explicit, allow each test to override only the values it needs, and avoid opaque random data unless a seed is recorded.
5. Use isolated temporary resources and deterministic identifiers. Ensure teardown removes only resources created by that test and remains safe after partial setup.
6. Run the focused test repeatedly when lifecycle or isolation is at risk, then inspect for data leakage, order dependence, and hidden shared state.

## Boundaries

- Keep fixture review and design read-only unless the user asks to modify tests or test infrastructure.
- Do not copy production records, credentials, personal data, or large unreviewed dumps into fixtures.
- Do not make fixtures so broad that unrelated changes silently pass assertions.
- Do not delete shared files, databases, queues, or cloud resources during cleanup without explicit authorization and verified ownership.

## Completion Check

Report fixture ownership, override points, isolation and cleanup behavior, data intentionally omitted, verification commands, and any remaining shared-state risk.
