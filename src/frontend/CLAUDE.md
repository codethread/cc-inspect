# Frontend instructions

## Design document

**Always read `/DESIGN.md` before working on the frontend.** It is the authoritative description of all UI behaviour, layout, and interaction patterns — use it instead of reading through component code to understand intent.

**Always update `/DESIGN.md` after making UI changes.** If you add, remove, or alter any user-visible behaviour (layout, interactions, filtering, keyboard shortcuts, event rendering, panel behaviour, etc.), update the relevant section of `DESIGN.md` to reflect the new state. The document must remain accurate and complete so future agents can rely on it without reading source code.

## Component structure

The UI is a single `SessionView` component broken into focused files:

```
src/frontend/components/
  SessionView.tsx           — main component and state management
  SessionPicker.tsx         — session/project dropdown
  Outline.tsx               — left sidebar navigation
  FilterDrawer.tsx          — slide-out filter panel
  SearchModal.tsx           — ⌘K full-text search modal
  DetailPanel.tsx           — right-side event detail panel
  TurnView.tsx              — turn renderer with all event block types
  ToolGroupAccordion.tsx    — collapsible tool call group accordion
  SubagentSectionView.tsx   — bordered subagent section wrapper
  session-view/
    types.ts                — shared interfaces (Turn, ToolCallGroup, TurnSection, etc.)
    helpers.ts              — format utils, getEventSummary, EVENT_TYPES constants
    agent-colors.ts         — AGENT_COLORS palette, getAgentColorSet
    grouping.ts             — turn and section grouping logic
    filtering.ts            — FilterCriteria, matchesFilters
```

## Data flow

- `SessionView` fetches data via TanStack Query hooks from `../api`
- All child components are pure — they receive props and emit callbacks; no hooks to the API layer
- `session-view/` contains only pure TypeScript (no React); safe to test without a DOM

## Styling

Tailwind CSS with a dark zinc palette. No custom CSS files — all styling is via utility classes.
