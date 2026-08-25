---
name: tavern-management
description: Use when the user asks to import or translate an Lfcode Tavern or SillyTavern character card or worldbook, including PNG image cards, or manage the Tavern plugin lifecycle.
---

# Lfcode Tavern Management

## Scope

Use this skill for Lfcode Tavern character cards, worldbooks, and the Tavern plugin itself. Tavern accepts Character Card V2 JSON and PNG cards carrying `chara` metadata in `tEXt`, `zTXt`, or `iTXt` PNG chunks. Treat a PNG card as both an image and structured character data; do not flatten it to a plain image.

The original SillyTavern migration vault is read-only. Importing or translating creates a new Lfcode Tavern copy and must never overwrite the user's source card, source worldbook, or migration archive.

## Plugin Lifecycle

Use `plugin_manage` for plugin library work.

1. Inspect first with `plugin_manage` `list` or `inspect`.
2. For a new plugin package, call `import_preview`; report the reviewed package details before any install.
3. Only call `import_commit`, `enable`, `disable`, or `uninstall` after the user has explicitly approved that change. Give the tool a concise reason.
4. Do not use shell deletion or edit the plugin registry directly. Disable or uninstalling Tavern must not be used as a shortcut to delete Tavern conversations or private data.

## Import Workflow

1. Open Tavern, then use `角色` or `世界书` management and choose the import action.
2. Character cards may be `.json` or `.png`; worldbooks are JSON files. The app copies the selected file into Tavern private storage before creating its index entry.
3. Preserve card data such as `data.character_book`, alternate greetings, tags, and template variables. A card's embedded worldbook should stay associated with that imported character.
4. Verify the imported character name, opening message, and linked worldbook before creating a conversation.

## Character Card Translation

1. Work from a user-selected source file or a new exported copy. Do not modify the original in place.
2. Extract JSON from either format with the script in this skill directory:

```sh
node scripts/tavern-card.mjs read "input-card.png" > card.json
```

3. Translate `data.name`, description, personality, scenario, first message, example dialogue, creator notes, system prompt, post-history instructions, alternate greetings, tags, and embedded `character_book` text. Keep `{{char}}`, `{{user}}`, `<START>`, Markdown, regular expressions, JSON keys, and formatting intact. If V1 mirror fields exist at the top level, keep them synchronized with `data`.
4. For embedded worldbook keys, preserve the original trigger and append a Chinese trigger rather than replacing it. Translate entry content, comments, names, and descriptions.
5. For a PNG source, write a separate PNG that preserves all image chunks and replaces only the `chara` metadata:

```sh
node scripts/tavern-card.mjs write "input-card.png" translated-card.json "translated-card.png"
```

6. Import the translated copy through Tavern management, then validate its name, first message, and embedded worldbook. For a JSON source, write a new `.json` file and import that copy.

## Worldbook Translation

Translate the worldbook name, description, entry content, and entry comments. Keep entry IDs, insertion settings, depth, probability, priority, regular-expression flags, and activation settings unchanged. For keyword arrays, retain source keywords and append translated keywords so both languages can activate the entry.

## Safety Checks

- Do not expose API keys, tokens, cookies, or provider credentials found in an imported file.
- Do not re-run the one-time global SillyTavern migration.
- Do not overwrite an existing character or worldbook without telling the user which Tavern copy will change.
- If a PNG has no valid `chara` payload, report that it is an image, not a usable Tavern character card.
