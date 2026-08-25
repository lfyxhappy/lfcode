# Component Registry

Register reusable UI components here before duplicating markup. Each entry should define:

- `name`: stable component family name
- `purpose`: user or product purpose
- `semantic_element`: preferred HTML element(s)
- `variants`: allowed visual or behavior variants
- `states`: reachable states
- `actions`: supported user actions
- `responsive`: behavior across viewport ranges
- `accessibility`: naming, focus, keyboard, and status requirements
- `tokens`: semantic token roles used by the component
- `example`: minimal HTML usage or story path
- `source`: implementation path
- `provenance`: copied, adapted, generated, or local; include license/reference when relevant
- Mark shipped reusable instances with `data-ui-component`, and use `data-ui-variant` / `data-ui-state` when the registry contract has those dimensions.
- Run `ui_component_drift_gate.py --check-coverage` when every declared variant and state needs an annotated example.
- Optional `stories` entries should define `id`, `selector`, `variant`, `state`, and a non-empty `expected` object; bind the source root with `data-ui-story`.

Prefer extending a registered component over creating a one-off visual clone. Keep page-specific composition in the page context.
