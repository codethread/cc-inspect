// Parser for Claude Code session logs

import {dirname, join} from "node:path"
import {CLAUDE_CONTENT_TYPE, CLAUDE_LOG_ENTRY_TYPE, SESSION_EVENT_TYPE} from "./event-catalog"
import {ParseError} from "./errors"
import type {
	AgentNode,
	Event,
	EventType,
	LogEntry,
	PlanHandoffData,
	SessionData,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
	ToolUseResult,
} from "./types"
import {LogEntrySchema} from "./types"

/** Abstraction over file reading for testability */
export interface FileReader {
	readText(path: string): Promise<string>
	exists(path: string): Promise<boolean>
	listDir(path: string): Promise<string[]>
}

/** Default implementation using Bun.file */
export const bunFileReader: FileReader = {
	async readText(path: string) {
		return Bun.file(path).text()
	},
	async exists(path: string) {
		return Bun.file(path).exists()
	},
	async listDir(path: string) {
		return Array.fromAsync(new Bun.Glob("*").scan(path))
	},
}

export async function parseSessionLogs(
	sessionFilePath: string,
	sessionAgentDir: string,
	reader: FileReader,
): Promise<SessionData> {
	const sessionId = extractSessionId(sessionFilePath)

	// Parse main session log
	const mainLogEntries = await parseJsonlFile(sessionFilePath, reader)
	const planHandoffs = await detectPlanHandoffs(sessionFilePath, mainLogEntries, reader)

	// Find sub-agent logs that are referenced in this session
	const agentLogs = await findAgentLogs(sessionAgentDir, mainLogEntries, reader)

	// Build agent tree
	const mainAgent = await buildAgentTree({
		sessionId,
		mainLogEntries,
		agentLogs,
		sessionFilePath,
		reader,
		planHandoffs,
	})

	// Extract all events chronologically
	const allEvents = extractAllEvents(mainAgent)

	return {
		sessionId,
		mainAgent,
		allEvents,
		logDirectory: sessionFilePath.split("/").slice(0, -1).join("/"),
	}
}

export async function parseJsonlFile(filePath: string, reader: FileReader): Promise<LogEntry[]> {
	const content = await reader.readText(filePath)

	const lines = content.split("\n").filter((line) => line.trim())
	const entries: LogEntry[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (!line) continue // Type guard for TypeScript
		const lineNumber = i + 1

		try {
			// First parse JSON
			const parsed = JSON.parse(line)

			// Then validate with Zod
			const result = LogEntrySchema.safeParse(parsed)

			if (!result.success) {
				throw new ParseError({
					message: `Failed to validate log entry against schema`,
					filePath,
					lineNumber,
					rawLine: line,
					zodError: result.error,
				})
			}

			entries.push(result.data)
		} catch (error: unknown) {
			// If it's already a ParseError, rethrow it
			if (error instanceof ParseError) {
				throw error
			}

			// If it's a JSON parse error, wrap it
			if (error instanceof SyntaxError) {
				throw new ParseError({
					message: `Failed to parse JSON: ${error.message}`,
					filePath,
					lineNumber,
					rawLine: line,
				})
			}

			// Unknown error
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new ParseError({
				message: `Unexpected error: ${errorMessage}`,
				filePath,
				lineNumber,
				rawLine: line,
			})
		}
	}

	return entries
}

export function extractSessionId(logPath: string): string {
	const filename = logPath.split("/").pop() || ""
	return filename.replace(".jsonl", "")
}

/**
 * Normalizes toolUseResult to a single object.
 * If it's an array, returns the first element.
 * If it's a string, returns undefined.
 * If it's an object, returns it as-is.
 */
export function normalizeToolUseResult(toolUseResult: LogEntry["toolUseResult"]): ToolUseResult | undefined {
	if (!toolUseResult || typeof toolUseResult === "string") {
		return undefined
	}
	return Array.isArray(toolUseResult) ? toolUseResult[0] : toolUseResult
}

interface DetectedPlanHandoff extends PlanHandoffData {
	exitPlanEntryId: string
	rejectionEntryId?: string
	// Real UUID when the session was interrupted; synthetic "__plan_end_<uuid>" sentinel
	// when the plan was accepted externally (no interruption message in this session).
	interruptionEntryId: string
}

function extractTextParts(entry: LogEntry): string[] {
	if (!entry.message) return []
	if (typeof entry.message.content === "string") return [entry.message.content]
	return entry.message.content
		.filter((item) => item.type === CLAUDE_CONTENT_TYPE.TEXT)
		.map((item) => (item as TextContent).text)
}

function extractExitPlanToolUse(entry: LogEntry): ToolUseContent | undefined {
	if (
		entry.type !== CLAUDE_LOG_ENTRY_TYPE.ASSISTANT ||
		!entry.message ||
		!Array.isArray(entry.message.content)
	) {
		return undefined
	}

	return entry.message.content.find(
		(item): item is ToolUseContent =>
			item.type === CLAUDE_CONTENT_TYPE.TOOL_USE && item.name === "ExitPlanMode",
	)
}

function extractMatchingToolResult(entry: LogEntry, toolUseId: string): ToolResultContent | undefined {
	if (entry.type !== CLAUDE_LOG_ENTRY_TYPE.USER || !entry.message || !Array.isArray(entry.message.content)) {
		return undefined
	}

	return entry.message.content.find(
		(item): item is ToolResultContent =>
			item.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT && item.tool_use_id === toolUseId,
	)
}

function isInterruptedToolUseMessage(entry: LogEntry): boolean {
	return extractTextParts(entry).some((text) => text.startsWith("[Request interrupted by user"))
}

function extractPlanContentFromContinuation(entry: LogEntry): string | undefined {
	if (entry.planContent) return entry.planContent
	if (entry.type !== CLAUDE_LOG_ENTRY_TYPE.USER || !entry.message) return undefined
	if (typeof entry.message.content !== "string") return undefined

	const prefix = "Implement the following plan:\n\n"
	return entry.message.content.startsWith(prefix) ? entry.message.content.slice(prefix.length) : undefined
}

/**
 * Returns true when a candidate's plan and promptId are compatible with a
 * potential continuation entry. Requires exact promptId match when both sides
 * carry one; falls back to plan-content-only when neither does. Rejects
 * mismatched presence (one has, one doesn't) to avoid false associations.
 */
function planMatchesCandidate(
	candidate: Pick<DetectedPlanHandoff, "plan" | "promptId">,
	planContent: string,
	entryPromptId: string | undefined,
): boolean {
	if (candidate.plan !== planContent) return false
	if (candidate.promptId && entryPromptId) return candidate.promptId === entryPromptId
	// Only match on content alone when neither side has a promptId
	return !candidate.promptId && !entryPromptId
}

async function detectPlanHandoffs(
	sessionFilePath: string,
	mainLogEntries: LogEntry[],
	reader: FileReader,
): Promise<Map<string, DetectedPlanHandoff>> {
	const candidates: DetectedPlanHandoff[] = []

	for (let i = 0; i < mainLogEntries.length; i++) {
		const entry = mainLogEntries[i]
		if (!entry?.uuid) continue

		const exitPlanToolUse = extractExitPlanToolUse(entry)
		const plan = typeof exitPlanToolUse?.input.plan === "string" ? exitPlanToolUse.input.plan : undefined
		if (!exitPlanToolUse || !plan) continue

		let rejectionEntryId: string | undefined
		let interruptionEntryId: string | undefined
		let promptId: string | undefined

		for (let j = i + 1; j < mainLogEntries.length; j++) {
			const next = mainLogEntries[j]
			if (!next?.uuid) continue

			const matchingResult = extractMatchingToolResult(next, exitPlanToolUse.id)
			if (matchingResult?.is_error) {
				rejectionEntryId = next.uuid
				promptId ??= next.promptId
				continue
			}

			if (isInterruptedToolUseMessage(next)) {
				interruptionEntryId = next.uuid
				promptId ??= next.promptId
				break
			}
		}

		// When there's no interruption entry the user accepted the plan externally
		// (e.g. started a new session manually). Use a synthetic key so we can still
		// detect and link the continuation session below.
		const effectiveInterruptionId = interruptionEntryId ?? `__plan_end_${entry.uuid}`

		candidates.push({
			exitPlanEntryId: entry.uuid,
			rejectionEntryId,
			interruptionEntryId: effectiveInterruptionId,
			plan,
			promptId,
		})
	}

	if (candidates.length === 0) return new Map()

	const directory = dirname(sessionFilePath)
	const files = await reader.listDir(directory)
	const siblingSessionPaths = files
		.filter((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))
		.map((file) => join(directory, file))
		.filter((path) => path !== sessionFilePath)

	const matches = new Map<string, {sessionId: string; sessionFilePath: string; timestamp: number}>()

	for (const siblingSessionPath of siblingSessionPaths) {
		let siblingEntries: LogEntry[]
		try {
			siblingEntries = await parseJsonlFile(siblingSessionPath, reader)
		} catch {
			continue
		}

		const continuationEntry = siblingEntries.find((entry) => {
			const planContent = extractPlanContentFromContinuation(entry)
			if (!planContent) return false
			return candidates.some((candidate) => planMatchesCandidate(candidate, planContent, entry.promptId))
		})

		if (!continuationEntry?.timestamp) continue
		const planContent = extractPlanContentFromContinuation(continuationEntry)
		if (!planContent) continue

		// Prefer an exact promptId+plan match; only fall back to plan-only when
		// neither side carries a promptId (older Claude Code sessions).
		// For the content-only fallback, use findLast so that when multiple
		// same-plan candidates lack promptIds the latest handoff attempt wins.
		const candidate =
			candidates.find(
				(item) =>
					item.plan === planContent &&
					item.promptId &&
					continuationEntry.promptId &&
					item.promptId === continuationEntry.promptId,
			) ?? candidates.findLast((item) => planMatchesCandidate(item, planContent, continuationEntry.promptId))
		if (!candidate) continue

		const timestamp = new Date(continuationEntry.timestamp).getTime()
		const existing = matches.get(candidate.interruptionEntryId)
		if (existing && existing.timestamp <= timestamp) continue

		matches.set(candidate.interruptionEntryId, {
			sessionId: extractSessionId(siblingSessionPath),
			sessionFilePath: siblingSessionPath,
			timestamp,
		})
	}

	return new Map(
		candidates.map((candidate) => [
			candidate.interruptionEntryId,
			{
				...candidate,
				continuedSessionId: matches.get(candidate.interruptionEntryId)?.sessionId,
				continuedSessionPath: matches.get(candidate.interruptionEntryId)?.sessionFilePath,
			},
		]),
	)
}

export async function findAgentLogs(
	sessionAgentDir: string,
	mainLogEntries: LogEntry[],
	reader: FileReader,
): Promise<Map<string, string>> {
	// Extract agent IDs that were actually spawned in this session
	const agentIds = new Set<string>()

	for (const entry of mainLogEntries) {
		// Check toolUseResult for agentId
		const result = normalizeToolUseResult(entry.toolUseResult)
		if (result?.agentId) {
			agentIds.add(result.agentId)
		}

		// Also check message content for Task tool results
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.USER && entry.message?.content) {
			const content = Array.isArray(entry.message.content) ? entry.message.content : []
			for (const item of content) {
				if (item.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT) {
					// For tool results from Task tool, agentId is in toolUseResult
					const result = normalizeToolUseResult(entry.toolUseResult)
					if (result?.agentId) {
						agentIds.add(result.agentId)
					}
				}
			}
		}
	}

	// Load agent logs from the session-specific subagents directory
	const agentLogs = new Map<string, string>()
	for (const agentId of agentIds) {
		const logPath = join(sessionAgentDir, `agent-${agentId}.jsonl`)
		try {
			const exists = await reader.exists(logPath)
			if (exists) {
				agentLogs.set(agentId, logPath)
			} else {
				console.warn(`Warning: Agent log file not found for agent ${agentId}`)
			}
		} catch {
			console.warn(`Warning: Could not access agent log file for agent ${agentId}`)
		}
	}

	return agentLogs
}

/**
 * Extract the model from the main agent's first assistant message
 */
export function extractMainAgentModel(logEntries: LogEntry[]): string | undefined {
	for (const entry of logEntries) {
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.ASSISTANT && entry.message?.model) {
			return entry.message.model
		}
	}
	return undefined
}

async function buildAgentTree(options: {
	sessionId: string
	mainLogEntries: LogEntry[]
	agentLogs: Map<string, string>
	sessionFilePath: string
	reader: FileReader
	planHandoffs: Map<string, DetectedPlanHandoff>
}): Promise<AgentNode> {
	const {sessionId, mainLogEntries, agentLogs, sessionFilePath, reader, planHandoffs} = options

	// Extract model from the first assistant message
	const mainModel = extractMainAgentModel(mainLogEntries)

	// Create main agent node
	const mainAgent: AgentNode = {
		id: sessionId,
		name: "Main Agent",
		model: mainModel,
		parent: null,
		children: [],
		events: parseEvents(mainLogEntries, {sessionId, agentId: null, planHandoffs}),
		logPath: sessionFilePath,
	}

	// Parse sub-agent logs and add as children
	for (const [agentId, logPath] of agentLogs) {
		const agentEntries = await parseJsonlFile(logPath, reader)
		const agentInfo = extractAgentInfo(mainLogEntries, agentId)

		// Extract model from agent's own log (first assistant message)
		const agentModel = extractMainAgentModel(agentEntries)

		// Parse events from agent file
		const agentFileEvents = parseEvents(agentEntries, {sessionId, agentId})

		// Also parse events from session log that belong to this agent (for resumed agents)
		const sessionAgentEvents = parseSessionEventsForAgent(mainLogEntries, sessionId, agentId)

		// Combine and sort events
		const allAgentEvents = [...agentFileEvents, ...sessionAgentEvents].sort(
			(a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
		)

		const agentNode: AgentNode = {
			id: agentId,
			name: agentInfo.name,
			model: agentModel,
			subagentType: agentInfo.subagentType,
			description: agentInfo.description,
			parent: sessionId,
			children: [],
			events: allAgentEvents,
			logPath,
			isResumed: agentInfo.isResumed,
			resumedFrom: agentInfo.resumedFrom,
			totalTokens: agentInfo.totalTokens,
		}

		mainAgent.children.push(agentNode)
	}

	return mainAgent
}

interface AgentInfo {
	name: string | null
	model?: string
	subagentType?: string
	description?: string
}

interface ExtendedAgentInfo extends AgentInfo {
	isResumed?: boolean
	resumedFrom?: string
	totalTokens?: number
}

export function extractAgentInfo(logEntries: LogEntry[], agentId: string): ExtendedAgentInfo {
	// Find all result entries for this agent (multiple for resumed agents)
	const resultEntries = logEntries.filter((e) => {
		if (e.type !== CLAUDE_LOG_ENTRY_TYPE.USER) return false
		const result = normalizeToolUseResult(e.toolUseResult)
		return result?.agentId === agentId
	})

	const resultEntry = resultEntries[0]
	const normalizedResult = resultEntry ? normalizeToolUseResult(resultEntry.toolUseResult) : undefined

	if (!resultEntry || !normalizedResult) {
		return {name: agentId}
	}

	// Sum totalTokens across all invocations (initial + resumes)
	let totalTokens: number | undefined
	for (const entry of resultEntries) {
		const result = normalizeToolUseResult(entry.toolUseResult)
		if (result?.totalTokens != null) {
			totalTokens = (totalTokens ?? 0) + result.totalTokens
		}
	}

	// Find the tool_result in the message content to get the tool_use_id
	let toolUseId: string | undefined
	if (resultEntry.message?.content && Array.isArray(resultEntry.message.content)) {
		for (const item of resultEntry.message.content) {
			if (item.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT) {
				const toolResult = item as ToolResultContent
				toolUseId = toolResult.tool_use_id
				break
			}
		}
	}

	if (!toolUseId) {
		// Fallback to basic info from toolUseResult
		const shortName = normalizedResult.prompt?.substring(0, 50) || null
		return {
			name: shortName,
			model: undefined,
			description: shortName,
			totalTokens,
		}
	}

	// Now find the assistant message that contains the matching tool_use
	for (const entry of logEntries) {
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.ASSISTANT && entry.message?.content) {
			const content = Array.isArray(entry.message.content) ? entry.message.content : []
			for (const item of content) {
				if (
					item.type === CLAUDE_CONTENT_TYPE.TOOL_USE &&
					item.id === toolUseId &&
					(item.name === "Task" || item.name === "Agent")
				) {
					const toolUse = item as ToolUseContent
					// Check if this is a resume call
					const isResume = "resume" in toolUse.input
					const resumesAgentId = isResume ? (toolUse.input.resume as string) : undefined
					const shortDescription = (toolUse.input.description as string) || null

					return {
						name: shortDescription,
						model: toolUse.input.model as string | undefined,
						subagentType: toolUse.input.subagent_type as string | undefined,
						description: shortDescription,
						isResumed: isResume && resumesAgentId === agentId,
						resumedFrom: isResume && resumesAgentId === agentId ? toolUse.id : undefined,
						totalTokens,
					}
				}
			}
		}
	}

	// Fallback if we can't find the tool_use
	const shortName = normalizedResult.prompt?.substring(0, 50) || null
	return {
		name: shortName,
		model: undefined,
		description: shortName,
		totalTokens,
	}
}

// Parse events from session log that belong to a specific agent (after resume)
export function parseSessionEventsForAgent(
	logEntries: LogEntry[],
	sessionId: string,
	agentId: string,
): Event[] {
	const events: Event[] = []

	// Look for tool results and assistant messages that belong to this agent
	for (const entry of logEntries) {
		// Skip events that would be in the agent's own log file
		if (entry.agentId === agentId) continue

		// Check if this is a tool result for this agent (happens after resume)
		const result = normalizeToolUseResult(entry.toolUseResult)
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.USER && result?.agentId === agentId) {
			// Skip entries missing required fields
			if (!entry.uuid || !entry.timestamp) continue

			const content = entry.message?.content
			if (Array.isArray(content)) {
				for (const item of content) {
					if (item.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT) {
						const toolResult = item as ToolResultContent
						let output = ""

						if (typeof toolResult.content === "string") {
							output = toolResult.content
						} else if (Array.isArray(toolResult.content)) {
							output = toolResult.content
								.map((c) => {
									if (c.type === CLAUDE_CONTENT_TYPE.TEXT) return c.text
									if (c.type === CLAUDE_CONTENT_TYPE.TOOL_REFERENCE) return `[Tool: ${c.tool_name}]`
									return "[Image]"
								})
								.join("\n")
						}

						events.push({
							id: entry.uuid,
							parentId: entry.parentUuid ?? null,
							timestamp: new Date(entry.timestamp),
							sessionId,
							agentId,
							agentName: null,
							type: SESSION_EVENT_TYPE.TOOL_RESULT as EventType,
							data: {
								type: SESSION_EVENT_TYPE.TOOL_RESULT,
								toolUseId: toolResult.tool_use_id,
								success: !toolResult.is_error,
								output,
								agentId,
							},
						})
					}
				}
			}
		}
	}

	return events
}

export function parseEvents(
	logEntries: LogEntry[],
	options: {
		sessionId: string
		agentId: string | null
		planHandoffs?: Map<string, DetectedPlanHandoff>
	},
): Event[] {
	const events: Event[] = []
	const {sessionId, agentId, planHandoffs} = options
	const handoffByEntryId = planHandoffs ?? new Map<string, DetectedPlanHandoff>()

	for (const entry of logEntries) {
		// Skip unknown log entry types (e.g., "queue-operation")
		if (
			entry.type !== CLAUDE_LOG_ENTRY_TYPE.SUMMARY &&
			entry.type !== CLAUDE_LOG_ENTRY_TYPE.USER &&
			entry.type !== CLAUDE_LOG_ENTRY_TYPE.ASSISTANT
		) {
			continue
		}

		// Normalize toolUseResult at the start of each iteration
		const result = normalizeToolUseResult(entry.toolUseResult)

		// Handle summary type (which has minimal fields)
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.SUMMARY) {
			events.push({
				id: entry.leafUuid || entry.uuid || "unknown",
				parentId: entry.parentUuid ?? null,
				timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
				sessionId,
				agentId: agentId || entry.agentId || sessionId,
				agentName: null,
				type: SESSION_EVENT_TYPE.SUMMARY as EventType,
				data: {
					type: SESSION_EVENT_TYPE.SUMMARY,
					summary: entry.summary || "",
				},
			})
			continue
		}

		// For non-summary entries, these fields should exist
		if (!entry.uuid || !entry.timestamp) {
			console.warn(`Skipping entry with missing required fields: ${JSON.stringify(entry)}`)
			continue
		}

		const baseEvent = {
			id: entry.uuid,
			parentId: entry.parentUuid ?? null,
			timestamp: new Date(entry.timestamp),
			sessionId,
			// For main agent (agentId param is null), use sessionId as the agentId
			// This ensures events can be looked up by agent ID since main agent's ID is sessionId
			agentId: agentId || entry.agentId || sessionId,
			agentName: null,
		}

		// Handle user messages
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.USER && entry.message) {
			const content = entry.message.content
			const planHandoff = entry.uuid ? handoffByEntryId.get(entry.uuid) : undefined

			// Check if it's a tool result
			if (Array.isArray(content)) {
				for (const item of content) {
					if (item.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT) {
						const toolResult = item as ToolResultContent
						let output = ""

						if (typeof toolResult.content === "string") {
							output = toolResult.content
						} else if (Array.isArray(toolResult.content)) {
							output = toolResult.content
								.map((c) => {
									if (c.type === CLAUDE_CONTENT_TYPE.TEXT) return c.text
									if (c.type === CLAUDE_CONTENT_TYPE.TOOL_REFERENCE) return `[Tool: ${c.tool_name}]`
									return "[Image]"
								})
								.join("\n")
						}

						events.push({
							...baseEvent,
							type: SESSION_EVENT_TYPE.TOOL_RESULT as EventType,
							data: {
								type: SESSION_EVENT_TYPE.TOOL_RESULT,
								toolUseId: toolResult.tool_use_id,
								success: !toolResult.is_error,
								output,
								agentId: result?.agentId,
							},
						})
					}
				}
				// Also extract text content from array (e.g. command prompts)
				const textParts = content
					.filter((item) => item.type === CLAUDE_CONTENT_TYPE.TEXT)
					.map((item) => (item as TextContent).text)
				if (textParts.length > 0) {
					events.push({
						...baseEvent,
						type: SESSION_EVENT_TYPE.USER_MESSAGE as EventType,
						data: {
							type: SESSION_EVENT_TYPE.USER_MESSAGE,
							text: textParts.join("\n"),
							model: entry.message.model,
							planHandoff: planHandoff
								? {
										plan: planHandoff.plan,
										promptId: planHandoff.promptId,
										continuedSessionId: planHandoff.continuedSessionId,
										continuedSessionPath: planHandoff.continuedSessionPath,
									}
								: undefined,
						},
					})
				}
			} else if (typeof content === "string") {
				events.push({
					...baseEvent,
					type: SESSION_EVENT_TYPE.USER_MESSAGE as EventType,
					data: {
						type: SESSION_EVENT_TYPE.USER_MESSAGE,
						text: content,
						model: entry.message.model,
						planHandoff: planHandoff
							? {
									plan: planHandoff.plan,
									promptId: planHandoff.promptId,
									continuedSessionId: planHandoff.continuedSessionId,
									continuedSessionPath: planHandoff.continuedSessionPath,
								}
							: undefined,
					},
				})
			}
		}

		// Handle assistant messages
		if (entry.type === CLAUDE_LOG_ENTRY_TYPE.ASSISTANT && entry.message) {
			const content = entry.message.content

			if (Array.isArray(content)) {
				for (const item of content) {
					if (item.type === CLAUDE_CONTENT_TYPE.TEXT) {
						const textContent = item as TextContent
						events.push({
							...baseEvent,
							type: SESSION_EVENT_TYPE.ASSISTANT_MESSAGE as EventType,
							data: {
								type: SESSION_EVENT_TYPE.ASSISTANT_MESSAGE,
								text: textContent.text,
								model: entry.message.model,
							},
						})
					} else if (item.type === CLAUDE_CONTENT_TYPE.THINKING) {
						const thinkingContent = item as ThinkingContent
						if (thinkingContent.thinking) {
							events.push({
								...baseEvent,
								type: SESSION_EVENT_TYPE.THINKING as EventType,
								data: {
									type: SESSION_EVENT_TYPE.THINKING,
									content: thinkingContent.thinking,
								},
							})
						}
					} else if (item.type === CLAUDE_CONTENT_TYPE.TOOL_USE) {
						const toolUse = item as ToolUseContent
						const isResume =
							(toolUse.name === "Task" || toolUse.name === "Agent") && "resume" in toolUse.input
						const resumesAgentId = isResume ? (toolUse.input.resume as string) : undefined

						events.push({
							...baseEvent,
							type: SESSION_EVENT_TYPE.TOOL_USE as EventType,
							data: {
								type: SESSION_EVENT_TYPE.TOOL_USE,
								toolName: toolUse.name,
								toolId: toolUse.id,
								input: toolUse.input,
								description: (toolUse.input.description as string) || undefined,
								isResume,
								resumesAgentId,
							},
						})
					}
				}
			}
		}
	}

	// For terminal handoffs (plan accepted externally, no interruption entry in this session),
	// emit a synthetic USER_MESSAGE at the end of the event list — but only when we found
	// a matching continuation session, so we don't fabricate handoffs for plain rejections.
	for (const [key, handoff] of handoffByEntryId) {
		if (!key.startsWith("__plan_end_")) continue
		if (!handoff.continuedSessionId) continue
		const lastEvent = events.at(-1)
		events.push({
			id: key,
			parentId: lastEvent?.id ?? null,
			timestamp: lastEvent ? new Date(lastEvent.timestamp.getTime() + 1) : new Date(),
			sessionId,
			agentId: agentId ?? sessionId,
			agentName: null,
			type: SESSION_EVENT_TYPE.USER_MESSAGE as EventType,
			data: {
				type: SESSION_EVENT_TYPE.USER_MESSAGE,
				text: "Plan accepted.",
				model: undefined,
				planHandoff: {
					plan: handoff.plan,
					promptId: handoff.promptId,
					continuedSessionId: handoff.continuedSessionId,
					continuedSessionPath: handoff.continuedSessionPath,
				},
			},
		})
	}

	return events
}

export function extractAllEvents(agent: AgentNode): Event[] {
	const events = [...agent.events]

	for (const child of agent.children) {
		events.push(...extractAllEvents(child))
	}

	// Sort by timestamp
	events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

	return events
}
