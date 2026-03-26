import type {AgentNode, Event} from "#types"

export interface Turn {
	id: string
	kind: "user" | "assistant" | "agent-spawn"
	agentId: string | null
	agentName: string | null
	timestamp: Date
	events: Event[]
	summary: string
}

export interface ToolCallGroup {
	kind: "tool-group"
	events: Event[]
	toolNames: string[]
}

export interface SingleEvent {
	kind: "single"
	event: Event
}

export type TimelineItem = ToolCallGroup | SingleEvent

export interface MainTurnSection {
	kind: "main"
	turn: Turn
}

export interface SubagentSection {
	kind: "subagent"
	agentId: string
	agent: AgentNode | null
	turns: Turn[]
}

export type TurnSection = MainTurnSection | SubagentSection
