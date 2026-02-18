# Columns Design (`/columns`)

Three-panel explorer with per-agent drill-down. Uses the shared Header for session selection and shared filter infrastructure from `App.tsx`.

## Layout

Three panels side by side filling the viewport height:

1. **Left sidebar** (~250px, resizable) — Agent tree + event type filters + search
2. **Center panel** (flexible) — Event stream for the currently viewed agent
3. **Right panel** (~500px, resizable) — Full event details for the selected event

The right panel only appears when an event is selected. It slides in from the right with a resize handle.

## User behaviour

### Agent navigation (drill-down)

The user starts viewing the **main agent's events**. Sub-agent calls are not shown as individual events — instead they appear as distinctive **agent task cards** in the event stream.

An agent task card shows:
- A colored left border matching the sub-agent's color
- The agent's name and description
- A truncated preview of the prompt (input) and result (output)
- A "View agent events" button

Clicking the button or the card **drills into that sub-agent**, replacing the center panel with that agent's events. A **breadcrumb bar** appears at the top of the center panel showing the navigation path (e.g., "Main Agent > explorer-agent"). Each breadcrumb segment is clickable to navigate back up the hierarchy.

The left sidebar agent tree also supports drill-down — clicking any agent in the tree switches the center panel to that agent's events.

### Event display

Events for the currently viewed agent are displayed chronologically. They are processed into three kinds of display items:

- **Message events** (user-message, assistant-message, thinking, summary) — shown as individual rows with timestamp, type badge, and summary text
- **Tool pairs** — consecutive tool-use/tool-result events are grouped into compact two-line items showing the tool name, description, and result status on one line, with the result on the second line. Each line is independently clickable to open in the detail panel
- **Agent task cards** — tool calls that spawned sub-agents (described above)

Failed tool results have a red left border indicator and "Error" label.

### Detail panel

Clicking any event row opens the right panel showing full event content:
- Event metadata (agent name, timestamp, ID)
- Full content rendered appropriately per type (markdown for messages, JSON for tool input, raw text for tool output)
- Close button and Escape key to dismiss

### Filtering

The left sidebar contains:
- **Search box** at the top — filters events by text match against summary, agent name, or event type
- **Agent tree** — shows all agents with event counts; clicking drills into that agent
- **Event type checkboxes** — toggle visibility of specific event types. When none are active, all types are shown. When any are active, only those types appear. Visual treatment distinguishes "all shown" (moderate opacity) from "filter active" (selected bright, unselected dim)

Filtering is done through the shared `FilterState` managed by `App.tsx`. The agent filter and the drill-down view are separate concerns — drill-down determines which agent's events to show, while the shared filter narrows within that.

### Resize handles

The dividers between panels are draggable to resize. Left panel: 180–400px range. Right panel: 300–800px range.

## Props

Receives filtered events, agents, and filter callbacks from `App.tsx`. Also receives `baseFilteredEvents` (events filtered by text/type but not by agent) for accurate sidebar event counts that don't collapse when an agent is selected.

## File

`src/frontend/components/designs/ColumnsView.tsx`
