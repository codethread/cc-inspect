import type {AgentNode, Event} from "#types"
import type {
	MainTurnSection,
	SingleEvent,
	SubagentSection,
	TimelineItem,
	ToolCallGroup,
	Turn,
	TurnSection,
} from "./types"

// Group events per agent first so that tool-use/result pairs from the same agent
// always land in the same turn, even when parallel agents interleave in allEvents.
// Sort turns by the position of their first event in the original events array —
// that array is already timestamp-sorted by the server, and integer index comparison
// avoids any Date rehydration / NaN issues.
//
// Task tool-results (data.agentId set) live in allEvents with agentId = subagentId
// (from entry.agentId in the JSONL), but logically belong to the main agent's flow.
// We route them to the main agent bucket so they pair with their Task tool-uses and
// don't create orphaned "0 tool calls" blocks in subagent sections.
export function groupIntoTurns(events: Event[], mainAgentId: string): Turn[] {
	const eventIndex = new Map<string, number>()
	events.forEach((e, i) => eventIndex.set(e.id, i))

	const byAgent = new Map<string | null, Event[]>()
	for (const event of events) {
		const isTaskResult = event.data.type === "tool-result" && Boolean(event.data.agentId)
		const key = isTaskResult ? mainAgentId : event.agentId
		const list = byAgent.get(key)
		if (list) list.push(event)
		else byAgent.set(key, [event])
	}

	const allTurns: Turn[] = []
	for (const agentEvents of byAgent.values()) {
		allTurns.push(...buildAgentTurns(agentEvents, mainAgentId))
	}

	return allTurns.sort((a, b) => {
		const aIdx = eventIndex.get(a.events[0]?.id ?? "") ?? 0
		const bIdx = eventIndex.get(b.events[0]?.id ?? "") ?? 0
		return aIdx - bIdx
	})
}

// Builds turns for a single agent's event list.
// For the main agent, splits after a batch of Task tool-results so subagent sections
// can interleave chronologically: task-uses + task-results stay in the same pre-split
// turn (keeping accordion pairing intact), and the main agent's continuation
// (thinking/assistant) starts a new turn whose sort position falls after subagents.
function buildAgentTurns(events: Event[], mainAgentId: string): Turn[] {
	const turns: Turn[] = []
	let current: Turn | null = null
	let pendingTaskResultSplit = false

	for (const event of events) {
		const isUserMsg = event.type === "user-message"
		const isSpawn = event.type === "agent-spawn"
		const isTaskResult = event.data.type === "tool-result" && Boolean(event.data.agentId)

		if (isUserMsg || isSpawn) {
			if (current) turns.push(current)
			pendingTaskResultSplit = false
			current = {
				id: event.id,
				kind: isUserMsg ? "user" : "agent-spawn",
				agentId: event.agentId,
				agentName: event.agentName,
				timestamp: event.timestamp,
				events: [event],
				summary:
					isUserMsg && event.data.type === "user-message"
						? event.data.text.slice(0, 80)
						: isSpawn && event.data.type === "agent-spawn"
							? `Agent: ${event.data.description}`
							: "",
			}
		} else {
			// After a batch of Task tool-results, split when the first non-task-result
			// arrives. This keeps task-use/result pairs together in the pre-split turn
			// and starts a new main-agent turn whose sort position falls after subagents.
			if (pendingTaskResultSplit && !isTaskResult && current && event.agentId === mainAgentId) {
				turns.push(current)
				current = null
				pendingTaskResultSplit = false
			}

			if (isTaskResult) pendingTaskResultSplit = true

			if (!current) {
				current = {
					id: event.id,
					kind: "assistant",
					agentId: event.agentId,
					agentName: event.agentName,
					timestamp: event.timestamp,
					events: [],
					summary: "",
				}
			}
			current.events.push(event)

			if (event.type === "assistant-message" && !current.summary && event.data.type === "assistant-message") {
				current.summary = event.data.text.slice(0, 80)
			}
		}
	}
	if (current) turns.push(current)
	return turns
}

// Consecutive tool-use/tool-result events are grouped together.
export function groupTurnEvents(turnEvents: Event[], pairedResultIds: Set<string>): TimelineItem[] {
	const items: TimelineItem[] = []
	let currentGroup: ToolCallGroup | null = null

	for (const event of turnEvents) {
		if (pairedResultIds.has(event.id)) continue

		const isToolEvent = event.type === "tool-use" || event.type === "tool-result"

		if (isToolEvent) {
			if (!currentGroup) {
				currentGroup = {kind: "tool-group", events: [], toolNames: []}
			}
			currentGroup.events.push(event)
			if (event.type === "tool-use" && event.data.type === "tool-use") {
				currentGroup.toolNames.push(event.data.toolName)
			}
		} else {
			if (currentGroup) {
				items.push(currentGroup)
				currentGroup = null
			}
			items.push({kind: "single", event} satisfies SingleEvent)
		}
	}
	if (currentGroup) items.push(currentGroup)
	return items
}

export function groupTurnsIntoSections(
	turns: Turn[],
	mainAgentId: string,
	agents: AgentNode[],
): TurnSection[] {
	const sections: TurnSection[] = []
	let current: SubagentSection | null = null

	for (const turn of turns) {
		const isMain = turn.agentId === mainAgentId || turn.agentId == null

		if (isMain) {
			if (current) {
				sections.push(current)
				current = null
			}
			sections.push({kind: "main", turn} satisfies MainTurnSection)
		} else {
			const agentId = turn.agentId
			if (current && current.agentId === agentId) {
				current.turns.push(turn)
			} else {
				if (current) sections.push(current)
				const agent = agents.find((a) => a.id === agentId) ?? null
				current = {kind: "subagent", agentId, agent, turns: [turn]}
			}
		}
	}
	if (current) sections.push(current)
	return sections
}
