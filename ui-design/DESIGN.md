# Design System

## Direction
- Scene sentence: A developer supervises several AI-assisted coding tasks in a quiet, high-signal workspace that stays legible during long sessions in both light and dark rooms.
- Desired qualities: calm, compact, direct, token-consistent, keyboard-friendly, and easy to scan while streaming content
- Anti-references: purple-blue gradients, glassmorphism, nested cards, oversized radii, heavy shadows, tiny core labels, and hover-only primary actions
- Variance: 2/10
- Motion: 3/10
- Density: 8/10

## Tokens
- Background: `#F7F8FA` light / `#111315` dark
- Surface: `#FFFFFF` light / `#171A1D` dark, with `surface-raised` for controls and menus
- Text: strong `#17191C` / `#F1F3F5`, body `#4F5660` / `#B5BBC4`, weak `#737B86` / `#858D98`
- Border: `#DDE1E6` / `#2A2F35`, with weaker dividers for grouping
- Accent: `#2563EB` / `#6EA8FE`; status success `#2E9D5B`, warning `#D49328`, danger `#D45151`
- Type families and scale: existing sans UI family with 12/13/14/16/20px steps; mono remains user-configurable for code and logs
- Spacing scale: 4/8/12/16/24px; use 6px only for tight inline alignment
- Radius and elevation: 4/6/8px radii; thin semantic borders and restrained token shadows, no floating section containers
- Motion timing and reduced-motion behavior: micro 120ms, content 180ms, surface 220ms; all transitions honor `prefers-reduced-motion` and the app motion mode

## Layout
- Container model: full-height app shell, fixed navigation rails, flexible session content, max-width settings content with a sticky tokenized title row
- Breakpoints: narrow below 768px, desktop navigation at `xl`; controls wrap before they clip
- Navigation behavior: desktop sidebar stays in layout; narrow sidebar slides over content with an opaque semantic backdrop and an explicit close path
- Mobile prioritization: Composer and current session first, then navigation and contextual panels; preserve 44px targets

## Component Language
- Button variants: primary, secondary, ghost, destructive, icon; all have visible focus and stable hit areas
- Form controls: semantic labels, tokenized borders/surfaces, 36px desktop height and 44px narrow-screen target when needed
- Panels and cards: use unframed sections and dividers by default; reserve bordered cards for repeated jobs, subagents, dialogs, and genuinely framed tools
- Tables and lists: dense rows, stable columns, truncation with titles, status colors paired with text/icon
- Empty/loading/error states: preserve layout dimensions, explain next action, and keep error text readable without relying on color alone
- Icon family: existing Lucide-based icon system with accessible labels for icon-only controls
