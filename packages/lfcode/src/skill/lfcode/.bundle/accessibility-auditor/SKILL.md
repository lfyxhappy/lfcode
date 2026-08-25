---
name: accessibility-auditor
description: Use when the user asks to audit accessibility, keyboard usability, semantics, contrast, focus behavior, or assistive-technology support in a UI. Inspect the actual rendered page and interaction states, report evidence-backed findings, and only implement fixes when explicitly requested.
---

# Accessibility Auditor

Evaluate usable access across semantics, interaction, visual presentation, and dynamic updates.

## Workflow

1. Identify the target route, supported platforms, user flows, viewport sizes, component states, and applicable accessibility standard or product requirement.
2. Inspect the real DOM and rendered UI, not only source JSX or templates. Check landmarks, headings, labels, roles, names, descriptions, form errors, live regions, and table or dialog structure.
3. Exercise keyboard-only navigation, focus visibility and order, pointer alternatives, escape and submit behavior, loading and error updates, zoom or narrow layouts, and reduced-motion behavior where applicable.
4. Check color contrast, text scaling, overflow, hit targets, non-text alternatives, and status messages with available local tools. Record reproducible steps and exact elements.
5. Classify findings by user impact and confidence. Suggest the smallest remediation without changing product semantics; implement only when authorized.
6. Re-run the same flows after a fix and inspect browser console, page errors, and relevant automated checks.

## Boundaries

- Do not claim full compliance from a limited automated scan or a single browser and viewport.
- Do not remove content, alter focus management, or weaken semantics to silence a checker.
- Redact user data from screenshots and accessibility trees when sharing evidence.

## Completion check

Report finding, affected state, reproduction, expected behavior, severity rationale, verification, and coverage gaps.
