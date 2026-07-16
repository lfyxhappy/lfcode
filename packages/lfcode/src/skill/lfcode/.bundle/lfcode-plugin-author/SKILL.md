---
name: lfcode-plugin-author
description: Use when creating, validating, previewing, exporting, or installing an Lfcode plugin. Restricts model-authored plugins to reviewed tool or integration workspaces and requires explicit user confirmation before installation.
---

# Lfcode Plugin Author

Use the managed authoring workflow. Never write directly into the installed plugin library.

## Allowed scope

- Create only `tool` or `integration` plugins.
- Work only through `plugin_author` inside the managed workspace for the requested plugin ID.
- Use the public `@lfcode-ai/plugin` SDK. Do not import private runtime modules from `packages/lfcode`.
- Do not claim `official` or `bundled` trust. Model-authored plugins are `external`.

## Required workflow

1. Call `plugin_author` with `create` to create a minimal workspace.
2. Inspect and edit only that workspace with normal file tools.
3. Call `plugin_author` with `validate`; fix every blocking error.
4. Add a focused real test when the plugin contains behavior beyond the generated placeholder.
5. Call `plugin_author` with `preview` and show the full review report to the user.
6. Stop and request explicit confirmation. Do not treat the request to create the plugin as confirmation to install it.
7. Only after confirmation, pass the returned token to `plugin_manage` with `import_commit`.
8. Verify the installed plugin appears in `plugin_manage list` and is visible from the next provider turn.

## Prohibited actions

- Do not write `<lfcode-data>/plugins/library`, `current.json`, or `registry.json` directly.
- Do not bypass preview tokens, fabricate digests, extend expiry, or reuse a consumed token.
- Do not generate `provider`, `ui`, `theme`, `runtime`, or `mixed` plugins in the first authoring version.
- Do not add native executables, install scripts, dynamic libraries, credentials, tokens, or machine-specific absolute paths.
- Do not automatically approve, enable, replace, uninstall, or export outside the managed workflow.
