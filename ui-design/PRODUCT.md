# Product Context

## Product
- Name: Lfcode
- Register: product / developer workspace
- Audience: developers and technical operators working with local AI sessions, projects, tools, and background jobs
- Usage context: a dense desktop workspace with a narrow-screen fallback, used repeatedly while coding and supervising model work
- Primary task: start, inspect, steer, and finish an AI-assisted coding session without losing project context
- Secondary tasks: manage providers and models, inspect files and changes, review plans and subagents, configure tools, and monitor usage

## Content Priority
1. Session timeline and Composer
2. Project/session navigation and contextual side panels
3. Settings, provider/model configuration, jobs, files, and usage summaries

## Constraints
- Required pages or states: session, project navigation, settings sections, empty/loading/error/success states, background jobs, subagent cards, file and tool surfaces
- Accessibility: semantic controls, visible keyboard focus, readable 12px-or-larger supporting text, 44px touch targets on narrow screens, reduced motion
- Localization: Chinese and English strings must wrap without clipping; avoid fixed-width labels
- Required viewports: 1440x900 desktop and 390x844 narrow screen, plus intermediate widths
- Existing technical constraints: SolidJS/Tailwind, shared `@lfcode-ai/ui` tokens, Electron installed-use verification, preserve automation selectors and existing behavior
