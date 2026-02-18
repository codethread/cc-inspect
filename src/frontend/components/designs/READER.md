# Reader Design (`/reader`)

Structured document reader with conversational turn grouping, hierarchical outline, and always-visible detail panel. Fully self-contained — manages its own session selection, filtering, and layout without using the shared Header or filter infrastructure.

## Layout

Three-column layout filling the viewport:

1. **Outline sidebar** (left, ~240px, toggleable) — Hierarchical navigation showing user messages and agent interactions as an indented outline
2. **Timeline** (center, flexible, max-width ~768px centered) — Grouped event stream with progressive disclosure
3. **Detail panel** (right, 450px, always visible) — Full event details for the selected event

A compact header bar at the top contains the session picker, event count, outline toggle, error filter toggle, and filter drawer trigger.

## User behaviour

### Session selection

A compact session picker in the header. Clicking it opens a dropdown-style overlay listing directories and sessions. Selecting a session loads it. The picker also shows the current session ID.

### Outline navigation

The left sidebar shows an indented outline of the session:

- **Real human user messages** appear as top-level numbered items (bold, full width). These are messages where the agentId matches the main agent.
- **Sub-agent user messages** (where the main agent's prompt appears as a "user message" in the sub-agent's log) are indented with an arrow indicator and smaller text.
- **Agent-spawn events** appear indented with a colored dot matching the spawned agent.

An `IntersectionObserver` tracks which turn is currently visible in the timeline and highlights it in the outline. Clicking any outline item smooth-scrolls to that turn in the timeline.

### Turn grouping

Events are grouped into conversational **turns**. A turn starts with a user-message or agent-spawn and includes all subsequent events until the next turn boundary. Each turn shows:

- The originating event (user message or agent spawn) with agent indicator
- A summary line

Within each turn, events are further organized:

- **User messages**: Rendered as markdown, truncated to 3 lines with `line-clamp-3`. Click to view full content in the detail panel.
- **Assistant messages**: Rendered as markdown, truncated to 3 lines. Click to view full content in the detail panel.
- **Thinking blocks**: Collapsed by default with a chevron toggle. Can expand inline to preview, or click to view in detail panel.
- **Tool call groups**: Consecutive tool-use/tool-result events are grouped into an accordion (see below).
- **Agent spawns**: Shown as a distinctive section divider with agent name and description.
- **Summaries**: Shown as muted text blocks, truncated to 3 lines.

### Tool call grouping (accordions)

When an assistant makes multiple tool calls in sequence, they are grouped into a collapsible accordion:

- **Collapsed header**: Shows "N tool calls: Read, Bash, Edit" with a chevron. If any tool call failed, the header shows a red dot, red border, failure count in red, and "N failed" text.
- **Expanded state**: Each tool call appears as a compact row showing:
  - Tool name and a contextual summary (Read shows file path, Bash shows command, Grep shows pattern, etc.)
  - Success/error status
  - Failed rows get red left border, red background tint, and red tool name
- **Clicking a tool row**: Opens that event's full details in the right panel, including both the tool input and the linked tool result.

### Detail panel (always visible)

The right panel is always present:

- **When nothing is selected**: Shows a placeholder ("Select an event to view details") with keyboard hints
- **When an event is selected**: Shows full details including:
  - Event metadata (type badge, timestamp, agent name)
  - Full content rendered as markdown for messages, JSON for tool input, raw text for tool output
  - For tool-use events: automatically shows the linked tool-result below
  - Close button and Escape key to dismiss (returns to placeholder)

### Scroll position memory

When the user clicks an event, its ID is "pinned". If the user then changes filters (search text, event type, agent, error toggle), the timeline automatically scrolls back to the pinned event after re-rendering. This prevents losing your place when adjusting filters.

### Filtering

A slide-out filter drawer (triggered from the header) provides:

- **Text search** — matches against event summaries and agent names
- **Event type toggles** — buttons for each event type, with active count indicators
- **Agent selection** — colored buttons for each agent, active count
- **Errors only toggle** — when enabled, shows only failed tool-result events and their linked tool-use events. Also available as a red-tinted button in the header bar for quick access.

The header shows a small amber dot on the filter icon when any filter is active.

### Error visibility

Failed tool calls are visually prominent throughout:

- **In tool group accordions**: Red border, red dot in header, failure count, red "ERR" labels on individual rows
- **In standalone tool results**: Red accent border and dot indicator
- **In the errors-only filter**: One-click to see all failures in the session, with a count badge

### Keyboard interaction

- **Escape**: Closes the detail panel, filter drawer, or session picker (in that priority order)

## Props

None — this component is fully self-contained. It calls API hooks directly (`useDirectories`, `useSessions`, `useSessionData`, `useCliSession`) and manages all state internally.

## File

`src/frontend/components/designs/V10App.tsx`
