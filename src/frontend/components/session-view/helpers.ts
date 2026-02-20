import type {Event, EventType} from "#types"

export const EVENT_TYPES: EventType[] = [
	"user-message",
	"assistant-message",
	"tool-use",
	"tool-result",
	"thinking",
	"agent-spawn",
	"summary",
]

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
	"user-message": "user",
	"assistant-message": "assistant",
	"tool-use": "tool-use",
	"tool-result": "result",
	thinking: "thinking",
	"agent-spawn": "spawn",
	summary: "summary",
}

export const EVENT_TYPE_COLOR: Record<EventType, string> = {
	"user-message": "text-sky-400",
	"assistant-message": "text-violet-400",
	"tool-use": "text-amber-400",
	"tool-result": "text-emerald-400",
	thinking: "text-fuchsia-400",
	"agent-spawn": "text-orange-400",
	summary: "text-zinc-500",
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

function getToolUseSummary(event: Event): string {
	if (event.data.type !== "tool-use") return ""
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
	if (event.data.type !== "tool-result") return ""
	const prefix = event.data.success ? "OK" : "ERR"
	const output = event.data.output
	const firstLine = output.split("\n")[0] ?? ""
	const preview = firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine
	return preview ? `${prefix}: ${preview}` : `${prefix} (${output.length.toLocaleString()} chars)`
}

export function getEventSummary(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return event.data.text.slice(0, 120)
		case "assistant-message":
			return event.data.text.slice(0, 120)
		case "tool-use":
			return getToolUseSummary(event)
		case "tool-result":
			return getToolResultSummary(event)
		case "thinking":
			return event.data.content.slice(0, 80)
		case "agent-spawn":
			return event.data.description
		case "summary":
			return event.data.summary.slice(0, 120)
	}
}

export function getEventSearchableText(event: Event): string {
	const parts = [getEventSummary(event), event.agentName ?? "", event.type]
	if (event.data.type === "tool-use") {
		for (const value of Object.values(event.data.input)) {
			if (typeof value === "string") parts.push(value)
			else if (value != null) parts.push(JSON.stringify(value))
		}
	}
	return parts.join(" ").toLowerCase()
}
