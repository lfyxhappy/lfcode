---
name: property-test-engineer
description: Use when the user asks to design, implement, review, or repair property-based, generative, fuzz, invariant, metamorphic, or randomized tests. Express durable behavior over a broad input space, use valid generators and shrinking, and preserve a reproducible failing case.
---

# Property Test Engineer

Test invariants over input families instead of enumerating only hand-picked examples.

## Workflow

1. Read repository instructions, target code, existing example tests, domain constraints, and the available property-testing or fuzzing framework.
2. State one or more independently observable properties: invariants, round trips, ordering, idempotence, bounds, preservation, equivalence, or metamorphic relations.
3. Define generators that produce valid and deliberately invalid inputs with realistic distributions, including boundary values and structural variations.
4. Keep the oracle independent from the implementation under test. Combine a property with a simpler reference model only when the model represents the contract rather than duplicated production logic.
5. Configure deterministic seeds, bounded runtime, useful shrinking, and failure output that records the minimized counterexample and reproduction command.
6. Add a focused example regression case for a discovered bug when it improves readability, then run the property test and affected package checks.

## Boundaries

- Keep property design and review read-only unless the user asks to change tests or implementation.
- Do not use unbounded generators, opaque randomness, or huge case counts that make normal verification impractical.
- Do not call external production systems or mutate shared state from generated cases without explicit authorization and strict isolation.
- Do not replace ordinary examples when a specific user-visible scenario is clearer as an example test.

## Completion Check

Report the property, generator domain, oracle, seed and shrinking behavior, runtime budget, discovered counterexamples if any, verification result, and coverage limits.
