---
name: visual-regression-tester
description: Use when the user asks to detect, review, prevent, or update visual regressions in a web, desktop, or mobile interface. Capture comparable rendered states, control viewport and data variance, inspect image differences, and distinguish intended design changes from rendering defects.
---

# Visual Regression Tester

Compare rendered output with deliberate baselines rather than relying on source inspection.

## Workflow

1. Read repository instructions, design requirements, existing screenshot tests, baseline ownership rules, and the actual rendered artifact to inspect.
2. Define comparable states: viewport or device, scale factor, color scheme, locale, fonts, browser or runtime version, data fixture, navigation state, and loading readiness.
3. Capture a baseline only from a verified intended state. Use stable test data and wait for meaningful content and fonts rather than fixed delays.
4. Capture the candidate through the same path, then inspect the visual diff and relevant DOM, console, network, or accessibility evidence when pixels alone are ambiguous.
5. Classify differences as intended product change, layout or styling defect, missing asset, rendering-environment variance, or unstable test setup.
6. Update a baseline only after confirming the rendering change is intentional and reviewing the full affected surface, then rerun the focused visual check.

## Boundaries

- Keep visual assessment read-only unless the user asks to change tests, baselines, or product code.
- Do not approve or regenerate baselines merely to make a visual test pass.
- Do not compare screenshots with uncontrolled fonts, network data, animations, time, locale, or viewport conditions.
- Do not expose customer content, access tokens, or sensitive screenshots in reports or committed artifacts.

## Completion Check

Report the compared artifact, controlled rendering conditions, baseline decision, inspected differences, verification command, and any remaining platform variance.
