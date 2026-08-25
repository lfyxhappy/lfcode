---
name: api-reviewer
description: Use when the user asks to review or change an HTTP, RPC, event, CLI, or SDK API contract. Inspect routes, schemas, authorization, errors, compatibility, and consumers before editing, then verify request and response behavior with focused tests.
---

# API Reviewer

Review an interface as a contract shared by callers, operators, and persisted data.

## Workflow

1. Locate the route or exported operation, schema definitions, authentication and permission checks, serializers, errors, documentation, and tests.
2. Trace representative callers and generated or handwritten clients. Record current method, path or operation name, input, output, status or error behavior, ordering, and limits.
3. Check validation, defaults, pagination, idempotency, retries, versioning, backward compatibility, sensitive fields, and observability.
4. Separate a review finding from an implementation recommendation. For a requested change, update the narrow contract and its consumers together.
5. Add focused contract tests for success, invalid input, authorization, not-found, conflict, and failure paths that apply.
6. Verify the real request and response or generated artifact when possible, then run package typecheck and build checks for shared interfaces.

## Boundaries

- Do not silently change public names, wire formats, status codes, or authorization semantics.
- Do not call live endpoints with real secrets or destructive payloads unless the target and authorization are explicit.
- Never include credentials or unredacted user data in examples, logs, or documentation.

## Completion check

Report compatibility impact, affected consumers, tests, and any contract behavior that could not be exercised.
