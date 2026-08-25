---
name: performance-profiler
description: Use when the user reports slow startup, latency, high CPU, memory growth, rendering jank, or throughput regression. Establish a reproducible baseline with available profiling tools, identify evidence-backed bottlenecks, and separate diagnosis from any authorized optimization.
---

# Performance Profiler

Measure before optimizing and compare like with like.

## Workflow

1. Define the metric, workload, environment, and acceptable threshold. Record a baseline and warm-up conditions.
2. Inspect the real entrypoint, hot path, I/O, concurrency, caching, allocations, and generated artifacts involved in the report.
3. Use the profiler, tracing, timing, memory, browser, or package tools already available in the repository. Prefer repeatable samples over a single wall-clock observation.
4. Separate product work from test or environment noise. Check whether logs, debug mode, cold caches, and fixture size explain the result.
5. If optimization is requested, make the smallest change tied to a measured bottleneck and preserve correctness, cancellation, ordering, and resource cleanup.
6. Re-run the same workload, compare baseline and result, and run focused regression tests plus typecheck or build as needed.

## Boundaries

- Do not profile or alter production data, credentials, traffic, or process state without explicit authorization.
- Do not optimize speculative code or report a percentage without stating sample size and conditions.
- Treat memory or latency improvements as incomplete if correctness and error paths were not rechecked.

## Completion check

Report the baseline, evidence, bottleneck, change if any, comparison result, and remaining measurement limitations.
