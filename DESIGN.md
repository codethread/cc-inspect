# SessionView Design

Structured document reader with conversational turn grouping, hierarchical outline, and always-visible detail panel. Fully self-contained — manages its own session selection, filtering, and layout.

## Layout

Three-column layout filling the viewport:

1. **Outline sidebar** (left, toggleable, resizable) — Hierarchical navigation showing user messages and agent interactions as an indented outline
2. **Timeline** (center, flexible, max-width ~768px centered) — Grouped event stream with progressive disclosure
3. **Detail panel** (right, always visible, resizable) — Full event details for the selected event

A compact header bar at the top contains the session picker, event count, outline toggle, error filter toggle, search button, tool-collapse toggle, filter drawer trigger, and keyboard shortcuts config button.

## File structure

```
src/frontend/components/
  SessionView.tsx           — main component and state management
  SessionPicker.tsx         — session/project dropdown in the header
  Outline.tsx               — left sidebar navigation
  FilterDrawer.tsx          — slide-out filter panel
  SearchModal.tsx           — ⌘K full-text search modal
  DetailPanel.tsx           — right-side event detail panel
  TurnView.tsx              — turn renderer with all event block types
  ToolGroupAccordion.tsx    — collapsible tool call group accordion
  SubagentSectionView.tsx   — bordered subagent section wrapper
  KeyboardShortcutsModal.tsx — configurable keybindings UI (recording + localStorage persist)
  session-view/
    types.ts                — Turn, ToolCallGroup, TurnSection interfaces
    helpers.ts              — format utils, getEventSummary, EVENT_TYPES, EVENT_TYPE_LABEL/COLOR
    agent-colors.ts         — AGENT_COLORS palette, getAgentColorSet
    grouping.ts             — groupIntoTurns, buildAgentTurns, groupTurnEvents, groupTurnsIntoSections
    filtering.ts            — FilterCriteria, matchesFilters
```

## User behaviour

### Session selection

A compact session picker in the header. Clicking it opens a dropdown-style overlay listing directories and sessions. Selecting a session loads it. The picker shows the current project and session ID.

### Outline navigation

The left sidebar shows an indented outline of the session:

- **Real human user messages** appear as top-level numbered items. These are messages where the agentId matches the main agent.
- **Sub-agent user messages** (where the main agent's prompt appears as a "user message" in the sub-agent's log) are indented with an arrow indicator and smaller text.
- **Agent-spawn events** appear indented with a colored dot matching the spawned agent.

An `IntersectionObserver` tracks which turn is currently visible in the timeline and highlights it in the outline. Clicking any outline item smooth-scrolls to that turn in the timeline.

### Subagent grouping

When a session includes sub-agents (spawned via the Task tool), their events are visually grouped into bordered, indented sections distinct from the main agent's flow.

Each subagent section:
- Has a **coloured header** showing the agent's description (from the Task tool call), falling back to name, subagentType, then truncated ID
- Is **indented** with a left margin and a rounded border in the agent's colour
- Contains all turns belonging to that agent

**Ordering**: subagent sections are interleaved chronologically with main-agent turns. The main agent's turn is split just before it resumes after receiving the subagent's result, so the section appears between the Task tool-calls and the main agent's continuation. Parallel subagents appear in the order their events start.

**Parallel agents**: when multiple subagents run concurrently, their events are separated by agent before grouping so that tool-use/result pairs from the same agent always land in the same turn, regardless of how the events interleave by timestamp in the session log.

### Turn grouping

Events are grouped into conversational **turns** per agent. A turn starts with a user-message or agent-spawn and includes all subsequent events until the next turn boundary.

Within each turn, events are organized:

- **User messages**: Rendered as plain text, truncated to 3 lines with `line-clamp-3`. Click to view full content in the detail panel.
- **Assistant messages**: Truncated to 3 lines. Click to view full content in the detail panel.
- **Thinking blocks**: Shown as a muted italic single line. Click to view full content in the detail panel.
- **Tool call groups**: Consecutive tool-use/tool-result events are grouped into an accordion (see below).
- **Agent spawns**: Shown as a distinctive orange-tinted card with agent description.
- **Summaries**: Shown as muted text blocks, truncated to 3 lines.

### Tool call grouping (accordions)

Consecutive tool-use/tool-result events within a turn are grouped into a collapsible accordion:

- **Collapsed header**: Shows "N tool calls: Read, Bash, Edit" with a chevron. If any tool call failed, the header shows a red dot, red border, failure count in red, and "N failed" text.
- **Expanded state**: Each tool call appears as a compact row showing tool name, a contextual summary (Read → file path, Bash → command, Grep → pattern, etc.), and success/error status. Failed rows get a red left border, red background tint, and red tool name.
- The global **collapse/expand all** button in the header sets the default state for all accordions at once.
- **Clicking a tool row**: Opens that event's full details in the right panel, including both the tool input and the linked tool result.

### Detail panel (always visible)

The right panel is always present:

- **When nothing is selected**: Shows a placeholder with instructions
- **When an event is selected**: Shows full details including:
  - Event metadata (agent name, timestamp)
  - Header `copy id` action for the selected event ID
  - A help popover next to `copy id` with an event-specific `jq` command targeting the current session file, plus a copy action for that command
  - Copy icons next to each displayed detail block (message markdown, tool JSON input, tool output, summaries, prompts, etc.) so each block can be copied independently
  - Full content rendered as markdown for messages, JSON for tool input, raw text for tool output
  - For tool-use events: automatically shows the linked tool-result below
  - For tool-result events: shows the linked tool-use input above
  - Escape key to dismiss (returns to placeholder)

### Resizable side panels

The outline and detail side panels have draggable vertical resize handles:

- Dragging a handle sets a **fixed width** for that panel at the current viewport breakpoint.
- Breakpoints are `small`, `medium`, and `large`, based on viewport width.
- Each breakpoint keeps its own saved widths for both panels in `localStorage` under `cc-inspect-panel-sizes`.
- On first use (or when no saved width is available), each panel starts at a breakpoint-specific default size.
- If a breakpoint has no saved width, resolution uses fallback order:
  - check the current breakpoint first
  - then check the next **lower** breakpoint
  - then wrap around to the remaining breakpoint
  - Example: at `medium`, fallback order is `medium → small → large`.
- Saved widths are clamped to panel-specific min/max bounds per breakpoint before being applied.

### Scroll position memory

When the user clicks an event, its ID is "pinned". If the user then changes filters, the timeline automatically scrolls back to the pinned event after re-rendering. This prevents losing your place when adjusting filters.

### Filtering

A slide-out filter drawer (triggered from the header) provides:

- **Text search** — matches against event summaries, agent names, event types, and tool input values (bash commands, file paths, grep patterns, etc.)
- **Event type toggles** — include (focus) or exclude (hide) specific event types independently
- **Agent selection** — filter events to specific agents
- **Errors only toggle** — shows only failed tool-result events and their linked tool-use events. Also available as a red-tinted button in the header for quick access.

The header filter icon turns amber when any filter is active.

### Error visibility

Failed tool calls are visually prominent throughout:

- **In tool group accordions**: Red border, red dot in header, failure count, red "ERR" labels on individual rows
- **In standalone tool results**: Red accent border and dot indicator
- **In the errors-only filter**: One-click to see all failures in the session

### Search modal (⌘K)

Pressing `⌘K` (or `Ctrl+K`) opens a full-text search modal over all events in the session.

The modal has a two-panel layout:
- **Left**: text input (auto-focused), event type filter chips, results list with time/type/summary columns
- **Right**: full detail panel preview for the highlighted result

Keyboard interaction within the modal:
- `↑` / `↓`: navigate the result list
- `↵`: jump to the event in the timeline (clears filters, scrolls to the event)
- `Escape`: close the modal

Results are capped at 300 to maintain responsiveness.

### Keyboard shortcuts

Default bindings (all configurable except Escape):

| Action | Default | Description |
|--------|---------|-------------|
| Open search | `⌘K` | Open the full-text event search modal |
| Toggle outline | `⌘⇧O` | Show or hide the left outline sidebar |
| Open filters | `⌘⇧F` | Open the filter drawer |
| Toggle tool calls | `⌘⇧T` | Collapse or expand all tool call groups |
| Escape | *(not configurable)* | Close the search modal, filter drawer, or dismiss the selected event (in that priority order) |

All configurable bindings have their current shortcut reflected in the tooltip of the corresponding header button.

### Keyboard shortcut configuration

A keyboard icon button at the far right of the header opens a **Keyboard shortcuts** modal listing all configurable bindings. Each row shows the action label, description, and the current key combination as a clickable button.

**Recording a new shortcut:**
1. Click the shortcut button for any action — it enters recording mode showing "Press keys…"
2. Press the desired key combination (e.g. `⌘⇧P`)
3. The live display updates as keys are detected
4. Click **Save** to apply the new binding (or **Cancel** to discard)

**Resetting:** A **Reset** link appears next to any customised binding. **Reset all** in the modal header reverts everything to defaults.

Custom bindings are persisted in `localStorage` under the key `cc-inspect-keybindings`, so they survive page reloads.

## Props

None — `SessionView` is fully self-contained. It calls API hooks directly (`useDirectories`, `useSessions`, `useSessionData`, `useCliSession`) and manages all state internally.
