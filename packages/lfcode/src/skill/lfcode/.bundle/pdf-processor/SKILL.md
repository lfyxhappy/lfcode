---
name: pdf-processor
description: Use when the user asks to extract, inspect, merge, split, rotate, OCR, redact, annotate, create, or validate PDF files. 用户提到 PDF、提取 PDF、合并 PDF、拆分 PDF、旋转 PDF 或 PDF OCR 时使用。 Check the input and available local PDF tools first, preserve source files, and verify both PDF structure and rendered pages.
---

# PDF Processor

Handle PDFs as potentially lossy, layout-sensitive artifacts.

## Workflow

1. Inspect file existence, page count, metadata, encryption, text layer, images, forms, annotations, and expected output without exposing sensitive content.
2. Check which local command, library, renderer, or OCR runtime is actually available. Choose the least lossy path for the requested operation.
3. Work on a copy or produce a new output. Keep page order, orientation, links, fonts, accessibility tags, and annotations when the format and tool support them.
4. For OCR or extraction, preserve page references and mark low-confidence or image-only text. For redaction, verify that underlying text and metadata are not still recoverable.
5. Validate output existence, openability, page count, dimensions, text or image presence, and representative rendered pages. Check edge cases such as blank, rotated, scanned, and large pages.

## Boundaries

- Never claim a redaction is secure without checking the actual PDF content layers and metadata.
- Do not upload PDFs to external services, overwrite the source, or fabricate missing text without explicit authorization.
- Do not treat a successful command exit as proof of visual or semantic correctness.

## Completion check

Report the input and output paths, operation, tools actually used, structural and render checks, OCR uncertainty, and any unsupported feature.
