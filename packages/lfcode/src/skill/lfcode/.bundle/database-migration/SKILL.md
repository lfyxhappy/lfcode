---
name: database-migration
description: Use when the user asks to design, review, or execute a database schema change, data backfill, index change, or migration. Inspect the current schema and migration conventions first, plan safe rollout and recovery, and never perform destructive production changes without explicit authorization.
---

# Database Migration

Treat schema and data changes as a rollout with compatibility and recovery requirements.

## Workflow

1. Identify the database, schema source, migration runner, environment, current version, affected tables, indexes, constraints, and data volume.
2. Check repository instructions and worktree changes. Read neighboring migrations and the code paths that read and write the affected fields.
3. Design an additive or otherwise compatible sequence where possible. Consider nullability, defaults, backfills, locking, transaction size, retries, idempotency, and concurrent old/new binaries.
4. Define preflight checks, backup or restore evidence, failure detection, rollback or roll-forward recovery, and ownership before execution.
5. Implement only the requested migration and required code compatibility changes. Use a dry run, disposable database, or staging target before a real target when available.
6. Verify schema metadata, representative data invariants, application reads and writes, migration status, and performance after the change.

## Boundaries

- Do not drop data, rewrite large tables, or run against production from an ambiguous request.
- Do not put credentials or complete data dumps in migrations, logs, tests, or the final report.
- Treat a migration file being accepted by the runner as insufficient proof that data and old clients remain safe.

## Completion check

Report the preflight, rollout order, recovery path, verification evidence, and any environment or backup check that remains outstanding.
