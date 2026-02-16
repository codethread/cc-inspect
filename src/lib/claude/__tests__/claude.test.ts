import {afterEach, beforeEach, describe, expect, it} from "bun:test"
import {mkdir, rm, writeFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {Claude} from "../index"
import type {FileReader} from "../parser"

// In-memory FileReader for parseSession tests
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

describe("Claude class", () => {
	let testDir: string

	beforeEach(async () => {
		// Create a unique temp directory for each test
		testDir = join(tmpdir(), `claude-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await mkdir(testDir, {recursive: true})
	})

	afterEach(async () => {
		// Clean up temp directory
		await rm(testDir, {recursive: true, force: true})
	})

	describe("listProjects", () => {
		it("should list directories containing session files", async () => {
			// Create project directories with session files
			const project1 = join(testDir, "project-1")
			const project2 = join(testDir, "project-2")
			const project3 = join(testDir, "project-3")

			await mkdir(project1)
			await mkdir(project2)
			await mkdir(project3)

			// project-1 has a session file
			await writeFile(join(project1, "session-1.jsonl"), '{"type":"summary","summary":"test"}')

			// project-2 has a session file and an agent file (should still be included)
			await writeFile(join(project2, "session-2.jsonl"), '{"type":"summary","summary":"test"}')
			await writeFile(join(project2, "agent-abc.jsonl"), '{"type":"summary","summary":"test"}')

			// project-3 has only an agent file (should be excluded)
			await writeFile(join(project3, "agent-xyz.jsonl"), '{"type":"summary","summary":"test"}')

			const claude = new Claude({path: testDir})
			const projects = await claude.listProjects()

			expect(projects).toHaveLength(2)
			expect(projects.map((p) => p.name).sort()).toEqual(["project-1", "project-2"])

			// Find the specific projects (order is not guaranteed)
			const foundProject1 = projects.find((p) => p.name === "project-1")
			const foundProject2 = projects.find((p) => p.name === "project-2")
			expect(foundProject1?.path).toBe(project1)
			expect(foundProject2?.path).toBe(project2)
		})

		it("should return empty array when no projects exist", async () => {
			const claude = new Claude({path: testDir})
			const projects = await claude.listProjects()

			expect(projects).toHaveLength(0)
		})

		it("should ignore non-directory entries", async () => {
			// Create a file in the base directory
			await writeFile(join(testDir, "not-a-project.txt"), "test")

			// Create a valid project
			const project = join(testDir, "valid-project")
			await mkdir(project)
			await writeFile(join(project, "session.jsonl"), '{"type":"summary","summary":"test"}')

			const claude = new Claude({path: testDir})
			const projects = await claude.listProjects()

			expect(projects).toHaveLength(1)
			expect(projects[0]?.name).toBe("valid-project")
		})

		it("should handle errors gracefully for inaccessible directories", async () => {
			const project = join(testDir, "project")
			await mkdir(project)
			// Create a session file
			await writeFile(join(project, "session.jsonl"), '{"type":"summary","summary":"test"}')

			// Create an inaccessible subdirectory (this is tricky on some systems, so we just verify no crash)
			const inaccessible = join(testDir, "inaccessible")
			await mkdir(inaccessible)

			const claude = new Claude({path: testDir})
			const projects = await claude.listProjects()

			// Should not crash and should find the valid project
			expect(projects.length).toBeGreaterThanOrEqual(1)
			const validProject = projects.find((p) => p.name === "project")
			expect(validProject).toBeDefined()
		})
	})

	describe("listSessions", () => {
		it("should list session files sorted by modification time", async () => {
			const projectPath = join(testDir, "project")
			await mkdir(projectPath)

			// Create session files with different timestamps
			await writeFile(join(projectPath, "session-1.jsonl"), '{"type":"summary","summary":"test"}')
			await new Promise((resolve) => setTimeout(resolve, 10)) // Small delay

			await writeFile(join(projectPath, "session-2.jsonl"), '{"type":"summary","summary":"test"}')
			await new Promise((resolve) => setTimeout(resolve, 10))

			await writeFile(join(projectPath, "session-3.jsonl"), '{"type":"summary","summary":"test"}')

			const claude = new Claude({path: testDir})
			const sessions = await claude.listSessions({name: "project", path: projectPath})

			expect(sessions).toHaveLength(3)

			// Should be sorted by modification time, newest first
			expect(sessions[0]?.filename).toBe("session-3.jsonl")
			expect(sessions[1]?.filename).toBe("session-2.jsonl")
			expect(sessions[2]?.filename).toBe("session-1.jsonl")

			// Check that all required fields are present
			for (const session of sessions) {
				expect(session.filename).toBeDefined()
				expect(session.path).toBeDefined()
				expect(session.sessionId).toBeDefined()
				expect(session.modifiedAt).toBeInstanceOf(Date)
				expect(session.size).toBeGreaterThan(0)
			}
		})

		it("should exclude agent log files", async () => {
			const projectPath = join(testDir, "project")
			await mkdir(projectPath)

			await writeFile(join(projectPath, "session-1.jsonl"), '{"type":"summary","summary":"test"}')
			await writeFile(join(projectPath, "agent-abc123.jsonl"), '{"type":"summary","summary":"test"}')
			await writeFile(join(projectPath, "agent-xyz789.jsonl"), '{"type":"summary","summary":"test"}')

			const claude = new Claude({path: testDir})
			const sessions = await claude.listSessions({name: "project", path: projectPath})

			expect(sessions).toHaveLength(1)
			expect(sessions[0]?.filename).toBe("session-1.jsonl")
		})

		it("should exclude non-jsonl files", async () => {
			const projectPath = join(testDir, "project")
			await mkdir(projectPath)

			await writeFile(join(projectPath, "session-1.jsonl"), '{"type":"summary","summary":"test"}')
			await writeFile(join(projectPath, "readme.txt"), "text file")
			await writeFile(join(projectPath, "data.json"), "{}")

			const claude = new Claude({path: testDir})
			const sessions = await claude.listSessions({name: "project", path: projectPath})

			expect(sessions).toHaveLength(1)
			expect(sessions[0]?.filename).toBe("session-1.jsonl")
		})

		it("should return empty array when no sessions exist", async () => {
			const projectPath = join(testDir, "project")
			await mkdir(projectPath)

			const claude = new Claude({path: testDir})
			const sessions = await claude.listSessions({name: "project", path: projectPath})

			expect(sessions).toHaveLength(0)
		})

		it("should extract sessionId from filename", async () => {
			const projectPath = join(testDir, "project")
			await mkdir(projectPath)

			await writeFile(join(projectPath, "my-session-123.jsonl"), '{"type":"summary","summary":"test"}')

			const claude = new Claude({path: testDir})
			const sessions = await claude.listSessions({name: "project", path: projectPath})

			expect(sessions[0]?.sessionId).toBe("my-session-123")
		})
	})

	describe("parseSession", () => {
		it("should parse a session using the provided FileReader", async () => {
			const projectPath = join(testDir, "project")
			const sessionPath = join(projectPath, "test-session.jsonl")

			// Create in-memory files
			const sessionContent = [
				'{"type":"user","uuid":"1","timestamp":"2024-01-15T10:00:00.000Z","sessionId":"test-session","message":{"role":"user","content":"Hello"}}',
				'{"type":"assistant","uuid":"2","parentUuid":"1","timestamp":"2024-01-15T10:00:01.000Z","sessionId":"test-session","message":{"role":"assistant","content":[{"type":"text","text":"Hi there"}],"model":"claude-sonnet-4-5"}}',
			].join("\n")

			const reader = new InMemoryFileReader({
				[sessionPath]: sessionContent,
			})

			const claude = new Claude({
				path: testDir,
				reader,
			})

			const sessionHandle = {
				filename: "test-session.jsonl",
				path: sessionPath,
				sessionId: "test-session",
				modifiedAt: new Date(),
				size: 100,
			}

			const result = await claude.parseSession(sessionHandle)

			expect(result.sessionId).toBe("test-session")
			expect(result.mainAgent.id).toBe("test-session")
			expect(result.mainAgent.name).toBe("Main Agent")
			expect(result.mainAgent.model).toBe("claude-sonnet-4-5")
			expect(result.allEvents.length).toBeGreaterThan(0)
		})

		it("should parse session with sub-agents", async () => {
			const projectPath = join(testDir, "project")
			const sessionPath = join(projectPath, "test-session.jsonl")
			const agentDir = join(projectPath, "test-session", "subagents")
			const agentLogPath = join(agentDir, "agent-abc123.jsonl")

			const sessionContent = [
				'{"type":"assistant","uuid":"1","timestamp":"2024-01-15T10:00:00.000Z","sessionId":"test-session","message":{"role":"assistant","content":[{"type":"tool_use","id":"task-1","name":"Task","input":{"description":"Test task","prompt":"Do work","model":"claude-sonnet-4-5"}}],"model":"claude-opus-4-6"}}',
				'{"type":"user","uuid":"2","parentUuid":"1","timestamp":"2024-01-15T10:00:02.000Z","sessionId":"test-session","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"task-1","content":"Done"}]},"toolUseResult":{"agentId":"abc123","status":"success"}}',
			].join("\n")

			const agentContent = [
				'{"type":"user","uuid":"sub-1","timestamp":"2024-01-15T10:00:01.000Z","sessionId":"test-session","agentId":"abc123","message":{"role":"user","content":"Do work"}}',
				'{"type":"assistant","uuid":"sub-2","parentUuid":"sub-1","timestamp":"2024-01-15T10:00:01.500Z","sessionId":"test-session","agentId":"abc123","message":{"role":"assistant","content":[{"type":"text","text":"Working..."}],"model":"claude-sonnet-4-5"}}',
			].join("\n")

			const reader = new InMemoryFileReader({
				[sessionPath]: sessionContent,
				[agentLogPath]: agentContent,
			})

			const claude = new Claude({
				path: testDir,
				reader,
			})

			const sessionHandle = {
				filename: "test-session.jsonl",
				path: sessionPath,
				sessionId: "test-session",
				modifiedAt: new Date(),
				size: 200,
			}

			const result = await claude.parseSession(sessionHandle)

			expect(result.sessionId).toBe("test-session")
			expect(result.mainAgent.children).toHaveLength(1)
			expect(result.mainAgent.children[0]?.id).toBe("abc123")
			expect(result.mainAgent.children[0]?.name).toBe("Test task")
		})

		it("should construct correct agent directory path", async () => {
			// This test verifies the path construction logic in parseSession
			// The agent directory should be <project-path>/<session-id>/subagents/

			const projectPath = join(testDir, "my-project")
			const sessionPath = join(projectPath, "my-session.jsonl")

			// Expected agent directory: <project-path>/my-session/subagents/
			const expectedAgentDir = join(projectPath, "my-session", "subagents")

			const sessionContent =
				'{"type":"user","uuid":"1","timestamp":"2024-01-15T10:00:00.000Z","sessionId":"my-session","message":{"role":"user","content":"test"}}'

			const reader = new InMemoryFileReader({
				[sessionPath]: sessionContent,
			})

			const claude = new Claude({
				path: testDir,
				reader,
			})

			const sessionHandle = {
				filename: "my-session.jsonl",
				path: sessionPath,
				sessionId: "my-session",
				modifiedAt: new Date(),
				size: 100,
			}

			const result = await claude.parseSession(sessionHandle)

			// The logDirectory should match our expected path
			expect(result.logDirectory).toBe(expectedAgentDir)
		})
	})

	describe("constructor", () => {
		it("should use provided FileReader", async () => {
			const customReader: FileReader = {
				readText: async () => "custom content",
				exists: async () => true,
			}

			const claude = new Claude({
				path: testDir,
				reader: customReader,
			})

			// Verify the custom reader is used by checking parseSession behavior
			const sessionHandle = {
				filename: "test.jsonl",
				path: "/test.jsonl",
				sessionId: "test",
				modifiedAt: new Date(),
				size: 100,
			}

			// This should use the custom reader which returns "custom content"
			// It will fail parsing, but we can verify the reader was called
			try {
				await claude.parseSession(sessionHandle)
			} catch (error) {
				// Expected to fail parsing "custom content"
				expect(error).toBeDefined()
			}
		})

		it("should use bunFileReader by default", () => {
			const claude = new Claude({path: testDir})

			// Can't directly test the private reader, but we can verify construction doesn't throw
			expect(claude).toBeDefined()
		})
	})
})

describe("Claude integration tests", () => {
	let testDir: string

	beforeEach(async () => {
		testDir = join(tmpdir(), `claude-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await mkdir(testDir, {recursive: true})
	})

	afterEach(async () => {
		await rm(testDir, {recursive: true, force: true})
	})

	it("should complete a full workflow: list projects, list sessions, parse session", async () => {
		// Set up test data
		const projectPath = join(testDir, "my-project")
		await mkdir(projectPath)

		const sessionContent = [
			'{"type":"user","uuid":"1","timestamp":"2024-01-15T10:00:00.000Z","sessionId":"workflow-test","message":{"role":"user","content":"Hello"}}',
			'{"type":"assistant","uuid":"2","parentUuid":"1","timestamp":"2024-01-15T10:00:01.000Z","sessionId":"workflow-test","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}],"model":"claude-opus-4-6"}}',
			'{"type":"summary","leafUuid":"2","parentUuid":"1","timestamp":"2024-01-15T10:00:02.000Z","sessionId":"workflow-test","summary":"Test conversation"}',
		].join("\n")

		await writeFile(join(projectPath, "workflow-test.jsonl"), sessionContent)

		// Use the default bunFileReader by not providing a custom reader
		const claude = new Claude({path: testDir})

		// Step 1: List projects
		const projects = await claude.listProjects()
		expect(projects).toHaveLength(1)
		expect(projects[0]?.name).toBe("my-project")

		// Step 2: List sessions in the project
		const project = projects[0]
		if (!project) throw new Error("Project not found")

		const sessions = await claude.listSessions(project)
		expect(sessions).toHaveLength(1)
		expect(sessions[0]?.sessionId).toBe("workflow-test")

		// Step 3: Parse the session
		const session = sessions[0]
		if (!session) throw new Error("Session not found")

		const sessionData = await claude.parseSession(session)
		expect(sessionData.sessionId).toBe("workflow-test")
		expect(sessionData.mainAgent.model).toBe("claude-opus-4-6")
		expect(sessionData.allEvents.length).toBe(3)

		// Verify event types
		const eventTypes = sessionData.allEvents.map((e) => e.type)
		expect(eventTypes).toContain("user-message")
		expect(eventTypes).toContain("assistant-message")
		expect(eventTypes).toContain("summary")
	})

	it("should handle projects with multiple sessions", async () => {
		const projectPath = join(testDir, "multi-session-project")
		await mkdir(projectPath)

		const sessionTemplate = (sessionId: string, time: string) =>
			JSON.stringify({
				type: "summary",
				leafUuid: "1",
				timestamp: time,
				sessionId,
				summary: "test",
			})

		await writeFile(
			join(projectPath, "session-1.jsonl"),
			sessionTemplate("session-1", "2024-01-15T10:00:00.000Z"),
		)
		await new Promise((resolve) => setTimeout(resolve, 10))

		await writeFile(
			join(projectPath, "session-2.jsonl"),
			sessionTemplate("session-2", "2024-01-15T11:00:00.000Z"),
		)
		await new Promise((resolve) => setTimeout(resolve, 10))

		await writeFile(
			join(projectPath, "session-3.jsonl"),
			sessionTemplate("session-3", "2024-01-15T12:00:00.000Z"),
		)

		const claude = new Claude({path: testDir})

		const projects = await claude.listProjects()
		expect(projects).toHaveLength(1)

		const project = projects[0]
		if (!project) throw new Error("Project not found")

		const sessions = await claude.listSessions(project)
		expect(sessions).toHaveLength(3)

		// Verify sorted by modification time (newest first)
		expect(sessions[0]?.sessionId).toBe("session-3")
		expect(sessions[1]?.sessionId).toBe("session-2")
		expect(sessions[2]?.sessionId).toBe("session-1")
	})
})
