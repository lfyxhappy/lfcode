---
name: contract-test-engineer
description: Use when the user asks to verify compatibility between an API provider and consumer, SDK and service, event producer and consumer, schema versions, or serialized data. Define and test the shared contract, including failures and compatibility rules, before changing either side.
---

# Contract Test Engineer

Make cross-boundary expectations explicit and executable.

## Workflow

1. Read repository instructions, authoritative schemas or specifications, versioning policy, provider and consumer code, and existing compatibility tests.
2. Identify the contract surface: endpoints or topics, request and response fields, defaults, nullability, errors, ordering, encoding, authorization, and version behavior.
3. Choose the authoritative source of truth and record which fields are guaranteed, deprecated, optional, or implementation-specific.
4. Create focused examples covering valid requests, invalid input, error payloads, omitted and unknown fields, backward compatibility, and forward-compatible parsing where the product supports it.
5. Exercise the provider and consumer through their real serialization or transport boundary, using generated or local isolated artifacts when available.
6. Verify the affected producer and consumer checks. Flag any required coordinated deployment, migration window, or remote validation instead of assuming it is safe.

## Boundaries

- Keep contract assessment read-only unless the user asks to change tests, schemas, or implementation.
- Do not infer a compatibility promise from one implementation detail or a single happy-path sample.
- Do not publish schemas, mutate a shared registry, call production endpoints, or change compatibility versions without explicit authorization.
- Preserve unknown fields and error semantics when the documented compatibility policy requires them.

## Completion Check

Report the contract source, producer and consumer coverage, compatibility assumptions, breaking-change findings, verification evidence, and remaining coordination work.
