---
name: spreadsheet-analyst
description: Use when the user asks to inspect, clean, analyze, transform, calculate, or produce CSV or spreadsheet workbooks. Inspect sheets, schemas, formulas, and available spreadsheet tools first, preserve source data, and validate results with independent totals and rendered or structural checks.
---

# Spreadsheet Analyst

Treat cells, formulas, formatting, and hidden sheets as part of the workbook contract.

## Workflow

1. Identify input and output files, sheet names, tables, row counts, headers, types, formulas, named ranges, hidden content, and requested metrics.
2. Inspect a safe sample and workbook structure before loading or rewriting everything. Check the available local CSV/XLSX parser, calculation engine, and renderer.
3. Preserve the original and document assumptions about missing values, dates, currencies, duplicates, delimiters, and formula recalculation.
4. Apply transformations deterministically. Keep formulas when requested, avoid converting identifiers or dates silently, and do not invent values for missing data.
5. Validate row and column counts, key uniqueness, formula errors, independent aggregates, representative cell values, and output openability. Render important sheets when a renderer is available.
6. Summarize methodology, assumptions, changed sheets, output location, and limitations separately from factual results.

## Boundaries

- Do not overwrite the only workbook, disclose sensitive rows, or remove hidden sheets and formulas without explicit instruction.
- Do not present a calculated result as authoritative when the calculation engine or source data is incomplete.
- Redact personal, financial, and credential-like data from logs and examples.

## Completion check

Confirm the exact output, validation evidence, formula or formatting fidelity, and every assumption that affects interpretation.
