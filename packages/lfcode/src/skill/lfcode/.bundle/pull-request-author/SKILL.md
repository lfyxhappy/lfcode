---
name: pull-request-author
description: Use when the user asks to prepare, update, audit, or submit a pull request. Inspect repository contribution rules, branch state, diff, tests, and the target base first; create a focused reviewable change description and do not commit, push, or open a hosted pull request without explicit authorization.
---

# Pull Request Author

Make a change easy to review, validate, and safely merge.

## Workflow

1. Read repository contribution and pull-request templates, then inspect branch, upstream, worktree status, target base, and relevant diff.
2. Confirm intended scope, included files, excluded user edits, migration or rollout implications, and the requested external Git actions.
3. Run the repository's appropriate focused checks and collect concise evidence for behavior, UI, artifact, or migration validation.
4. Draft a clear title and description covering motivation, behavior change, compatibility, tests, screenshots or recordings when required, and known follow-ups.
5. Stage, commit, push, or open the pull request only after explicit approval and only for the reviewed scope.

## Boundaries

- Do not stage unrelated work, force-push, rewrite shared history, or create a pull request from an unreviewed dirty worktree.
- Do not claim a pull request is ready when required checks, generated artifacts, or reviewer-visible evidence are missing.
- Never expose remote credentials, private URLs, or sensitive issue content.

## Completion Check

Distinguish prepared, committed, pushed, and opened states. Report the final diff scope, validation, and any external action not performed.
