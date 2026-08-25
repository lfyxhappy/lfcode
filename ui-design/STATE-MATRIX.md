# UI State Matrix

| Surface/component | Default | Hover | Focus | Pressed | Selected | Loading | Empty | Error | Success | Disabled | Destructive |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Primary action | token surface | stronger surface/text | accent pressed | focus ring | selected accent | spinner and stable width | inline error or retry | success toast/status | muted + `aria-disabled` | destructive variant uses danger token |
| Navigation item | transparent/weak surface | raised surface | pressed surface | focus ring | active surface/marker | n/a | n/a | selected text/icon | muted text | destructive only in context menu |
| Form field | base surface/border | border hover | pressed/select state | 2px focus ring | selected option | preserve dimensions | error border + message | saved state | disabled surface/text | destructive reset asks for confirmation |
| Data list | divider and text | hover surface | pressed row | row focus ring | selected surface | skeleton or loading label | inline error with retry | status text/icon | disabled row | danger status never color-only |
