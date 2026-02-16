# Frontend (src/frontend/)

## Overview

React app for visualizing Claude Code session logs. Renders an interactive timeline with agent hierarchies and event details.

## Entry Points

- `index.html` — HTML entry point that imports the React app
- `frontend.tsx` — React DOM mounting with `QueryClientProvider`
- `App.tsx` — Main component with layout, selectors, and routing

## Features

1. **Directory/Session selector** — Dropdown UI in `Header` to browse and load sessions, with URL persistence (`?directory=<dir>&session=<path>`)
2. **GraphTimeline** — Main visualization showing events chronologically with agent context
3. **EventDetailsPanel** — Side panel displaying full event data when selected

## Files

- `App.tsx` — Main React component with selectors and layout
- `api.ts` — TanStack Query hooks and fetch helper
- `store.ts` — Client-side state management
- `index.css` — Styles
- `components/Header.tsx` — Directory/session selector dropdowns
- `components/GraphTimeline.tsx` — Timeline visualization
- `components/EventDetailsPanel.tsx` — Event detail side panel
- `components/EventList.tsx` — Event list within timeline
- `components/AgentTree.tsx` — Agent hierarchy tree view
- `components/MarkdownContent.tsx` — Markdown rendering

## Data Fetching

Uses TanStack Query (`@tanstack/react-query`) for all server communication. Query/mutation hooks are defined in `api.ts`. CLI-provided sessions are handled by a `useCliSession` hook that attempts to load `/api/session` without parameters.

## Key Patterns

- URL params drive session selection state — the URL is the source of truth for which directory/session is loaded
- Components consume SDK types (re-exported via `#types` alias from `src/types.ts`)
