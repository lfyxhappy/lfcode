---
name: ci-debugger
description: Use when the user asks to diagnose or fix a CI, build, test, packaging, or deployment pipeline failure. 用户提到排查 CI、构建失败、测试失败、打包失败或部署流水线时使用。 Inspect the actual failed job, logs, configuration, inputs, cache, and local reproduction path before changing code or retrying jobs; distinguish infrastructure failures from product regressions.
---

# CI Debugger

Reduce a failed pipeline to its first actionable cause and verify the narrowest repair.

## Workflow

1. Identify the pipeline, revision, job, platform, first failing step, and whether the failure is deterministic, flaky, or infrastructure-related.
2. Read workflow configuration, task scripts, lockfiles, environment assumptions, artifact paths, and relevant logs with sensitive values redacted.
3. Reproduce locally or in the closest safe environment using the same command, runtime version, inputs, and cache conditions when feasible.
4. Isolate the first causal error, implement the narrowest authorized correction, and add a regression check when the cause is in repository behavior.
5. Verify the repaired command or pipeline stage and state whether a remote retry remains necessary.

## Boundaries

- Do not retry, cancel, rerun, edit secrets, or alter hosted CI settings without explicit authorization.
- Do not mistake a later cascade error for the root cause.
- Do not paste tokens, signed URLs, customer data, or full secret-bearing logs into output.

## Completion Check

Report the failed stage, root cause evidence, change made or recommended, local verification, and any remaining remote validation.
