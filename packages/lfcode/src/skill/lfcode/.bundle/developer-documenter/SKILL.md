---
name: developer-documenter
description: Use when the user asks to create, update, review, or reorganize developer-facing documentation such as README files, architecture notes, runbooks, API guides, contribution instructions, migration guides, or troubleshooting material. Inspect the implemented behavior and repository conventions first, keep claims verifiable, and validate links, commands, and examples.
---

# Developer Documenter

Document the operational truth of a project so another developer can use, change, and recover it.

## Workflow

1. Identify the documentation audience, task, repository convention, source of truth, and current user journey.
2. Inspect implementation, scripts, configuration, generated artifacts, tests, and runtime behavior before documenting commands or guarantees.
3. Organize content around prerequisites, outcomes, commands, interfaces, failures, recovery, and ownership. Keep stable facts separate from examples and environment-specific values.
4. Update only the documentation necessary for the requested behavior; retain existing terminology and avoid duplicating a more authoritative source.
5. Validate command examples, paths, links, code snippets, generated output, and rendered documents where practical.

## Boundaries

- Do not invent features, configuration values, release steps, performance claims, or security guarantees.
- Do not include secrets, tokens, customer data, internal-only endpoints, or personal paths in user-facing documentation.
- Do not rewrite unrelated documentation or change product behavior merely to make documentation simpler.

## Completion Check

Report documentation changed, evidence checked, commands or links validated, and material behavior that remains undocumented or unverified.
