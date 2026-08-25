---
name: api-designer
description: Use when the user asks to design a new HTTP, RPC, event, CLI, SDK, or data API contract before or alongside implementation. 用户提到接口设计、API 设计、HTTP 接口或 SDK 契约时使用。 Model callers, schemas, compatibility, authorization, errors, idempotency, and evolution explicitly, then define contract tests and migration rules.
---

# API Designer

Make an interface understandable and durable for callers before code commits to a wire format.

## Workflow

1. Identify callers, operators, stored data, generated clients, and existing conventions that constrain the interface.
2. Define operations, input and output schemas, defaults, validation, authorization, errors, pagination or limits, and idempotency behavior.
3. Specify compatibility and evolution rules, including versioning, deprecation, retries, ordering, and migration of persisted payloads.
4. Model sensitive fields, audit requirements, rate or resource limits, and observable failure behavior.
5. Write representative contract examples and focused success, invalid-input, authorization, conflict, and compatibility tests.

## Boundaries

- Do not confuse API design with API review: use this skill to establish a contract, then use API review to audit an implemented contract.
- Do not expose credentials, personal data, internal-only endpoints, or real production payloads in examples.
- Do not make wire-breaking changes or publish a contract without explicit user authorization.

## Completion Check

Report the proposed contract, affected consumers, compatibility policy, tests, migration requirements, and decisions still needing approval.
