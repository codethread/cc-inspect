import {describe, expect, it} from "bun:test"
import {join} from "node:path"
import {ParseError} from "../errors"
import type {FileReader} from "../parser"
import {
	extractAgentInfo,
	extractAllEvents,
	extractMainAgentModel,
	extractSessionId,
	findAgentLogs,
	normalizeToolUseResult,
	parseEvents,
	parseJsonlFile,
	parseSessionEventsForAgent,
	parseSessionLogs,
} from "../parser"
import type {LogEntry, ToolUseResult} from "../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dir, "fixtures")

function makeReader(files: Record<string, string>): FileReader {
	return {
		async readText(path: string) {
			if (path in files) return files[path] as string
			throw new Error(`File not found: ${path}`)
		},
		async exists(path: string) {
			return path in files
		},
	}
}

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

function makeSummary(summary: string, overrides?: Partial<LogEntry>): LogEntry {
	return makeLogEntry({
		type: "summary",
		summary,
		leafUuid: "leaf-1",
		...overrides,
	})
}

// ---------------------------------------------------------------------------
// parseJsonlFile
// ---------------------------------------------------------------------------

describe("parseJsonlFile", () => {
	it("parses valid .jsonl from fixture", async () => {
		const reader = makeReader({
			"/test.jsonl": [
				JSON.stringify({
					type: "user",
					uuid: "u1",
					timestamp: "2025-01-15T10:00:00Z",
					message: {role: "user", content: "hi"},
				}),
				JSON.stringify({type: "summary", summary: "done", leafUuid: "l1"}),
			].join("\n"),
		})

		const entries = await parseJsonlFile("/test.jsonl", reader)
		expect(entries).toHaveLength(2)
		expect(entries[0]?.type).toBe("user")
		expect(entries[1]?.type).toBe("summary")
	})

	it("skips empty lines", async () => {
		const reader = makeReader({
			"/test.jsonl": [
				JSON.stringify({
					type: "user",
					uuid: "u1",
					timestamp: "2025-01-15T10:00:00Z",
					message: {role: "user", content: "hi"},
				}),
				"",
				"  ",
				JSON.stringify({type: "summary", summary: "done", leafUuid: "l1"}),
			].join("\n"),
		})

		const entries = await parseJsonlFile("/test.jsonl", reader)
		expect(entries).toHaveLength(2)
	})

	it("throws ParseError on invalid JSON", async () => {
		const reader = makeReader({"/bad.jsonl": "{bad json"})

		try {
			await parseJsonlFile("/bad.jsonl", reader)
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(ParseError)
			const pe = err as ParseError
			expect(pe.filePath).toBe("/bad.jsonl")
			expect(pe.lineNumber).toBe(1)
			expect(pe.message).toContain("Failed to parse JSON")
		}
	})

	it("throws ParseError with Zod details on schema mismatch", async () => {
		const reader = makeReader({
			"/bad-schema.jsonl": JSON.stringify({not_a_valid_entry: true, missing_type: "yes"}),
		})

		try {
			await parseJsonlFile("/bad-schema.jsonl", reader)
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(ParseError)
			const pe = err as ParseError
			expect(pe.message).toContain("Failed to validate log entry")
			expect(pe.zodError).toBeDefined()
		}
	})

	it("parses the simple-session fixture file", async () => {
		const content = await Bun.file(join(FIXTURES, "simple-session.jsonl")).text()
		const reader = makeReader({"/session.jsonl": content})

		const entries = await parseJsonlFile("/session.jsonl", reader)
		expect(entries).toHaveLength(5)
		expect(entries.map((e) => e.type)).toEqual(["user", "assistant", "assistant", "user", "summary"])
	})
})

// ---------------------------------------------------------------------------
// normalizeToolUseResult
// ---------------------------------------------------------------------------

describe("normalizeToolUseResult", () => {
	it.each([
		{input: undefined, expected: undefined, label: "undefined"},
		{input: "some string", expected: undefined, label: "string"},
		{input: {status: "ok"} as ToolUseResult, expected: {status: "ok"}, label: "object"},
		{
			input: [{status: "first"}, {status: "second"}] as ToolUseResult[],
			expected: {status: "first"},
			label: "array",
		},
	])("$label -> expected result", ({input, expected}) => {
		expect(normalizeToolUseResult(input)).toEqual(expected)
	})
})

// ---------------------------------------------------------------------------
// extractSessionId
// ---------------------------------------------------------------------------

describe("extractSessionId", () => {
	it.each([
		{path: "/foo/bar/abc-123.jsonl", expected: "abc-123"},
		{path: "/a/b/c/d/session-uuid-here.jsonl", expected: "session-uuid-here"},
		{path: "simple.jsonl", expected: "simple"},
	])("extracts id from $path", ({path, expected}) => {
		expect(extractSessionId(path)).toBe(expected)
	})
})

// ---------------------------------------------------------------------------
// findAgentLogs
// ---------------------------------------------------------------------------

describe("findAgentLogs", () => {
	it("discovers agents from toolUseResult.agentId", async () => {
		const entries: LogEntry[] = [
			makeToolResult({toolUseId: "tu1", content: "done", toolUseResult: {agentId: "agent-1", status: "ok"}}),
			makeToolResult({toolUseId: "tu2", content: "done", toolUseResult: {agentId: "agent-2", status: "ok"}}),
		]
		const reader = makeReader({
			"/agents/agent-agent-1.jsonl": "{}",
			"/agents/agent-agent-2.jsonl": "{}",
		})

		const result = await findAgentLogs("/agents", entries, reader)
		expect(result.size).toBe(2)
		expect(result.get("agent-1")).toBe(join("/agents", "agent-agent-1.jsonl"))
		expect(result.get("agent-2")).toBe(join("/agents", "agent-agent-2.jsonl"))
	})

	it("handles missing agent log files gracefully", async () => {
		const entries: LogEntry[] = [
			makeToolResult({
				toolUseId: "tu1",
				content: "done",
				toolUseResult: {agentId: "missing-agent", status: "ok"},
			}),
		]
		const reader = makeReader({})

		const result = await findAgentLogs("/agents", entries, reader)
		expect(result.size).toBe(0)
	})

	it("returns empty map when no agents exist", async () => {
		const entries: LogEntry[] = [makeUserMessage("hello")]
		const reader = makeReader({})

		const result = await findAgentLogs("/agents", entries, reader)
		expect(result.size).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// extractMainAgentModel
// ---------------------------------------------------------------------------

describe("extractMainAgentModel", () => {
	it.each([
		{
			label: "returns model from first assistant",
			entries: [makeUserMessage("hi"), makeAssistantText("hello", {uuid: "a1"})],
			expected: "claude-sonnet-4-20250514",
		},
		{
			label: "returns undefined when no assistant messages",
			entries: [makeUserMessage("hi")],
			expected: undefined,
		},
		{
			label: "skips user messages",
			entries: [makeUserMessage("hi"), makeUserMessage("still user")],
			expected: undefined,
		},
	])("$label", ({entries, expected}) => {
		expect(extractMainAgentModel(entries)).toBe(expected)
	})
})

// ---------------------------------------------------------------------------
// extractAgentInfo
// ---------------------------------------------------------------------------

describe("extractAgentInfo", () => {
	it("extracts metadata from Task tool_use matching a tool_result with agentId", () => {
		const entries: LogEntry[] = [
			makeAssistantToolUse({
				toolName: "Task",
				toolId: "tu1",
				input: {
					description: "Refactor utils",
					prompt: "Please refactor",
					subagent_type: "code",
					model: "claude-sonnet-4-20250514",
				},
			}),
			makeToolResult({toolUseId: "tu1", content: "done", toolUseResult: {agentId: "abc123", status: "ok"}}),
		]

		const info = extractAgentInfo(entries, "abc123")
		expect(info.name).toBe("Refactor utils")
		expect(info.subagentType).toBe("code")
		expect(info.description).toBe("Refactor utils")
	})

	it("detects resumed agents with resume parameter", () => {
		const entries: LogEntry[] = [
			makeAssistantToolUse({
				toolName: "Task",
				toolId: "tu-resume",
				input: {resume: "abc123", description: "Continue work"},
			}),
			makeToolResult({
				toolUseId: "tu-resume",
				content: "done",
				toolUseResult: {agentId: "abc123", status: "ok"},
			}),
		]

		const info = extractAgentInfo(entries, "abc123")
		expect(info.isResumed).toBe(true)
		expect(info.resumedFrom).toBe("tu-resume")
	})

	it("falls back to agentId as name when no matching entries found", () => {
		const entries: LogEntry[] = [makeUserMessage("nothing relevant")]

		const info = extractAgentInfo(entries, "unknown-agent")
		expect(info.name).toBe("unknown-agent")
	})

	it("falls back to prompt substring when tool_use_id not found in content", () => {
		// result entry exists but no tool_result in the message content
		const entry = makeLogEntry({
			type: "user",
			uuid: "u1",
			message: {role: "user", content: "just text"},
			toolUseResult: {agentId: "abc123", prompt: "Long prompt about the task to do"},
		})

		const info = extractAgentInfo([entry], "abc123")
		expect(info.name).toBe("Long prompt about the task to do")
	})
})

// ---------------------------------------------------------------------------
// parseEvents
// ---------------------------------------------------------------------------

describe("parseEvents", () => {
	it("converts user message (string content) to user-message event", () => {
		const entries: LogEntry[] = [makeUserMessage("hello world")]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("user-message")
		expect(events[0]?.data).toEqual({type: "user-message", text: "hello world", model: undefined})
	})

	it("converts user message (array content with text) to user-message event", () => {
		const entries: LogEntry[] = [
			makeLogEntry({
				type: "user",
				message: {
					role: "user",
					content: [{type: "text", text: "array text"}],
				},
			}),
		]
		const events = parseEvents(entries, "sess-1", null)

		const userEvents = events.filter((e) => e.type === "user-message")
		expect(userEvents).toHaveLength(1)
		expect(userEvents[0]?.data).toEqual({type: "user-message", text: "array text", model: undefined})
	})

	it("converts tool_result content to tool-result event", () => {
		const entries: LogEntry[] = [makeToolResult({toolUseId: "tu1", content: "file contents"})]
		const events = parseEvents(entries, "sess-1", null)

		const toolResults = events.filter((e) => e.type === "tool-result")
		expect(toolResults).toHaveLength(1)
		expect(toolResults[0]?.data).toEqual({
			type: "tool-result",
			toolUseId: "tu1",
			success: true,
			output: "file contents",
			agentId: undefined,
		})
	})

	it("converts assistant text content to assistant-message event", () => {
		const entries: LogEntry[] = [makeAssistantText("I can help!")]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("assistant-message")
		expect(events[0]?.data).toEqual({
			type: "assistant-message",
			text: "I can help!",
			model: "claude-sonnet-4-20250514",
		})
	})

	it("converts thinking content to thinking event", () => {
		const entries: LogEntry[] = [
			makeLogEntry({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{type: "thinking", thinking: "deep thoughts", signature: "sig"}],
				},
			}),
		]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("thinking")
		expect(events[0]?.data).toEqual({type: "thinking", content: "deep thoughts"})
	})

	it("converts tool_use content to tool-use event", () => {
		const entries: LogEntry[] = [
			makeAssistantToolUse({toolName: "Read", toolId: "tu1", input: {file_path: "/test.txt"}}),
		]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("tool-use")
		expect(events[0]?.data).toEqual({
			type: "tool-use",
			toolName: "Read",
			toolId: "tu1",
			input: {file_path: "/test.txt"},
			description: undefined,
			isResume: false,
			resumesAgentId: undefined,
		})
	})

	it("detects resume flag on Task tool_use", () => {
		const entries: LogEntry[] = [
			makeAssistantToolUse({
				toolName: "Task",
				toolId: "tu1",
				input: {resume: "agent-xyz", description: "Continue"},
			}),
		]
		const events = parseEvents(entries, "sess-1", null)

		const toolUse = events[0]
		expect(toolUse?.data).toEqual({
			type: "tool-use",
			toolName: "Task",
			toolId: "tu1",
			input: {resume: "agent-xyz", description: "Continue"},
			description: "Continue",
			isResume: true,
			resumesAgentId: "agent-xyz",
		})
	})

	it("skips entries with unknown types", () => {
		const entries: LogEntry[] = [
			makeLogEntry({type: "progress"}),
			makeLogEntry({type: "system"}),
			makeLogEntry({type: "queue-operation"}),
			makeUserMessage("visible"),
		]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("user-message")
	})

	it("skips entries missing uuid or timestamp", () => {
		const entries: LogEntry[] = [
			makeLogEntry({type: "user", uuid: undefined, message: {role: "user", content: "no uuid"}}),
			makeLogEntry({type: "user", timestamp: undefined, message: {role: "user", content: "no ts"}}),
			makeUserMessage("valid"),
		]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.data).toEqual({type: "user-message", text: "valid", model: undefined})
	})

	it("handles summary entries", () => {
		const entries: LogEntry[] = [makeSummary("Session complete")]
		const events = parseEvents(entries, "sess-1", null)

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("summary")
		expect(events[0]?.id).toBe("leaf-1")
		expect(events[0]?.data).toEqual({type: "summary", summary: "Session complete"})
	})

	it("uses agentId parameter when provided", () => {
		const entries: LogEntry[] = [makeUserMessage("hello")]
		const events = parseEvents(entries, "sess-1", "agent-x")

		expect(events[0]?.agentId).toBe("agent-x")
	})

	it("falls back to sessionId for agentId when agentId param is null", () => {
		const entries: LogEntry[] = [makeUserMessage("hello")]
		const events = parseEvents(entries, "sess-1", null)

		expect(events[0]?.agentId).toBe("sess-1")
	})
})

// ---------------------------------------------------------------------------
// parseSessionEventsForAgent
// ---------------------------------------------------------------------------

describe("parseSessionEventsForAgent", () => {
	it("extracts tool-result events for a specific agent", () => {
		const entries: LogEntry[] = [
			makeToolResult({
				toolUseId: "tu1",
				content: "agent output",
				toolUseResult: {agentId: "agent-x", status: "done"},
			}),
		]
		const events = parseSessionEventsForAgent(entries, "sess-1", "agent-x")

		expect(events).toHaveLength(1)
		expect(events[0]?.type).toBe("tool-result")
		expect(events[0]?.agentId).toBe("agent-x")
	})

	it("skips entries that belong to the agent's own log (entry.agentId matches)", () => {
		const entries: LogEntry[] = [
			makeLogEntry({
				type: "user",
				agentId: "agent-x",
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "tu1", content: "output"}]},
				toolUseResult: {agentId: "agent-x", status: "done"},
			}),
		]
		const events = parseSessionEventsForAgent(entries, "sess-1", "agent-x")

		expect(events).toHaveLength(0)
	})

	it("handles string tool_result content", () => {
		const entries: LogEntry[] = [
			makeToolResult({
				toolUseId: "tu1",
				content: "string output",
				toolUseResult: {agentId: "agent-x", status: "done"},
			}),
		]
		const events = parseSessionEventsForAgent(entries, "sess-1", "agent-x")

		expect(events[0]?.data).toMatchObject({output: "string output"})
	})

	it("handles array tool_result content", () => {
		const entries: LogEntry[] = [
			makeLogEntry({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tu1",
							content: [
								{type: "text", text: "line 1"},
								{type: "text", text: "line 2"},
							],
						},
					],
				},
				toolUseResult: {agentId: "agent-x", status: "done"},
			}),
		]
		const events = parseSessionEventsForAgent(entries, "sess-1", "agent-x")

		expect(events[0]?.data).toMatchObject({output: "line 1\nline 2"})
	})

	it("skips entries missing uuid or timestamp", () => {
		const entries: LogEntry[] = [
			makeLogEntry({
				type: "user",
				uuid: undefined,
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "tu1", content: "output"}],
				},
				toolUseResult: {agentId: "agent-x", status: "done"},
			}),
		]
		const events = parseSessionEventsForAgent(entries, "sess-1", "agent-x")

		expect(events).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// extractAllEvents
// ---------------------------------------------------------------------------

describe("extractAllEvents", () => {
	it("flattens single agent (no children) to sorted events", () => {
		const agent = {
			id: "main",
			name: "Main Agent",
			parent: null,
			children: [],
			events: [
				{
					id: "e2",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:01Z"),
					sessionId: "s1",
					agentId: "main",
					agentName: null,
					type: "assistant-message" as const,
					data: {type: "assistant-message" as const, text: "hi", model: "m"},
				},
				{
					id: "e1",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:00Z"),
					sessionId: "s1",
					agentId: "main",
					agentName: null,
					type: "user-message" as const,
					data: {type: "user-message" as const, text: "hello"},
				},
			],
			logPath: "/test.jsonl",
		}

		const events = extractAllEvents(agent)
		expect(events).toHaveLength(2)
		expect(events[0]?.id).toBe("e1")
		expect(events[1]?.id).toBe("e2")
	})

	it("recursively collects events from nested agents", () => {
		const child = {
			id: "child",
			name: "Child",
			parent: "main",
			children: [],
			events: [
				{
					id: "c1",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:02Z"),
					sessionId: "s1",
					agentId: "child",
					agentName: null,
					type: "user-message" as const,
					data: {type: "user-message" as const, text: "child msg"},
				},
			],
			logPath: "/child.jsonl",
		}
		const agent = {
			id: "main",
			name: "Main Agent",
			parent: null,
			children: [child],
			events: [
				{
					id: "m1",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:00Z"),
					sessionId: "s1",
					agentId: "main",
					agentName: null,
					type: "user-message" as const,
					data: {type: "user-message" as const, text: "main msg"},
				},
			],
			logPath: "/main.jsonl",
		}

		const events = extractAllEvents(agent)
		expect(events).toHaveLength(2)
		expect(events[0]?.id).toBe("m1")
		expect(events[1]?.id).toBe("c1")
	})

	it("sorts all events chronologically across agents", () => {
		const child = {
			id: "child",
			name: "Child",
			parent: "main",
			children: [],
			events: [
				{
					id: "c1",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:01Z"),
					sessionId: "s1",
					agentId: "child",
					agentName: null,
					type: "user-message" as const,
					data: {type: "user-message" as const, text: "middle"},
				},
			],
			logPath: "/child.jsonl",
		}
		const agent = {
			id: "main",
			name: "Main Agent",
			parent: null,
			children: [child],
			events: [
				{
					id: "m1",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:00Z"),
					sessionId: "s1",
					agentId: "main",
					agentName: null,
					type: "user-message" as const,
					data: {type: "user-message" as const, text: "first"},
				},
				{
					id: "m2",
					parentId: null,
					timestamp: new Date("2025-01-15T10:00:02Z"),
					sessionId: "s1",
					agentId: "main",
					agentName: null,
					type: "user-message" as const,
					data: {type: "user-message" as const, text: "last"},
				},
			],
			logPath: "/main.jsonl",
		}

		const events = extractAllEvents(agent)
		expect(events.map((e) => e.id)).toEqual(["m1", "c1", "m2"])
	})
})

// ---------------------------------------------------------------------------
// parseSessionLogs (integration)
// ---------------------------------------------------------------------------

describe("parseSessionLogs", () => {
	it("parses simple session fixture end-to-end", async () => {
		const sessionContent = await Bun.file(join(FIXTURES, "simple-session.jsonl")).text()
		const reader = makeReader({"/project/sess-001.jsonl": sessionContent})

		const data = await parseSessionLogs("/project/sess-001.jsonl", "/project/sess-001/subagents", reader)

		expect(data.sessionId).toBe("sess-001")
		expect(data.mainAgent.id).toBe("sess-001")
		expect(data.mainAgent.name).toBe("Main Agent")
		expect(data.mainAgent.model).toBe("claude-sonnet-4-20250514")
		expect(data.mainAgent.children).toHaveLength(0)
		expect(data.allEvents.length).toBeGreaterThan(0)
	})

	it("parses session with agents fixture end-to-end", async () => {
		const mainContent = await Bun.file(join(FIXTURES, "session-with-agents.jsonl")).text()
		const agentContent = await Bun.file(
			join(FIXTURES, "session-with-agents/subagents/agent-abc1234.jsonl"),
		).text()

		const reader = makeReader({
			"/project/sess-002.jsonl": mainContent,
			"/project/sess-002/subagents/agent-abc1234.jsonl": agentContent,
		})

		const data = await parseSessionLogs("/project/sess-002.jsonl", "/project/sess-002/subagents", reader)

		expect(data.sessionId).toBe("sess-002")
		expect(data.mainAgent.children).toHaveLength(1)

		const child = data.mainAgent.children[0]
		expect(child?.id).toBe("abc1234")
		expect(child?.name).toBe("Refactor utils module")
		expect(child?.events.length).toBeGreaterThan(0)
	})
})
