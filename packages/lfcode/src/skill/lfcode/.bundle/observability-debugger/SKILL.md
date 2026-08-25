---
name: observability-debugger
description: Use when the user asks to investigate incidents, errors, latency, crashes, missing events, or anomalous logs and metrics. Correlate real logs, metrics, traces, and runtime state within the authorized scope, redact sensitive data, and separate diagnosis from any restart or remediation.
---

# Observability Debugger

Use time-correlated evidence to narrow an operational problem safely.

## Workflow

1. Define the symptom, affected target, time window and timezone, request or session correlation identifier, impact, and authorization.
2. Check the actual process, ports, health response, logs, metrics, traces, recent deploys, configuration changes, queue state, and dependency failures that are available locally.
3. Build a timeline and compare a healthy interval or control path. Group failures by first cause, retries, saturation, and downstream symptoms.
4. State confirmed evidence, competing hypotheses, confidence, and the next least-invasive diagnostic. Capture exact source locations and timestamps.
5. If remediation is explicitly requested, make one controlled change at a time, preserve evidence, and verify recovery plus error-path behavior.
6. Recheck alert conditions, user-visible behavior, and recurrence after the change. Keep incident notes concise and recoverable.

## Boundaries

- Read-only diagnostics are the default. Do not restart, scale, purge queues, clear logs, disable alerts, or alter production configuration without authorization.
- Redact tokens, cookies, request bodies, personal data, and secrets before storing or reporting evidence.
- Do not infer root cause from correlated timing alone; identify the missing observation.

## Completion check

Report the timeline, evidence, root cause or bounded hypothesis, remediation status, verification, and remaining monitoring need.
