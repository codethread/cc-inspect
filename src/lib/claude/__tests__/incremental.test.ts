import {describe, expect, it} from "bun:test"
import {
	buildAgentNode,
	createParseStateFromSession,
	type IncrementalParseState,
	parseLines,
	processAgentEntries,
	processMainEntries,
} from "../incremental"
import type {AgentNode, LogEntry, SessionData} from "../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogEntry(overrides: Partial<LogEntry> & {type: string}): LogEntry {
	return {
		uuid: "default-uuid",
		timestamp: "2025-01-15T10:00:00.000Z",
		sessionId: "sess-001",
		...overrides,
	}
}

function makeUserMessage(text: string, overrides?: Partial<LogEntry>): LogEntry {
	return makeLogEntry({
		type: "user",
		message: {role: "user", content: text},
		...overrides,
	})
}

function makeAssistantText(text: string, overrides?: Partial<LogEntry>): LogEntry {
	return makeLogEntry({
		type: "assistant",
		message: {
			role: "assistant",
			model: "claude-sonnet-4-20250514",
			content: [{type: "text", text}],
		},
		...overrides,
	})
}

function makeAssistantToolUse(
	opts: {toolName: string; toolId: string; input: Record<string, unknown>},
	overrides?: Partial<LogEntry>,
): LogEntry {
	return makeLogEntry({
		type: "assistant",
		message: {
			role: "assistant",
			model: "claude-sonnet-4-20250514",
			content: [{type: "tool_use", id: opts.toolId, name: opts.toolName, input: opts.input}],
		},
		...overrides,
	})
}

function makeToolResult(
	opts: {toolUseId: string; content: string; toolUseResult?: LogEntry["toolUseResult"]},
	overrides?: Partial<LogEntry>,
): LogEntry {
	return makeLogEntry({
		type: "user",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: opts.toolUseId, content: opts.content}],
		},
		toolUseResult: opts.toolUseResult,
		...overrides,
	})
}

function makeMainAgent(overrides?: Partial<AgentNode>): AgentNode {
	return {
		id: "sess-001",
		name: "Main Agent",
		model: "claude-sonnet-4-20250514",
		parent: null,
		children: [],
		events: [],
		logPath: "/project/sess-001.jsonl",
		...overrides,
	}
}

function makeSessionData(overrides?: Partial<SessionData>): SessionData {
	return {
		sessionId: "sess-001",
		mainAgent: makeMainAgent(),
		allEvents: [],
		logDirectory: "/project",
		...overrides,
	}
}

function makeIncrementalState(overrides?: Partial<IncrementalParseState>): IncrementalParseState {
	return {
		sessionId: "sess-001",
		knownAgentIds: new Set<string>(),
		mainLogEntries: [],
		mainAgent: makeMainAgent(),
		lineCountPerFile: new Map<string, number>(),
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// parseLines
// ---------------------------------------------------------------------------

describe("parseLines", () => {
	it.each([
		{
			label: "valid JSONL produces correct entries with no errors",
			lines: [JSON.stringify(makeUserMessage("hello")), JSON.stringify(makeAssistantText("hi"))],
			expectedEntryCount: 2,
			expectedErrorCount: 0,
		},
		{
			label: "invalid JSON produces errors with line number, no throw",
			lines: ["{bad json"],
			expectedEntryCount: 0,
			expectedErrorCount: 1,
		},
		{
			label: "valid JSON but fails Zod schema produces errors",
			lines: [JSON.stringify({not_valid: true, missing_type: "yes"})],
			expectedEntryCount: 0,
			expectedErrorCount: 1,
		},
		{
			label: "mixed valid and invalid produces entries for valid, errors for invalid",
			lines: [
				JSON.stringify(makeUserMessage("hello")),
				"{bad json",
				JSON.stringify(makeAssistantText("world")),
			],
			expectedEntryCount: 2,
			expectedErrorCount: 1,
		},
		{
			label: "empty input produces empty entries and errors",
			lines: [],
			expectedEntryCount: 0,
			expectedErrorCount: 0,
		},
	])("$label", ({lines, expectedEntryCount, expectedErrorCount}) => {
		const result = parseLines(lines, "/test.jsonl", 1)
		expect(result.entries).toHaveLength(expectedEntryCount)
		expect(result.errors).toHaveLength(expectedErrorCount)
	})

	it("reports correct absolute line numbers with startLineNumber offset", () => {
		const lines = ["{bad json"]
		const result = parseLines(lines, "/test.jsonl", 42)
		expect(result.errors[0]?.line).toBe(42)
	})

	it("error for invalid JSON contains 'JSON parse failed'", () => {
		const result = parseLines(["{bad json"], "/test.jsonl", 1)
		expect(result.errors[0]?.error).toContain("JSON parse failed")
	})

	it("error for Zod failure contains 'Schema validation failed'", () => {
		const result = parseLines([JSON.stringify({not_valid: true})], "/test.jsonl", 1)
		expect(result.errors[0]?.error).toContain("Schema validation failed")
	})

	it("skips empty strings in the lines array", () => {
		const lines = ["", JSON.stringify(makeUserMessage("hello")), ""]
		const result = parseLines(lines, "/test.jsonl", 1)
		expect(result.entries).toHaveLength(1)
		expect(result.errors).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// processMainEntries
// ---------------------------------------------------------------------------

describe("processMainEntries", () => {
	it("converts entries to events using parseEvents", () => {
		const state = makeIncrementalState()
		const entries = [makeUserMessage("hello", {uuid: "u1"})]

		const {events} = processMainEntries(entries, state)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("user-message")
	})

	it("discovers new agent IDs from toolUseResult.agentId", () => {
		const state = makeIncrementalState()
		const entries = [
			makeAssistantToolUse(
				{
					toolName: "Task",
					toolId: "tool-1",
					input: {description: "do stuff", subagent_type: "general-purpose"},
				},
				{uuid: "uuid-1"},
			),
			makeToolResult(
				{toolUseId: "tool-1", content: "done", toolUseResult: {agentId: "agent-abc", status: "completed"}},
				{uuid: "uuid-2"},
			),
		]

		const {newAgentIds} = processMainEntries(entries, state)

		expect(newAgentIds).toEqual(["agent-abc"])
	})

	it("does not re-report already-known agent IDs", () => {
		const state = makeIncrementalState({
			knownAgentIds: new Set(["agent-abc"]),
		})
		const entries = [
			makeToolResult(
				{toolUseId: "tool-1", content: "done", toolUseResult: {agentId: "agent-abc", status: "completed"}},
				{uuid: "uuid-2"},
			),
		]

		const {newAgentIds} = processMainEntries(entries, state)

		expect(newAgentIds).toEqual([])
	})

	it("adds discovered IDs to state.knownAgentIds", () => {
		const state = makeIncrementalState()
		const entries = [
			makeToolResult(
				{toolUseId: "tool-1", content: "done", toolUseResult: {agentId: "agent-new", status: "ok"}},
				{uuid: "uuid-2"},
			),
		]

		processMainEntries(entries, state)

		expect(state.knownAgentIds.has("agent-new")).toBe(true)
	})

	it("appends entries to state.mainLogEntries", () => {
		const state = makeIncrementalState()
		const entries = [makeUserMessage("first", {uuid: "u1"}), makeUserMessage("second", {uuid: "u2"})]

		processMainEntries(entries, state)

		expect(state.mainLogEntries).toHaveLength(2)
		expect(state.mainLogEntries[0]?.uuid).toBe("u1")
		expect(state.mainLogEntries[1]?.uuid).toBe("u2")
	})

	it("accumulates entries across multiple calls", () => {
		const state = makeIncrementalState()

		processMainEntries([makeUserMessage("first", {uuid: "u1"})], state)
		processMainEntries([makeUserMessage("second", {uuid: "u2"})], state)

		expect(state.mainLogEntries).toHaveLength(2)
	})

	it("ignores entries with string toolUseResult (not object)", () => {
		const state = makeIncrementalState()
		const entries = [
			makeLogEntry({
				type: "user",
				uuid: "u1",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "tu1", content: "result"}],
				},
				toolUseResult: "some-string",
			}),
		]

		const {newAgentIds} = processMainEntries(entries, state)

		expect(newAgentIds).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// processAgentEntries
// ---------------------------------------------------------------------------

describe("processAgentEntries", () => {
	it("produces correct events for given agentId", () => {
		const state = makeIncrementalState()
		const entries = [
			makeUserMessage("agent prompt", {uuid: "au1"}),
			makeAssistantText("agent response", {uuid: "au2"}),
		]

		const events = processAgentEntries(entries, "agent-x", state)

		expect(events).toHaveLength(2)
		expect(events[0]?.agentId).toBe("agent-x")
		expect(events[1]?.agentId).toBe("agent-x")
		expect(events[0]?.type).toBe("user-message")
		expect(events[1]?.type).toBe("assistant-message")
	})

	it("sets sessionId from state on all events", () => {
		const state = makeIncrementalState({sessionId: "my-session"})
		const entries = [makeUserMessage("hello", {uuid: "au1"})]

		const events = processAgentEntries(entries, "agent-y", state)

		expect(events[0]?.sessionId).toBe("my-session")
	})
})

// ---------------------------------------------------------------------------
// createParseStateFromSession
// ---------------------------------------------------------------------------

describe("createParseStateFromSession", () => {
	it("initializes knownAgentIds from children", () => {
		const childA: AgentNode = makeMainAgent({
			id: "agent-a",
			parent: "sess-001",
			logPath: "/agents/agent-a.jsonl",
		})
		const childB: AgentNode = makeMainAgent({
			id: "agent-b",
			parent: "sess-001",
			logPath: "/agents/agent-b.jsonl",
		})
		const sessionData = makeSessionData({
			mainAgent: makeMainAgent({children: [childA, childB]}),
		})

		const state = createParseStateFromSession(sessionData, 10, new Map())

		expect(state.knownAgentIds.has("agent-a")).toBe(true)
		expect(state.knownAgentIds.has("agent-b")).toBe(true)
		expect(state.knownAgentIds.size).toBe(2)
	})

	it("sets correct sessionId", () => {
		const sessionData = makeSessionData({sessionId: "my-session-123"})

		const state = createParseStateFromSession(sessionData, 10, new Map())

		expect(state.sessionId).toBe("my-session-123")
	})

	it("initializes lineCountPerFile from provided counts", () => {
		const child: AgentNode = makeMainAgent({
			id: "agent-a",
			parent: "sess-001",
			logPath: "/agents/agent-agent-a.jsonl",
		})
		const sessionData = makeSessionData({
			mainAgent: makeMainAgent({children: [child]}),
		})
		const agentLineCounts = new Map([["agent-a", 25]])

		const state = createParseStateFromSession(sessionData, 50, agentLineCounts)

		expect(state.lineCountPerFile.get("/project/sess-001.jsonl")).toBe(50)
		expect(state.lineCountPerFile.get("/agents/agent-agent-a.jsonl")).toBe(25)
	})

	it("starts with empty mainLogEntries", () => {
		const sessionData = makeSessionData()

		const state = createParseStateFromSession(sessionData, 10, new Map())

		expect(state.mainLogEntries).toHaveLength(0)
	})

	it("stores the mainAgent reference", () => {
		const mainAgent = makeMainAgent({model: "special-model"})
		const sessionData = makeSessionData({mainAgent})

		const state = createParseStateFromSession(sessionData, 10, new Map())

		expect(state.mainAgent).toBe(mainAgent)
	})
})

// ---------------------------------------------------------------------------
// buildAgentNode
// ---------------------------------------------------------------------------

describe("buildAgentNode", () => {
	it("creates node with extracted agent info from mainLogEntries", () => {
		const state = makeIncrementalState({
			mainLogEntries: [
				makeAssistantToolUse(
					{
						toolName: "Task",
						toolId: "tu-1",
						input: {description: "Refactor utils", subagent_type: "code", model: "claude-sonnet-4-20250514"},
					},
					{uuid: "uuid-1"},
				),
				makeToolResult(
					{toolUseId: "tu-1", content: "done", toolUseResult: {agentId: "agent-abc", status: "ok"}},
					{uuid: "uuid-2"},
				),
			],
		})

		const node = buildAgentNode("agent-abc", state)

		expect(node.id).toBe("agent-abc")
		expect(node.name).toBe("Refactor utils")
		expect(node.subagentType).toBe("code")
		expect(node.description).toBe("Refactor utils")
		expect(node.parent).toBe("sess-001")
		expect(node.children).toEqual([])
		expect(node.events).toEqual([])
		expect(node.logPath).toBe("")
	})

	it("falls back to agentId as name when no info found", () => {
		const state = makeIncrementalState({
			mainLogEntries: [makeUserMessage("nothing relevant")],
		})

		const node = buildAgentNode("unknown-agent", state)

		expect(node.id).toBe("unknown-agent")
		expect(node.name).toBe("unknown-agent")
		expect(node.parent).toBe("sess-001")
	})

	it("detects resumed agent info", () => {
		const state = makeIncrementalState({
			mainLogEntries: [
				makeAssistantToolUse(
					{
						toolName: "Task",
						toolId: "tu-resume",
						input: {resume: "agent-abc", description: "Continue work"},
					},
					{uuid: "uuid-1"},
				),
				makeToolResult(
					{toolUseId: "tu-resume", content: "done", toolUseResult: {agentId: "agent-abc", status: "ok"}},
					{uuid: "uuid-2"},
				),
			],
		})

		const node = buildAgentNode("agent-abc", state)

		expect(node.isResumed).toBe(true)
		expect(node.resumedFrom).toBe("tu-resume")
	})

	it("sets parent to state.sessionId", () => {
		const state = makeIncrementalState({
			sessionId: "custom-session",
			mainLogEntries: [],
		})

		const node = buildAgentNode("some-agent", state)

		expect(node.parent).toBe("custom-session")
	})
})
