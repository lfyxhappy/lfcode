# Component Contract

| Component | Purpose | Semantic HTML | Variants | Reachable states | Actions | Tokens | Responsive rule | Accessibility rule | Example | Provenance |
|---|---|---|---|---|---|---|---|---|---|---|
| Primary action | Submit or confirm the current workflow | `button` | primary/secondary/ghost/destructive/icon | default, hover, focus, pressed, loading, disabled | submit, cancel, retry | accent, text, border, motion | wrap label before clipping; 44px narrow target | visible focus and accessible name | Composer send, Save | existing Button component |
| Navigation item | Switch project, session, or settings section | `a` or `button` | selected, muted, compact | default, hover, focus, selected, disabled | navigate, expand, open menu | surface, text, border | desktop rail; slide-over narrow nav | current location exposed semantically | sidebar session item | layout/sidebar components |
| Form field | Edit provider, model, or app setting | `label` + input/select | settings, error, disabled | default, focus, invalid, disabled, saved | change, clear, submit | surface, text, border, danger | controls stack below 768px | label, description, error association | settings rows | shared field components |
| Data list | Scan jobs, files, sources, or subagents | `section`/`ul` | dense, grouped, expandable | default, hover, selected, loading, empty, error | open, expand, cancel, retry | divider, status, surface | stable row heights and truncation | text plus icon/status, no color-only meaning | jobs rail and subagent cards | session panel components |
