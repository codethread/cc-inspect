import {describe, expect, it} from "bun:test"
import {join} from "node:path"
import {ParseError} from "../errors"
import type {FileReader} from "../parser"
import {parseSessionLogs} from "../parser"
import type {LogEntry, Message, MessageContent, TextContent, ToolUseContent, ToolUseResult} from "../types"

// Factory functions for creating test data
const makeTextContent = (text: string): TextContent => ({
	type: "text",
	text,
})

const makeToolUseContent = (id: string, name: string, input: Record<string, unknown>): ToolUseContent => ({
	type: "tool_use",
	id,
	name,
	input,
})

const makeUserMessage = (content: string | MessageContent[]): Message => ({
	role: "user",
	content,
})

const makeAssistantMessage = (content: MessageContent[], model?: string): Message => ({
	role: "assistant",
	content,
	model,
})

const makeLogEntry = (overrides: Partial<LogEntry>): LogEntry => ({
	type: "user",
	uuid: "test-uuid",
	parentUuid: null,
	timestamp: "2024-01-15T10:00:00.000Z",
	sessionId: "test-session",
	...overrides,
})

const makeToolUseResult = (overrides: Partial<ToolUseResult> = {}): ToolUseResult => ({
	status: "success",
	...overrides,
})

// In-memory FileReader for testing
class InMemoryFileReader implements FileReader {
	private files: Map<string, string>

	constructor(files: Record<string, string>) {
		this.files = new Map(Object.entries(files))
	}

	async readText(path: string): Promise<string> {
		const content = this.files.get(path)
		if (content === undefined) {
			throw new Error(`File not found: ${path}`)
		}
		return content
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path)
	}
}

describe("parseSessionLogs", () => {
	it("should parse a simple session with no agents", async () => {
		const fixturesDir = join(import.meta.dir, "fixtures")
		const sessionPath = join(fixturesDir, "simple-session.jsonl")
		const agentDir = join(fixturesDir, "simple-session", "subagents")

		const sessionContent = await Bun.file(sessionPath).text()
		const reader = new InMemoryFileReader({
			[sessionPath]: sessionContent,
		})

		const result = await parseSessionLogs(sessionPath, agentDir, reader)

		expect(result.sessionId).toBe("simple-session")
		expect(result.mainAgent.id).toBe("simple-session")
		expect(result.mainAgent.name).toBe("Main Agent")
		expect(result.mainAgent.model).toBe("claude-sonnet-4-5")
		expect(result.mainAgent.children).toHaveLength(0)
		expect(result.allEvents.length).toBeGreaterThan(0)

		// Check event types
		const eventTypes = result.allEvents.map((e) => e.type)
		expect(eventTypes).toContain("user-message")
		expect(eventTypes).toContain("assistant-message")
		expect(eventTypes).toContain("thinking")
		expect(eventTypes).toContain("tool-use")
		expect(eventTypes).toContain("tool-result")
		expect(eventTypes).toContain("summary")
	})

	it("should parse a session with sub-agents", async () => {
		const fixturesDir = join(import.meta.dir, "fixtures")
		const sessionPath = join(fixturesDir, "session-with-agents.jsonl")
		const agentDir = join(fixturesDir, "session-with-agents", "subagents")

		const sessionContent = await Bun.file(sessionPath).text()
		const agentLogPath = join(agentDir, "agent-abc1234.jsonl")
		const agentContent = await Bun.file(agentLogPath).text()

		const reader = new InMemoryFileReader({
			[sessionPath]: sessionContent,
			[agentLogPath]: agentContent,
		})

		const result = await parseSessionLogs(sessionPath, agentDir, reader)

		expect(result.sessionId).toBe("session-with-agents")
		expect(result.mainAgent.children).toHaveLength(1)

		const subAgent = result.mainAgent.children[0]
		if (!subAgent) throw new Error("Sub-agent not found")
		expect(subAgent.id).toBe("abc1234")
		expect(subAgent.name).toBe("Analyze code")
		expect(subAgent.model).toBe("claude-sonnet-4-5")
		expect(subAgent.subagentType).toBe("worker")
		expect(subAgent.description).toBe("Analyze code")
		expect(subAgent.events.length).toBeGreaterThan(0)

		// Check that all events are chronologically sorted
		const timestamps = result.allEvents.map((e) => e.timestamp.getTime())
		const sortedTimestamps = [...timestamps].sort((a, b) => a - b)
		expect(timestamps).toEqual(sortedTimestamps)
	})

	it("should throw ParseError on malformed JSON", async () => {
		const fixturesDir = join(import.meta.dir, "fixtures")
		const malformedPath = join(fixturesDir, "malformed.jsonl")
		const agentDir = join(fixturesDir, "malformed", "subagents")

		const malformedContent = await Bun.file(malformedPath).text()
		const reader = new InMemoryFileReader({
			[malformedPath]: malformedContent,
		})

		await expect(parseSessionLogs(malformedPath, agentDir, reader)).rejects.toThrow(ParseError)
	})
})

describe("extractSessionId", () => {
	it.each([
		["/path/to/session-123.jsonl", "session-123"],
		["session-456.jsonl", "session-456"],
		["/deep/nested/path/my-session.jsonl", "my-session"],
		["simple.jsonl", "simple"],
	])("should extract session ID from path %s", async (path, expected) => {
		// We can't directly test this private function, but we can verify it through parseSessionLogs
		const reader = new InMemoryFileReader({
			[path]: '{"type":"summary","leafUuid":"test","timestamp":"2024-01-15T10:00:00.000Z","summary":"test"}',
		})

		const result = await parseSessionLogs(path, "/tmp", reader)
		expect(result.sessionId).toBe(expected)
	})
})

describe("normalizeToolUseResult", () => {
	it.each([
		["undefined", undefined, undefined],
		["string", "error message", undefined],
		["single object", {status: "success"}, {status: "success"}],
		["array with one element", [{status: "success", agentId: "abc"}], {status: "success", agentId: "abc"}],
		["array with multiple elements", [{status: "first"}, {status: "second"}], {status: "first"}],
	])("should handle %s input", async (_label, input, expected) => {
		// Test through parseSessionLogs by checking event data
		const logEntry = JSON.stringify({
			type: "user",
			uuid: "test-1",
			timestamp: "2024-01-15T10:00:00.000Z",
			sessionId: "test",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: "result",
					},
				],
			},
			toolUseResult: input,
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": logEntry,
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp", reader)
		const toolResultEvent = result.allEvents.find((e) => e.type === "tool-result")

		if (expected === undefined) {
			// When normalized to undefined, agentId should also be undefined
			expect(toolResultEvent?.data.type === "tool-result" && toolResultEvent.data.agentId).toBeUndefined()
		} else {
			// When we have a result, agentId should be extracted correctly
			if ("agentId" in expected) {
				expect(toolResultEvent?.data.type === "tool-result" && toolResultEvent.data.agentId).toBe(
					expected.agentId,
				)
			}
		}
	})
})

describe("findAgentLogs", () => {
	it("should discover agent logs referenced in toolUseResult", async () => {
		const sessionContent = JSON.stringify({
			type: "user",
			uuid: "test-1",
			timestamp: "2024-01-15T10:00:00.000Z",
			sessionId: "test",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "t1", content: "done"}]},
			toolUseResult: {agentId: "agent-xyz", status: "success"},
		})

		const agentLogPath = "/tmp/subagents/agent-agent-xyz.jsonl"
		const agentContent = JSON.stringify({
			type: "user",
			uuid: "a1",
			timestamp: "2024-01-15T10:00:01.000Z",
			sessionId: "test",
			agentId: "agent-xyz",
			message: {role: "user", content: "test"},
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": sessionContent,
			[agentLogPath]: agentContent,
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp/subagents", reader)
		expect(result.mainAgent.children).toHaveLength(1)
		expect(result.mainAgent.children[0]?.id).toBe("agent-xyz")
	})
})

describe("extractMainAgentModel", () => {
	it("should extract model from first assistant message", async () => {
		const entries = [
			makeLogEntry({
				type: "user",
				message: makeUserMessage("Hello"),
			}),
			makeLogEntry({
				type: "assistant",
				message: makeAssistantMessage([makeTextContent("Hi there")], "claude-opus-4-6"),
			}),
		]

		const content = entries.map((e) => JSON.stringify(e)).join("\n")
		const reader = new InMemoryFileReader({"/test.jsonl": content})

		const result = await parseSessionLogs("/test.jsonl", "/tmp", reader)
		expect(result.mainAgent.model).toBe("claude-opus-4-6")
	})

	it("should return undefined when no assistant message has model", async () => {
		const entry = makeLogEntry({
			type: "user",
			message: makeUserMessage("Hello"),
		})

		const reader = new InMemoryFileReader({"/test.jsonl": JSON.stringify(entry)})

		const result = await parseSessionLogs("/test.jsonl", "/tmp", reader)
		expect(result.mainAgent.model).toBeUndefined()
	})
})

describe("extractAgentInfo", () => {
	it("should extract agent info from Task tool use", async () => {
		const entries = [
			JSON.stringify({
				type: "assistant",
				uuid: "uuid-1",
				timestamp: "2024-01-15T10:00:00.000Z",
				sessionId: "test",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "task-1",
							name: "Task",
							input: {
								description: "Test task",
								prompt: "Do something",
								model: "claude-sonnet-4-5",
								subagent_type: "worker",
							},
						},
					],
					model: "claude-opus-4-6",
				},
			}),
			JSON.stringify({
				type: "user",
				uuid: "uuid-2",
				timestamp: "2024-01-15T10:00:01.000Z",
				sessionId: "test",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "task-1", content: "Done"}],
				},
				toolUseResult: {agentId: "test-agent", status: "success"},
			}),
		]

		const agentLog = JSON.stringify({
			type: "user",
			uuid: "sub-1",
			timestamp: "2024-01-15T10:00:00.500Z",
			sessionId: "test",
			agentId: "test-agent",
			message: {role: "user", content: "test"},
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": entries.join("\n"),
			"/tmp/subagents/agent-test-agent.jsonl": agentLog,
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp/subagents", reader)
		const agent = result.mainAgent.children[0]
		expect(agent?.name).toBe("Test task")
		expect(agent?.description).toBe("Test task")
		expect(agent?.model).toBeUndefined() // No assistant message in agent log
		expect(agent?.subagentType).toBe("worker")
	})

	it("should detect resumed agents", async () => {
		const entries = [
			JSON.stringify({
				type: "assistant",
				uuid: "uuid-1",
				timestamp: "2024-01-15T10:00:00.000Z",
				sessionId: "test",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "resume-1",
							name: "Task",
							input: {
								description: "Resume agent",
								resume: "resumed-agent",
							},
						},
					],
					model: "claude-opus-4-6",
				},
			}),
			JSON.stringify({
				type: "user",
				uuid: "uuid-2",
				timestamp: "2024-01-15T10:00:01.000Z",
				sessionId: "test",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "resume-1", content: "Resumed"}],
				},
				toolUseResult: {agentId: "resumed-agent", status: "success"},
			}),
		]

		const agentLog = JSON.stringify({
			type: "user",
			uuid: "sub-1",
			timestamp: "2024-01-15T10:00:00.500Z",
			sessionId: "test",
			agentId: "resumed-agent",
			message: {role: "user", content: "test"},
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": entries.join("\n"),
			"/tmp/subagents/agent-resumed-agent.jsonl": agentLog,
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp/subagents", reader)
		const agent = result.mainAgent.children[0]
		expect(agent?.isResumed).toBe(true)
		expect(agent?.resumedFrom).toBe("resume-1")
	})
})

describe("parseEvents", () => {
	it.each([
		["user-message with string content", "user", "user-message"],
		["user-message with array content", "user", "user-message"],
		["assistant-message", "assistant", "assistant-message"],
		["thinking", "assistant", "thinking"],
		["tool-use", "assistant", "tool-use"],
		["tool-result", "user", "tool-result"],
		["summary", "summary", "summary"],
	])("should parse %s", async (_label, _logType, expectedEventType) => {
		let logEntry: LogEntry

		switch (expectedEventType) {
			case "user-message":
				logEntry = makeLogEntry({
					type: "user",
					message: makeUserMessage("Hello"),
				})
				break
			case "assistant-message":
				logEntry = makeLogEntry({
					type: "assistant",
					message: makeAssistantMessage([makeTextContent("Hi")], "claude-sonnet-4-5"),
				})
				break
			case "thinking":
				logEntry = makeLogEntry({
					type: "assistant",
					message: makeAssistantMessage(
						[{type: "thinking", thinking: "Let me think..."}],
						"claude-sonnet-4-5",
					),
				})
				break
			case "tool-use":
				logEntry = makeLogEntry({
					type: "assistant",
					message: makeAssistantMessage(
						[makeToolUseContent("tool-1", "Read", {file_path: "/test.txt"})],
						"claude-sonnet-4-5",
					),
				})
				break
			case "tool-result":
				logEntry = makeLogEntry({
					type: "user",
					message: {
						role: "user",
						content: [{type: "tool_result", tool_use_id: "tool-1", content: "result"}],
					},
					toolUseResult: makeToolUseResult(),
				})
				break
			case "summary":
				logEntry = {
					type: "summary",
					leafUuid: "leaf-1",
					parentUuid: null,
					timestamp: "2024-01-15T10:00:00.000Z",
					sessionId: "test",
					summary: "Summary text",
				}
				break
			default:
				throw new Error(`Unknown event type: ${expectedEventType}`)
		}

		const reader = new InMemoryFileReader({
			"/test.jsonl": JSON.stringify(logEntry),
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp", reader)
		const event = result.allEvents.find((e) => e.type === expectedEventType)
		expect(event).toBeDefined()
		expect(event?.type).toBe(expectedEventType)
	})

	it("should handle tool-use with Task resume", async () => {
		const logEntry = makeLogEntry({
			type: "assistant",
			message: makeAssistantMessage(
				[
					makeToolUseContent("resume-1", "Task", {
						description: "Resume task",
						resume: "agent-123",
					}),
				],
				"claude-sonnet-4-5",
			),
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": JSON.stringify(logEntry),
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp", reader)
		const event = result.allEvents.find((e) => e.type === "tool-use")

		expect(event?.type).toBe("tool-use")
		if (event && event.data.type === "tool-use") {
			expect(event.data.isResume).toBe(true)
			expect(event.data.resumesAgentId).toBe("agent-123")
		}
	})
})

describe("parseSessionEventsForAgent", () => {
	it("should extract tool results belonging to resumed agents", async () => {
		const entries = [
			JSON.stringify({
				type: "user",
				uuid: "main-1",
				timestamp: "2024-01-15T10:00:00.000Z",
				sessionId: "test",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "tool-1", content: "First result"}],
				},
				toolUseResult: {agentId: "agent-1", status: "success"},
			}),
			JSON.stringify({
				type: "user",
				uuid: "main-2",
				timestamp: "2024-01-15T10:00:02.000Z",
				sessionId: "test",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "tool-2", content: "Resumed result"}],
				},
				toolUseResult: {agentId: "agent-1", status: "success"},
			}),
		]

		// Agent log only has events up to first result
		const agentLog = JSON.stringify({
			type: "user",
			uuid: "agent-1-1",
			timestamp: "2024-01-15T10:00:01.000Z",
			sessionId: "test",
			agentId: "agent-1",
			message: {role: "user", content: "agent work"},
		})

		const toolUseEntry = JSON.stringify({
			type: "assistant",
			uuid: "main-0",
			timestamp: "2024-01-15T09:59:59.000Z",
			sessionId: "test",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "task-1",
						name: "Task",
						input: {description: "Test", prompt: "test"},
					},
				],
			},
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": [toolUseEntry, ...entries].join("\n"),
			"/tmp/subagents/agent-agent-1.jsonl": agentLog,
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp/subagents", reader)
		const agent = result.mainAgent.children[0]

		// Agent should have events from both its own log and the session log
		expect(agent?.events.length).toBeGreaterThan(1)
		const toolResults = agent?.events.filter((e) => e.type === "tool-result")
		expect(toolResults?.length).toBeGreaterThanOrEqual(2)
	})
})

describe("buildAgentTree", () => {
	it("should build a tree with nested agents", async () => {
		// Create a main session that spawns an agent
		const mainEntries = [
			JSON.stringify({
				type: "assistant",
				uuid: "main-1",
				timestamp: "2024-01-15T10:00:00.000Z",
				sessionId: "test",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "task-1",
							name: "Task",
							input: {
								description: "Child agent",
								prompt: "Do work",
								model: "claude-sonnet-4-5",
							},
						},
					],
					model: "claude-opus-4-6",
				},
			}),
			JSON.stringify({
				type: "user",
				uuid: "main-2",
				timestamp: "2024-01-15T10:00:02.000Z",
				sessionId: "test",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "task-1", content: "Done"}],
				},
				toolUseResult: {agentId: "child-1", status: "success"},
			}),
		]

		const childLog = JSON.stringify({
			type: "assistant",
			uuid: "child-1",
			timestamp: "2024-01-15T10:00:01.000Z",
			sessionId: "test",
			agentId: "child-1",
			message: {
				role: "assistant",
				content: [{type: "text", text: "Working..."}],
				model: "claude-sonnet-4-5",
			},
		})

		const reader = new InMemoryFileReader({
			"/test.jsonl": mainEntries.join("\n"),
			"/tmp/subagents/agent-child-1.jsonl": childLog,
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp/subagents", reader)

		expect(result.mainAgent.id).toBe("test")
		expect(result.mainAgent.parent).toBeNull()
		expect(result.mainAgent.children).toHaveLength(1)

		const child = result.mainAgent.children[0]
		expect(child?.id).toBe("child-1")
		expect(child?.parent).toBe("test")
		expect(child?.children).toHaveLength(0)
	})
})

describe("extractAllEvents", () => {
	it("should flatten and sort events from agent tree", async () => {
		const fixturesDir = join(import.meta.dir, "fixtures")
		const sessionPath = join(fixturesDir, "session-with-agents.jsonl")
		const agentDir = join(fixturesDir, "session-with-agents", "subagents")

		const sessionContent = await Bun.file(sessionPath).text()
		const agentLogPath = join(agentDir, "agent-abc1234.jsonl")
		const agentContent = await Bun.file(agentLogPath).text()

		const reader = new InMemoryFileReader({
			[sessionPath]: sessionContent,
			[agentLogPath]: agentContent,
		})

		const result = await parseSessionLogs(sessionPath, agentDir, reader)

		// All events should be flattened
		const mainEventCount = result.mainAgent.events.length
		const childEventCounts = result.mainAgent.children.reduce((sum, child) => sum + child.events.length, 0)
		expect(result.allEvents.length).toBe(mainEventCount + childEventCounts)

		// All events should be sorted by timestamp
		for (let i = 1; i < result.allEvents.length; i++) {
			const prev = result.allEvents[i - 1]
			const curr = result.allEvents[i]
			if (!prev || !curr) continue
			expect(prev.timestamp.getTime()).toBeLessThanOrEqual(curr.timestamp.getTime())
		}
	})
})

describe("parseJsonlFile error handling", () => {
	it("should provide detailed error for invalid JSON", async () => {
		const reader = new InMemoryFileReader({
			"/test.jsonl": "{invalid json",
		})

		try {
			await parseSessionLogs("/test.jsonl", "/tmp", reader)
			throw new Error("Should have thrown ParseError")
		} catch (error) {
			expect(error).toBeInstanceOf(ParseError)
			if (error instanceof ParseError) {
				expect(error.filePath).toBe("/test.jsonl")
				expect(error.lineNumber).toBe(1)
				expect(error.message).toContain("Failed to parse JSON")
			}
		}
	})

	it("should provide detailed error for schema validation failure", async () => {
		// This will fail because the entry doesn't match the expected schema
		// The schema is quite permissive, so let's use a more clearly invalid entry
		const invalidReader = new InMemoryFileReader({
			"/test.jsonl": '{"type":"user","message":{"role":"invalid_role","content":"test"}}',
		})

		try {
			await parseSessionLogs("/test.jsonl", "/tmp", invalidReader)
			throw new Error("Should have thrown ParseError")
		} catch (error) {
			expect(error).toBeInstanceOf(ParseError)
			if (error instanceof ParseError) {
				expect(error.zodError).toBeDefined()
			}
		}
	})

	it("should skip empty lines", async () => {
		const entries = [
			'{"type":"user","uuid":"1","timestamp":"2024-01-15T10:00:00.000Z","sessionId":"test","message":{"role":"user","content":"test"}}',
			"",
			'{"type":"summary","leafUuid":"2","timestamp":"2024-01-15T10:00:01.000Z","summary":"test"}',
		]

		const reader = new InMemoryFileReader({
			"/test.jsonl": entries.join("\n"),
		})

		const result = await parseSessionLogs("/test.jsonl", "/tmp", reader)
		expect(result.allEvents.length).toBe(2) // Two valid entries
	})
})
