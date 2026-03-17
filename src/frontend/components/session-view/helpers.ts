import type {AgentNode, Event, EventType} from "#types"
import {SESSION_EVENT_TYPE, SESSION_EVENT_TYPE_VALUES} from "../../../lib/event-catalog"

export const EVENT_TYPES: EventType[] = [...SESSION_EVENT_TYPE_VALUES]

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
	[SESSION_EVENT_TYPE.USER_MESSAGE]: "user",
	[SESSION_EVENT_TYPE.ASSISTANT_MESSAGE]: "assistant",
	[SESSION_EVENT_TYPE.TOOL_USE]: "tool-use",
	[SESSION_EVENT_TYPE.TOOL_RESULT]: "result",
	[SESSION_EVENT_TYPE.THINKING]: "thinking",
	[SESSION_EVENT_TYPE.AGENT_SPAWN]: "spawn",
	[SESSION_EVENT_TYPE.SUMMARY]: "summary",
}

export const EVENT_TYPE_COLOR: Record<EventType, string> = {
	[SESSION_EVENT_TYPE.USER_MESSAGE]: "text-sky-400",
	[SESSION_EVENT_TYPE.ASSISTANT_MESSAGE]: "text-violet-400",
	[SESSION_EVENT_TYPE.TOOL_USE]: "text-amber-400",
	[SESSION_EVENT_TYPE.TOOL_RESULT]: "text-emerald-400",
	[SESSION_EVENT_TYPE.THINKING]: "text-fuchsia-400",
	[SESSION_EVENT_TYPE.AGENT_SPAWN]: "text-orange-400",
	[SESSION_EVENT_TYPE.SUMMARY]: "text-zinc-500",
}

export function formatTime(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
}

export function formatDateTime(date: Date): string {
	return `${date.toLocaleDateString("en-US", {month: "short", day: "numeric"})} ${formatTime(date)}`
}

export function formatProjectName(directory: string): string {
	const parts = directory.replace(/^-/, "").split("-")
	return parts.slice(-2).join("/")
}

export function getPlanHandoffSummary(event: Event): string | null {
	if (event.data.type !== SESSION_EVENT_TYPE.USER_MESSAGE || !event.data.planHandoff) return null
	const target = event.data.planHandoff.continuedSessionId?.slice(0, 14)
	return target ? `Plan continued in ${target}` : "Plan accepted, continued in a new session"
}

function getToolUseSummary(event: Event): string {
	if (event.data.type !== SESSION_EVENT_TYPE.TOOL_USE) return ""
	const {toolName, description, input} = event.data
	if (description) return `${toolName}: ${description}`

	const inp = input as Record<string, unknown>
	switch (toolName) {
		case "Read":
			if (inp.file_path) return `Read ${String(inp.file_path)}`
			break
		case "Bash":
			if (inp.command) {
				const cmd = String(inp.command)
				return `Bash: ${cmd.length > 80 ? `${cmd.slice(0, 80)}...` : cmd}`
			}
			break
		case "Edit":
		case "Write":
			if (inp.file_path) return `${toolName} ${String(inp.file_path)}`
			break
		case "Grep":
			if (inp.pattern) return `Grep: ${String(inp.pattern)}`
			break
		case "Glob":
			if (inp.pattern) return `Glob: ${String(inp.pattern)}`
			break
		case "WebSearch":
			if (inp.query) return `Search: ${String(inp.query)}`
			break
		case "WebFetch":
			if (inp.url) return `Fetch: ${String(inp.url)}`
			break
	}
	return toolName
}

function getToolResultSummary(event: Event): string {
	if (event.data.type !== SESSION_EVENT_TYPE.TOOL_RESULT) return ""
	const prefix = event.data.success ? "OK" : "ERR"
	const output = event.data.output
	const firstLine = output.split("\n")[0] ?? ""
	const preview = firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine
	return preview ? `${prefix}: ${preview}` : `${prefix} (${output.length.toLocaleString()} chars)`
}

export function getEventSummary(event: Event): string {
	switch (event.data.type) {
		case SESSION_EVENT_TYPE.USER_MESSAGE:
			return getPlanHandoffSummary(event) ?? event.data.text.slice(0, 120)
		case SESSION_EVENT_TYPE.ASSISTANT_MESSAGE:
			return event.data.text.slice(0, 120)
		case SESSION_EVENT_TYPE.TOOL_USE:
			return getToolUseSummary(event)
		case SESSION_EVENT_TYPE.TOOL_RESULT:
			return getToolResultSummary(event)
		case SESSION_EVENT_TYPE.THINKING:
			return event.data.content.slice(0, 80)
		case SESSION_EVENT_TYPE.AGENT_SPAWN:
			return event.data.description
		case SESSION_EVENT_TYPE.SUMMARY:
			return event.data.summary.slice(0, 120)
	}
}

/**
 * Returns descriptions of Task tool_use calls that don't yet have a corresponding
 * tool_result. Used to label in-progress agents before their tool_result arrives.
 */
export function getPendingTaskDescriptions(allEvents: Event[]): string[] {
	const completedToolUseIds = new Set<string>()
	for (const e of allEvents) {
		if (e.data.type === SESSION_EVENT_TYPE.TOOL_RESULT) {
			completedToolUseIds.add(e.data.toolUseId)
		}
	}
	const descriptions: string[] = []
	for (const e of allEvents) {
		if (
			e.data.type === SESSION_EVENT_TYPE.TOOL_USE &&
			(e.data.toolName === "Task" || e.data.toolName === "Agent") &&
			!completedToolUseIds.has(e.data.toolId) &&
			e.data.description
		) {
			descriptions.push(e.data.description)
		}
	}
	return descriptions
}

export function isAgentComplete(agentId: string, allEvents: Event[]): boolean {
	let lastResult: Event | undefined
	let lastResume: Event | undefined

	for (const e of allEvents) {
		if (e.data.type === SESSION_EVENT_TYPE.TOOL_RESULT && e.data.agentId === agentId) {
			if (!lastResult || e.timestamp > lastResult.timestamp) lastResult = e
		}
		if (e.data.type === SESSION_EVENT_TYPE.TOOL_USE && e.data.resumesAgentId === agentId) {
			if (!lastResume || e.timestamp > lastResume.timestamp) lastResume = e
		}
	}

	if (!lastResult) return false
	if (!lastResume) return true
	return lastResult.timestamp >= lastResume.timestamp
}

/**
 * Bucket a raw model string (e.g. "claude-sonnet-4-6[1m]") into a family name.
 * Returns null when the model string is missing or unrecognised.
 */
export function normalizeModelFamily(model: string | undefined | null): string | null {
	if (!model) return null
	const lower = model.toLowerCase()
	if (lower.includes("opus")) return "opus"
	if (lower.includes("sonnet")) return "sonnet"
	if (lower.includes("haiku")) return "haiku"
	return null
}

/**
 * Build a compact label like "haiku | explore" or just "opus".
 * Returns null when no model info is available.
 */
export function formatAgentModelLabel(
	model: string | undefined | null,
	subagentType: string | undefined | null,
): string | null {
	const family = normalizeModelFamily(model)
	if (!family && !subagentType) return null
	if (family && subagentType) return `${family} · ${subagentType}`
	return family ?? subagentType ?? null
}

/**
 * Resolve the model family for an event.
 * Checks event-level model first (assistant/user messages), then falls back to agent-level model.
 */
export function resolveEventModelFamily(event: Event, agents: AgentNode[]): string | null {
	const eventData = event.data
	if ("model" in eventData && eventData.model) {
		return normalizeModelFamily(eventData.model as string)
	}
	if (event.agentId) {
		const agent = agents.find((a) => a.id === event.agentId)
		if (agent?.model) return normalizeModelFamily(agent.model)
	}
	// Main agent (agentId is null) — check the first agent (root)
	if (event.agentId === null && agents.length > 0) {
		return normalizeModelFamily(agents[0]?.model)
	}
	return null
}

export function getEventSearchableText(event: Event): string {
	const parts = [getEventSummary(event), event.agentName ?? "", event.type]
	if (event.data.type === SESSION_EVENT_TYPE.USER_MESSAGE && event.data.planHandoff) {
		parts.push(event.data.planHandoff.plan)
		if (event.data.planHandoff.continuedSessionId) parts.push(event.data.planHandoff.continuedSessionId)
	}
	if (event.data.type === SESSION_EVENT_TYPE.TOOL_USE) {
		for (const value of Object.values(event.data.input)) {
			if (typeof value === "string") parts.push(value)
			else if (value != null) parts.push(JSON.stringify(value))
		}
	}
	return parts.join(" ").toLowerCase()
}
