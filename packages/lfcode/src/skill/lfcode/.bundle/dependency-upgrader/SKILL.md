---
name: dependency-upgrader
description: Use when the user asks to upgrade, downgrade, replace, or reconcile a package dependency or lockfile. Inspect package-manager conventions and usage first, preserve unrelated dependency changes, and verify compatibility with focused tests and type checks before reporting completion.
---

# Dependency Upgrader

Change dependencies deliberately and leave the lockfile consistent with the repository.

## Workflow

1. Identify the workspace package, package manager, manifest, lockfile, supported runtime, and the exact requested version range.
2. Check `git status` and diffs before editing. Search for direct imports, peer constraints, scripts, generated files, and package-specific compatibility tests.
3. Review locally available package metadata or release information. If authoritative information is unavailable, state that limitation instead of inventing compatibility claims.
4. Update only the requested manifest and the lockfile entries required by the package manager. Preserve unrelated user edits and avoid opportunistic upgrades.
5. Run the package's install or consistency check, focused tests, typecheck, and build when the dependency affects generated or shipped output.
6. Inspect the final diff for transitive churn, license or security concerns, and accidental credentials before handoff.

## Boundaries

- Use Bun workspace commands where this repository requires Bun. Do not silently switch package managers.
- Do not run arbitrary install scripts, execute untrusted package code, or change registry credentials without explicit authorization.
- Do not claim an upgrade is safe solely because installation succeeded; distinguish resolution, compilation, tests, and runtime verification.

## Recovery

If resolution or tests fail, preserve the failure evidence, identify the incompatible constraint, and propose a bounded rollback or version adjustment. Never discard unrelated worktree changes.
