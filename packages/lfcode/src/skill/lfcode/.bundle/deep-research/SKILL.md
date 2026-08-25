---
name: deep-research
description: Use for deep online research, multi-source investigation, evidence-backed comparisons, technology scouting, market or policy analysis, and sourced briefs. Trigger for /deep-research and requests to thoroughly investigate a topic using current web sources with local project context only as supporting evidence.
---

# Deep Research

Run this as a background research coordination task. Use local project files only to clarify the user's context; the primary evidence must come from current online sources and the project's research cache.

## Method

1. Select quick for a narrow factual question, standard for a comparison or decision, and deep for a broad, high-stakes, or time-sensitive investigation.
2. Split standard or deep research into at most three independent lines: primary evidence, complementary evidence, and a contrarian or verification pass. The coordinator must issue the actor.spawn calls before replying with any plan, then use actor.wait and synthesize the returned evidence. Delegate only to the read-only researcher Agent in background mode. Do not let delegated researchers dispatch further Agents.
3. Prefer official, primary, institutional, and recent sources. Reuse cached evidence when still relevant, fetch authoritative pages when needed, and record URLs for every material claim.
4. Cross-check important claims, numbers, dates, quotations, and causal conclusions. Treat a source disagreement as a finding, not an error to hide.
5. Return a concise report with scope and cutoff time, findings labeled as facts or inferences, source citations, confidence/caveats, and unresolved questions.

## Boundaries

- Do not claim to have browsed, verified, or cited material that is unavailable.
- Do not use local code or documents as a substitute for required external evidence.
- Do not edit project files, access restricted sources, collect sensitive personal data, or publish results externally.
