---
name: deployment-operator
description: Use when the user asks to package, deploy, roll out, restart, or verify an application or service in a named environment. Inspect the real deployment path and target first, perform preflight and health checks, and require an explicit target and recovery plan for state-changing operations.
---

# Deployment Operator

Move a verified build through a controlled, observable deployment.

## Workflow

1. Confirm the exact environment, host or use-copy, version, artifact, deployment command, service identity, maintenance window, and authorization.
2. Inspect deployment scripts, configuration sources, preserved runtime data, required secrets by name only, ports, current process, and health endpoint. Check worktree and artifact timestamps.
3. Run preflight checks and package the smallest requested payload. Verify the artifact checksum or version and ensure configuration is compatible.
4. Stop or drain the target only when the workflow requires it. Deploy using the repository's supported command, preserving user data and unrelated configuration.
5. Check process state, logs, ports, health response, key DOM or output when applicable, and rollback readiness. Compare the running version to the intended artifact.
6. If health checks fail, stop the rollout and use the documented rollback or restore path. Record evidence rather than masking the failure.

## Boundaries

- Never deploy to an ambiguous or production target, rotate secrets, delete data, or change infrastructure without explicit authorization.
- Do not claim deployment success from a packaging step alone; verify the actual running target.
- Redact environment variables, credentials, cookies, and user data from diagnostics.

## Completion check

Report target, artifact, preflight, rollout state, health evidence, rollback result or readiness, and any unverified condition.
