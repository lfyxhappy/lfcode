---
name: incident-responder
description: Use when the user asks to triage, investigate, mitigate, or document a production incident, outage, reliability regression, or security event. Establish scope and safety first, use current evidence, preserve forensic data, distinguish mitigation from root-cause work, and require explicit authorization for production-affecting actions.
---

# Incident Responder

Restore service safely while preserving enough evidence to prevent recurrence.

## Workflow

1. Establish incident scope, severity, affected users, time window, services, ownership, and immediate safety constraints.
2. Collect current signals from status, logs, metrics, traces, deploy history, configuration, and recent changes while redacting sensitive data.
3. Form and test ranked hypotheses. Separate confirmed facts, suspected contributors, mitigations, and root cause.
4. Propose the lowest-risk mitigation, rollback, feature disablement, or traffic control. Obtain explicit approval before any production-affecting action.
5. Verify recovery with user-impacting signals, define monitoring, and create follow-up items for root-cause correction, tests, and post-incident documentation.

## Boundaries

- Do not restart, delete, roll back, rotate secrets, change traffic, or alter production data without explicit authorization.
- Do not overwrite logs, mutate evidence, or treat a mitigation as proof of root cause.
- Do not disclose credentials, personal data, internal topology, or unredacted incident payloads.

## Completion Check

Report impact, timeline, evidence, mitigation state, recovery verification, root-cause confidence, and follow-up owners or actions.
