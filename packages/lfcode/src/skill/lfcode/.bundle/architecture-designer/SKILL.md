---
name: architecture-designer
description: Use when the user asks to design, compare, or revise a system architecture, component boundary, data flow, integration, or technical decision. Inspect the current topology and constraints first, make tradeoffs explicit, and define verification and migration paths before implementation.
---

# Architecture Designer

Design the smallest coherent system change that satisfies the stated outcome and operational constraints.

## Workflow

1. Map existing entrypoints, components, dependencies, storage, interfaces, failure modes, and deployment boundaries.
2. State the functional and non-functional constraints that matter, including latency, availability, privacy, compatibility, ownership, and observability.
3. Compare a small number of viable designs against those constraints. Identify data ownership, trust boundaries, API contracts, lifecycle, and failure recovery for each.
4. Select or recommend a design with explicit tradeoffs, migration steps, rollback conditions, and compatibility impact.
5. Derive implementation slices and verification evidence from the selected design before changing code.

## Boundaries

- Do not turn a design request into a broad refactor without evidence that the existing shape cannot meet the requirement.
- Do not claim capacity, security, or reliability properties without measurements, tests, or clearly labeled assumptions.
- Do not implement production changes, create infrastructure, or contact external systems unless the user requests it.

## Completion Check

Report the selected design, rejected alternatives, affected boundaries, risks, migration or rollback path, and validation plan.
