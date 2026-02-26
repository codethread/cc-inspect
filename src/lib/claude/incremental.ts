// Incremental parser for streaming JSONL parsing
// Processes new lines as they arrive without re-parsing the entire file

import {extractAgentInfo, normalizeToolUseResult, parseEvents} from "./parser"
import type {AgentNode, Event, LogEntry, SessionData} from "./types"
import {LogEntrySchema} from "./types"

export interface IncrementalParseState {
	sessionId: string
	knownAgentIds: Set<string>
	mainLogEntries: LogEntry[]
	mainAgent: AgentNode
	lineCountPerFile: Map<string, number>
}

/**
 * Creates an IncrementalParseState from an existing SessionData (for snapshot→streaming handoff).
 *
 * `mainLogEntries` starts empty — entries from the initial parse are not available
 * since SessionData only contains parsed Events. As new lines arrive during tailing,
 * they accumulate here. For agents already known from the snapshot, their info is
 * already in `mainAgent.children`. For NEW agents discovered during tailing,
 * `extractAgentInfo` searches only accumulated entries — which should contain both the
 * tool_use and tool_result for new agents since they arrive together.
 */
export function createParseStateFromSession(
	sessionData: SessionData,
	mainLogLineCount: number,
	agentLineCounts: Map<string, number>,
): IncrementalParseState {
	const knownAgentIds = new Set<string>()
	for (const child of sessionData.mainAgent.children) {
		knownAgentIds.add(child.id)
	}

	const lineCountPerFile = new Map<string, number>()
	lineCountPerFile.set(sessionData.mainAgent.logPath, mainLogLineCount)
	for (const [agentId, count] of agentLineCounts) {
		// Find the child with this agentId to get its logPath
		const child = sessionData.mainAgent.children.find((c: AgentNode) => c.id === agentId)
		if (child) {
			lineCountPerFile.set(child.logPath, count)
		}
	}

	return {
		sessionId: sessionData.sessionId,
		knownAgentIds,
		mainLogEntries: [],
		mainAgent: sessionData.mainAgent,
		lineCountPerFile,
	}
}

/**
 * Parse raw JSONL lines into LogEntry objects.
 * Never throws — all errors are captured in the errors array.
 */
export function parseLines(
	lines: string[],
	filePath: string,
	startLineNumber: number,
): {entries: LogEntry[]; errors: Array<{line: number; error: string}>} {
	const entries: LogEntry[] = []
	const errors: Array<{line: number; error: string}> = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (!line) continue
		const lineNumber = startLineNumber + i

		try {
			const parsed = JSON.parse(line)
			const result = LogEntrySchema.safeParse(parsed)

			if (!result.success) {
				errors.push({
					line: lineNumber,
					error: `${filePath}:${lineNumber}: Schema validation failed: ${result.error.message}`,
				})
				continue
			}

			entries.push(result.data)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			errors.push({
				line: lineNumber,
				error: `${filePath}:${lineNumber}: JSON parse failed: ${message}`,
			})
		}
	}

	return {entries, errors}
}

/**
 * Process new entries from the main session log.
 * Mutates state: appends to mainLogEntries, adds to knownAgentIds.
 */
export function processMainEntries(
	entries: LogEntry[],
	state: IncrementalParseState,
): {events: Event[]; newAgentIds: string[]} {
	// Append to accumulated entries for future extractAgentInfo calls
	state.mainLogEntries.push(...entries)

	// Convert to events
	const events = parseEvents(entries, state.sessionId, null)

	// Scan for newly discovered agent IDs
	const newAgentIds: string[] = []
	for (const entry of entries) {
		const result = normalizeToolUseResult(entry.toolUseResult)
		if (result?.agentId && !state.knownAgentIds.has(result.agentId)) {
			newAgentIds.push(result.agentId)
			state.knownAgentIds.add(result.agentId)
		}
	}

	return {events, newAgentIds}
}

/**
 * Process new entries from an agent's log file.
 */
export function processAgentEntries(
	entries: LogEntry[],
	agentId: string,
	state: IncrementalParseState,
): Event[] {
	return parseEvents(entries, state.sessionId, agentId)
}

/**
 * Build an AgentNode for a newly discovered agent.
 * Uses accumulated mainLogEntries to extract agent metadata.
 */
export function buildAgentNode(agentId: string, state: IncrementalParseState): AgentNode {
	const agentInfo = extractAgentInfo(state.mainLogEntries, agentId)

	return {
		id: agentId,
		name: agentInfo.name,
		model: agentInfo.model,
		subagentType: agentInfo.subagentType,
		description: agentInfo.description,
		parent: state.sessionId,
		children: [],
		events: [],
		logPath: "",
		isResumed: agentInfo.isResumed,
		resumedFrom: agentInfo.resumedFrom,
	}
}
