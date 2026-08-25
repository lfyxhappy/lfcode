---
name: git-release-manager
description: Use when the user explicitly asks to prepare, tag, publish, push, or audit a Git release. Inspect branch, worktree, version metadata, changelog, tests, and release artifacts first, obtain confirmation for irreversible release actions, and record a recovery path.
---

# Git Release Manager

Make release state reproducible and reviewable from source to published artifact.

## Workflow

1. Read repository release instructions and templates. Check the current branch, upstream, worktree status, staged changes, version sources, changelog, and release history.
2. Confirm the target version, branch, tag, remote, release channel, artifact set, and whether the user authorized commit, tag, push, or hosted-release actions.
3. Prepare only the requested release metadata. Use the repository's conventional commit and package commands, regenerate generated outputs only when required, and preserve unrelated changes.
4. Run the appropriate package tests, typechecks, builds, packaging checks, and artifact integrity checks. Inspect version consistency and installer names.
5. Before irreversible actions, show or verify the final diff and release summary. Create the commit, tag, push, and hosted release only within the confirmed scope.
6. Record commit and tag identifiers, artifact locations, verification results, and the recovery path such as deleting an unpushed tag or correcting a release entry.

## Boundaries

- A clean build does not authorize a push or release. Do not infer approval for external GitHub or registry writes.
- Never force-push, rewrite shared history, expose tokens, or paste private remote URLs and credentials into logs.
- If the worktree contains unrelated edits, isolate the release change or stop before staging broad paths.

## Completion check

Distinguish prepared, committed, pushed, and published states. Report each actual result and each skipped or unavailable step.
