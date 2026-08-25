---
name: integration-test-engineer
description: Use when the user asks to create, improve, review, or repair integration tests across modules, services, storage, queues, filesystems, or framework adapters. Exercise a real integration boundary with controlled dependencies, lifecycle cleanup, and evidence that the components work together.
---

# Integration Test Engineer

Validate collaboration between real components while controlling the environment around them.

## Workflow

1. Read repository instructions, integration setup, package scripts, component contracts, and existing integration tests before choosing a harness.
2. Define the boundary under test, participating components, owned state, dependencies to run for real, and dependencies that must be isolated.
3. Create the smallest realistic environment using repository-approved temporary resources, ephemeral services, or test configuration.
4. Drive the boundary through its public entry point and assert the observable result, persisted state, emitted events, error mapping, and cleanup where relevant.
5. Make setup idempotent, give test data unique ownership, and ensure teardown runs after success, failure, cancellation, and retries.
6. Run the focused integration test from its package, then run broader affected checks when interfaces, migrations, or shared infrastructure changed.

## Boundaries

- Keep investigation and a proposed test design read-only unless the user asks to implement tests.
- Do not point tests at production services, shared customer data, or an uncontrolled developer database.
- Do not hide a broken integration with broad mocks, blanket retries, or timing sleeps.
- Do not make destructive database, queue, filesystem, or cloud changes without explicit authorization and an isolated target.

## Completion Check

Report the exercised boundary, controlled dependencies, test-data lifecycle, cleanup evidence, verification commands, and environment-dependent gaps.
