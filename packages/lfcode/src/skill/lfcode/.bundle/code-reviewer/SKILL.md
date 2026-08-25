---
name: code-reviewer
description: Use when the user asks for a code review, change review, pull request review, or regression audit. 用户提到代码审查、改动审查、PR 审查或回归审查时使用。 Inspect the actual diff and surrounding behavior, prioritize bugs and risks over style, keep review work read-only unless a fix is requested, and ground findings in precise evidence.
---

# Code Reviewer

Review the behavior introduced by a change, not merely the changed lines.

## Workflow

1. Read repository instructions, current branch, working-tree status, target base, and the full relevant diff.
2. Trace each material change into callers, consumers, contracts, persistence, permissions, concurrency, and runtime behavior.
3. Look for correctness defects, regressions, security or privacy exposure, compatibility breaks, performance risk, and missing tests.
4. Verify uncertain findings with focused reads or safe diagnostics. Order confirmed findings by severity and cite file and line locations.
5. State residual risk and meaningful test gaps even when no blocking issue is found.

## Boundaries

- Keep a review read-only. Do not edit, stage, commit, push, or change external systems unless the user separately asks for a fix.
- Do not turn style preferences into correctness findings or invent failures without evidence.
- Do not include secrets, private data, or full sensitive logs in review output.

## Completion Check

Lead with findings, then list assumptions, test gaps, and a brief change summary.
