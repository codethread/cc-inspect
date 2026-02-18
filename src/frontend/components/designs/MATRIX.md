# Matrix Design (`/matrix`)

Agent-column density grid with collapsible sub-agent sections and tool call pairing. Uses the shared Header for session selection and `SharedFilters` component for filtering.

## Layout

A vertical scrolling grid where each column represents an agent and time flows downward:

- **Time column** (far left, 64px) — monospace timestamps in tabular-nums
- **Agent columns** (one per agent, equal width, min 120px) — each column headed by the agent's name with a colored underline

Each row represents one event (or paired tool call). The event tile appears in its agent's column; other columns show empty cells with faint vertical borders to maintain the grid structure.

A sticky filter bar (`SharedFilters`) sits at the top. Column headers are sticky below it.

## User behaviour

### Sub-agent collapsing

Events from the **main agent** are always visible as grid rows. When the main agent spawns a sub-agent, a **collapsible agent banner** appears spanning the full grid width.

The banner shows:
- Agent color dot and name
- Description text
- Event count for that agent
- Error count (in red) if any tool calls failed
- A chevron indicating collapsed/expanded state

Sub-agents **start collapsed**. Clicking the banner toggles it open, revealing all of that sub-agent's events as grid rows below the banner. The expanded section has a subtle colored left border matching the agent.

### Tool call pairing

Consecutive tool-use and tool-result events are paired into a single row:
- Shows a tool glyph badge, tool name in monospace, description if available
- Success/error status indicator: green "OK" or red "ERR" badge
- Failed tool pairs get prominent red treatment: red left border, red background tint, red glyph badge

Unpaired tool events (orphaned use or result) display as individual rows.

### Event tiles

Each tile in the grid is a compact row showing:
- A single-character type glyph badge (U=user, A=assistant, T=thinking, F=tool-use, R=tool-result, S=spawn, Z=summary)
- Agent-colored left border
- Truncated summary text
- Row number on hover

### Inline detail expansion

Clicking any tile or tool pair expands a detail panel **below that grid row** (not in a side panel). Only one detail panel can be open at a time. The detail panel shows:
- Event type badge, timestamp, agent name
- Full event content (markdown for messages, JSON for tool input, raw text for output)
- For tool pairs: both input and output sections with labeled headers
- "ESC to close" hint

Escape closes the expanded detail. The panel auto-scrolls into view when opened.

### Filtering

The `SharedFilters` bar provides:
- Text search
- Agent filter chips (toggle to show only specific agents' events)
- Event type toggle badges

When filters are active, the grid only shows matching events. Empty agent columns still appear in the header.

## Props

Receives filtered events, agents, and filter callbacks from `App.tsx`. Does not receive `baseFilteredEvents` — the Matrix view doesn't have a sidebar with agent counts that need to survive agent filtering.

## File

`src/frontend/components/designs/MatrixView.tsx`
