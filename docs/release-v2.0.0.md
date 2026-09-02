# Lfcode v2.0.0

Lfcode v2 brings the coding agent into a local-first workbench for real project work. Conversations, code, terminals, browser sessions, skills, MCP tools, plugins, model providers, and project rules now live in one workflow.

## What is new

### A complete desktop workbench

- A focused session workspace for prompts, responses, code changes, tool output, and project context.
- Faster navigation between sessions, projects, workspaces, files, and browser panels.
- Session archive actions that keep the sidebar compact without changing project or workspace menus.
- Improved context status, usage metrics, performance cards, and activity visibility.

### Agent orchestration and research

- Background agent dispatch with parent/child task tracking.
- Deep Research coordination with researcher progress and recoverable task state.
- More reliable actor reuse, retry, recovery, cancellation, and post-stop persistence.
- Context planning and snapshots for long-running sessions and handoffs.

### Tools and extensibility

- Integrated terminal, browser, code editing, file operations, search, patching, and office workflows.
- Skills and plugin discovery with settings surfaces for management.
- MCP and external-agent workflows with clearer status and failure handling.
- Scheduled automations, notifications, subagent presets, and reusable project instructions.

### Provider catalog and LFAPI

- Improved provider and model selection flows with popular-provider grouping.
- Provider quota and usage views for supported providers.
- New LFAPI popular provider at `https://ai.liangfeng.net.cn/v1`.
- LFAPI supports OpenAI-compatible Chat Completions and Responses protocols.
- LFAPI model discovery is available through `/models` and the Lfcode settings flow; credentials are kept out of discovery responses and temporary discovery keys are not persisted.

### Windows release lane

- Dedicated pre-release and production Windows lanes with separate icons and data roots.
- Hash-checked package synchronization that preserves production runtime data.
- Bundled Git, Python, CodeGraph, shell parser assets, and runtime configuration validation.

### Product introduction page

- The Lfcode product introduction page is now published through GitHub Pages at:
  `https://lfyxhappy.github.io/lfcode/`

## Upgrade notes

- Existing project files, sessions, attachments, databases, and runtime state are preserved during the Windows promotion flow.
- Provider credentials must be configured again only when adding a new provider or changing its local configuration.
- LFAPI protocol and model discovery are implemented. A live model-generation check still requires a valid LFAPI API key.

## Verification

This release is checked with repository linting and type checking, package-local tests, Windows packaging checks, installed-copy health checks, release asset verification, and GitHub Pages smoke checks.
