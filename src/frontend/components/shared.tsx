import type {AgentNode, Event, EventType} from "#types"

export function formatTime(date: Date | string | null | undefined): string {
	if (!date) return "00:00:00.000"
	const d = typeof date === "string" ? new Date(date) : date
	return d.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		fractionalSecondDigits: 3,
	})
}

export function getEventTypeBadgeClass(type: string): string {
	const classes: Record<string, string> = {
		"user-message": "bg-cyan-900 text-cyan-200",
		"assistant-message": "bg-purple-900 text-purple-200",
		thinking: "bg-purple-800 text-purple-200",
		"tool-use": "bg-blue-900 text-blue-200",
		"tool-result": "bg-green-900 text-green-200",
		"agent-spawn": "bg-yellow-900 text-yellow-200",
		summary: "bg-gray-700 text-gray-200",
	}
	return classes[type] || "bg-gray-700 text-gray-200"
}

export function getEventSummary(event: Event): string {
	const {data} = event

	switch (data.type) {
		case "user-message":
			return data.text.substring(0, 80) + (data.text.length > 80 ? "..." : "")
		case "assistant-message":
			return data.text.substring(0, 80) + (data.text.length > 80 ? "..." : "")
		case "thinking":
			return `Thinking: ${data.content.substring(0, 60)}...`
		case "tool-use":
			return `${data.toolName}${data.description ? `: ${data.description}` : ""}`
		case "tool-result":
			return `Result: ${data.success ? "success" : "error"} (${data.output.length} chars)`
		case "agent-spawn":
			return `Spawned: ${data.agentId}`
		case "summary":
			return data.summary
		default:
			return "Unknown event"
	}
}

export function renderEventContent(event: Event): React.ReactNode {
	const {data} = event

	switch (data.type) {
		case "user-message":
			return <div className="font-mono text-xs whitespace-pre-wrap">{data.text}</div>
		case "assistant-message":
			return <div className="whitespace-pre-wrap line-clamp-3">{data.text}</div>
		case "thinking":
			return (
				<div className="text-gray-400 italic line-clamp-2">
					<span className="text-purple-400">Thinking:</span> {data.content}
				</div>
			)
		case "tool-use":
			return (
				<div>
					<span className="text-blue-400 font-semibold">{data.toolName}</span>
					{data.description && <span className="text-gray-500 ml-2">- {data.description}</span>}
				</div>
			)
		case "tool-result":
			return (
				<div>
					<span className={data.success ? "text-green-400" : "text-red-400"}>
						{data.success ? "+" : "x"} Result
					</span>
					<span className="text-gray-500 ml-2">({data.output.length} chars)</span>
					{data.agentId && <span className="text-blue-400 ml-2">from agent</span>}
				</div>
			)
		case "agent-spawn":
			return (
				<div>
					<span className="text-yellow-400">Spawned:</span> {data.agentId}
				</div>
			)
		case "summary":
			return <div className="text-gray-400">{data.summary}</div>
		default:
			return <div className="text-gray-500">Unknown event type</div>
	}
}

export interface FilterState {
	agents: Set<string>
	eventTypes: Set<EventType>
	searchText: string
}

export function createEmptyFilters(): FilterState {
	return {
		agents: new Set(),
		eventTypes: new Set(),
		searchText: "",
	}
}

export function filterEvents(events: Event[], filters: FilterState): Event[] {
	return events.filter((event) => {
		if (filters.agents.size > 0 && event.agentId && !filters.agents.has(event.agentId)) {
			return false
		}
		if (filters.eventTypes.size > 0 && !filters.eventTypes.has(event.type)) {
			return false
		}
		if (filters.searchText) {
			const text = filters.searchText.toLowerCase()
			const summary = getEventSummary(event).toLowerCase()
			const agentName = (event.agentName || "").toLowerCase()
			if (!summary.includes(text) && !agentName.includes(text) && !event.type.includes(text)) {
				return false
			}
		}
		return true
	})
}

export function collectAllAgents(mainAgent: AgentNode): AgentNode[] {
	const agents: AgentNode[] = [mainAgent]
	function walk(node: AgentNode) {
		for (const child of node.children) {
			agents.push(child)
			walk(child)
		}
	}
	walk(mainAgent)
	return agents
}

export const ALL_EVENT_TYPES: EventType[] = [
	"user-message",
	"assistant-message",
	"tool-use",
	"tool-result",
	"thinking",
	"agent-spawn",
	"summary",
]

export const AGENT_COLORS: readonly string[] = [
	"rgb(34, 197, 94)",
	"rgb(59, 130, 246)",
	"rgb(168, 85, 247)",
	"rgb(236, 72, 153)",
	"rgb(251, 146, 60)",
	"rgb(14, 165, 233)",
	"rgb(245, 158, 11)",
	"rgb(139, 92, 246)",
] as const

export function getAgentColor(agents: AgentNode[], agentId: string | null): string {
	const index = agents.findIndex((a) => a.id === agentId)
	return (AGENT_COLORS[index >= 0 ? index % AGENT_COLORS.length : 0] ?? AGENT_COLORS[0]) as string
}
