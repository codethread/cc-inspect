import {afterEach, describe, expect, it} from "bun:test"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {Claude} from "../index"
import type {FileReader} from "../parser"
import type {ProjectHandle} from "../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDirs: string[] = []

async function createTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "cc-inspect-test-"))
	tempDirs.push(dir)
	return dir
}

afterEach(async () => {
	for (const dir of tempDirs) {
		await rm(dir, {recursive: true, force: true})
	}
	tempDirs = []
})

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

function makeMinimalSession(sessionId: string): string {
	return [
		JSON.stringify({
			type: "user",
			uuid: "u1",
			timestamp: "2025-01-15T10:00:00Z",
			sessionId,
			message: {role: "user", content: "hello"},
		}),
		JSON.stringify({
			type: "assistant",
			uuid: "a1",
			parentUuid: "u1",
			timestamp: "2025-01-15T10:00:01Z",
			sessionId,
			message: {
				role: "assistant",
				model: "claude-sonnet-4-20250514",
				content: [{type: "text", text: "hi there"}],
			},
		}),
	].join("\n")
}

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------

describe("Claude.listProjects", () => {
	it("lists directories containing .jsonl files", async () => {
		const base = await createTempDir()
		await mkdir(join(base, "project-a"))
		await writeFile(join(base, "project-a", "session.jsonl"), "{}")
		await mkdir(join(base, "project-b"))
		await writeFile(join(base, "project-b", "session.jsonl"), "{}")

		const claude = new Claude({path: base})
		const projects = await claude.listProjects()

		expect(projects).toHaveLength(2)
		expect(projects.map((p) => p.id)).toEqual(["project-a", "project-b"])
	})

	it("excludes directories with no .jsonl files", async () => {
		const base = await createTempDir()
		await mkdir(join(base, "has-sessions"))
		await writeFile(join(base, "has-sessions", "session.jsonl"), "{}")
		await mkdir(join(base, "empty-dir"))

		const claude = new Claude({path: base})
		const projects = await claude.listProjects()

		expect(projects).toHaveLength(1)
		expect(projects[0]?.id).toBe("has-sessions")
	})

	it("excludes directories that only contain agent-* files", async () => {
		const base = await createTempDir()
		await mkdir(join(base, "agents-only"))
		await writeFile(join(base, "agents-only", "agent-abc.jsonl"), "{}")
		await mkdir(join(base, "has-sessions"))
		await writeFile(join(base, "has-sessions", "session.jsonl"), "{}")

		const claude = new Claude({path: base})
		const projects = await claude.listProjects()

		expect(projects).toHaveLength(1)
		expect(projects[0]?.id).toBe("has-sessions")
	})

	it("returns sorted ProjectHandle array with correct id and path", async () => {
		const base = await createTempDir()
		await mkdir(join(base, "z-project"))
		await writeFile(join(base, "z-project", "s.jsonl"), "{}")
		await mkdir(join(base, "a-project"))
		await writeFile(join(base, "a-project", "s.jsonl"), "{}")

		const claude = new Claude({path: base})
		const projects = await claude.listProjects()

		expect(projects[0]?.id).toBe("a-project")
		expect(projects[0]?.path).toBe(join(base, "a-project"))
		expect(projects[1]?.id).toBe("z-project")
		expect(projects[1]?.path).toBe(join(base, "z-project"))
	})
})

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe("Claude.listSessions", () => {
	it("lists .jsonl files excluding agent-* files", async () => {
		const base = await createTempDir()
		const projectDir = join(base, "project")
		await mkdir(projectDir)
		await writeFile(join(projectDir, "sess-aaa.jsonl"), "{}")
		await writeFile(join(projectDir, "agent-xyz.jsonl"), "{}")

		const claude = new Claude({path: base})
		const project: ProjectHandle = {id: "project", path: projectDir}
		const sessions = await claude.listSessions(project)

		expect(sessions).toHaveLength(1)
		expect(sessions[0]?.id).toBe("sess-aaa")
	})

	it("returns SessionHandle with correct id, sessionFilePath, sessionAgentDir", async () => {
		const base = await createTempDir()
		const projectDir = join(base, "project")
		await mkdir(projectDir)
		await writeFile(join(projectDir, "abc-123.jsonl"), "{}")

		const claude = new Claude({path: base})
		const sessions = await claude.listSessions({id: "project", path: projectDir})

		const session = sessions[0]
		expect(session?.id).toBe("abc-123")
		expect(session?.sessionFilePath).toBe(join(projectDir, "abc-123.jsonl"))
		expect(session?.sessionAgentDir).toBe(join(projectDir, "abc-123", "subagents"))
	})

	it("sorts by modification time descending", async () => {
		const base = await createTempDir()
		const projectDir = join(base, "project")
		await mkdir(projectDir)

		// Write older file first
		await writeFile(join(projectDir, "older.jsonl"), "{}")
		// Small delay so mtime differs
		await new Promise((r) => setTimeout(r, 50))
		await writeFile(join(projectDir, "newer.jsonl"), "{}")

		const claude = new Claude({path: base})
		const sessions = await claude.listSessions({id: "project", path: projectDir})

		expect(sessions[0]?.id).toBe("newer")
		expect(sessions[1]?.id).toBe("older")
	})
})

// ---------------------------------------------------------------------------
// parseSession
// ---------------------------------------------------------------------------

describe("Claude.parseSession", () => {
	it("parses a simple session and returns SessionData", async () => {
		const sessionContent = makeMinimalSession("sess-001")
		const reader = makeReader({
			"/project/sess-001.jsonl": sessionContent,
		})

		const claude = new Claude({path: "/project", reader})
		const data = await claude.parseSession({
			id: "sess-001",
			sessionFilePath: "/project/sess-001.jsonl",
			sessionAgentDir: "/project/sess-001/subagents",
		})

		expect(data.sessionId).toBe("sess-001")
		expect(data.mainAgent.name).toBe("Main Agent")
		expect(data.mainAgent.model).toBe("claude-sonnet-4-20250514")
		expect(data.allEvents.length).toBeGreaterThan(0)
	})

	it("parses session with sub-agents and returns correct agent tree", async () => {
		const mainContent = [
			JSON.stringify({
				type: "user",
				uuid: "u1",
				timestamp: "2025-01-15T10:00:00Z",
				sessionId: "sess-002",
				message: {role: "user", content: "do work"},
			}),
			JSON.stringify({
				type: "assistant",
				uuid: "a1",
				parentUuid: "u1",
				timestamp: "2025-01-15T10:00:01Z",
				sessionId: "sess-002",
				message: {
					role: "assistant",
					model: "claude-sonnet-4-20250514",
					content: [
						{
							type: "tool_use",
							id: "tu1",
							name: "Task",
							input: {description: "Sub task", prompt: "do sub work", subagent_type: "code"},
						},
					],
				},
			}),
			JSON.stringify({
				type: "user",
				uuid: "u2",
				parentUuid: "a1",
				timestamp: "2025-01-15T10:00:10Z",
				sessionId: "sess-002",
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "tu1", content: "done"}]},
				toolUseResult: {agentId: "child-1", status: "completed"},
			}),
		].join("\n")

		const agentContent = makeMinimalSession("sess-002")

		const reader = makeReader({
			"/project/sess-002.jsonl": mainContent,
			"/project/sess-002/subagents/agent-child-1.jsonl": agentContent,
		})

		const claude = new Claude({path: "/project", reader})
		const data = await claude.parseSession({
			id: "sess-002",
			sessionFilePath: "/project/sess-002.jsonl",
			sessionAgentDir: "/project/sess-002/subagents",
		})

		expect(data.mainAgent.children).toHaveLength(1)
		expect(data.mainAgent.children[0]?.id).toBe("child-1")
		expect(data.mainAgent.children[0]?.name).toBe("Sub task")
	})

	it("delegates to parser with the provided FileReader", async () => {
		const calls: string[] = []
		const trackingReader: FileReader = {
			async readText(path: string) {
				calls.push(`readText:${path}`)
				return makeMinimalSession("sess-001")
			},
			async exists(path: string) {
				calls.push(`exists:${path}`)
				return false
			},
		}

		const claude = new Claude({path: "/project", reader: trackingReader})
		await claude.parseSession({
			id: "sess-001",
			sessionFilePath: "/project/sess-001.jsonl",
			sessionAgentDir: "/project/sess-001/subagents",
		})

		expect(calls).toContain("readText:/project/sess-001.jsonl")
	})
})
