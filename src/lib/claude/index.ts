// Claude Code SDK entry point

import {readdir, stat} from "node:fs/promises"
import {join} from "node:path"
import type {FileReader} from "./parser"
import {bunFileReader, parseSessionLogs} from "./parser"
import type {ProjectHandle, SessionData, SessionHandle} from "./types"

export interface ClaudeOptions {
	/** Absolute path to the Claude projects base directory */
	path: string
	/** Optional file reader for dependency injection (testing) */
	reader?: FileReader
}

export class Claude {
	private readonly basePath: string
	private readonly reader: FileReader

	constructor(options: ClaudeOptions) {
		this.basePath = options.path
		this.reader = options.reader ?? bunFileReader
	}

	/** List project directories that contain at least one session file */
	async listProjects(): Promise<ProjectHandle[]> {
		const entries = await readdir(this.basePath, {withFileTypes: true})
		const directories = entries
			.filter((entry) => entry.isDirectory())
			.sort((a, b) => a.name.localeCompare(b.name))

		const projects: ProjectHandle[] = []
		for (const dir of directories) {
			const dirPath = join(this.basePath, dir.name)
			try {
				const files = await readdir(dirPath)
				const hasSessionFiles = files.some((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))
				if (hasSessionFiles) {
					projects.push({id: dir.name, path: dirPath})
				}
			} catch {
				// Skip directories that can't be read
			}
		}

		return projects
	}

	/** List session files within a project directory, sorted by modification time descending */
	async listSessions(project: ProjectHandle): Promise<SessionHandle[]> {
		const files = await readdir(project.path)

		// Filter for session files (exclude agent logs)
		const sessionFiles = files.filter((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))

		// Get file stats and build handles
		const sessionsWithMtime = await Promise.all(
			sessionFiles.map(async (file) => {
				const filePath = join(project.path, file)
				const stats = await stat(filePath)
				const sessionId = file.replace(".jsonl", "")
				const customTitle = await this.extractCustomTitle(filePath)
				return {
					handle: {
						id: sessionId,
						sessionFilePath: filePath,
						sessionAgentDir: join(project.path, sessionId, "subagents"),
						...(customTitle && {customTitle}),
					} satisfies SessionHandle,
					mtime: stats.mtime.getTime(),
				}
			}),
		)

		// Sort by modification time, most recent first
		sessionsWithMtime.sort((a, b) => b.mtime - a.mtime)

		return sessionsWithMtime.map((s) => s.handle)
	}

	/** Extract the last custom-title from a session JSONL file, if present */
	private async extractCustomTitle(filePath: string): Promise<string | undefined> {
		try {
			const text = await this.reader.readText(filePath)
			// Fast substring search — avoid splitting the entire file into lines
			const needle = '"custom-title"'
			const idx = text.lastIndexOf(needle)
			if (idx === -1) return undefined
			// Walk back to line start, forward to line end
			const lineStart = text.lastIndexOf("\n", idx) + 1
			const lineEnd = text.indexOf("\n", idx)
			const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
			const parsed = JSON.parse(line)
			if (parsed.type === "custom-title" && parsed.customTitle) {
				return parsed.customTitle
			}
			return undefined
		} catch {
			return undefined
		}
	}

	/** Parse a session into a full agent tree with chronological events */
	async parseSession(session: SessionHandle): Promise<SessionData> {
		return parseSessionLogs(session.sessionFilePath, session.sessionAgentDir, this.reader)
	}
}

// Re-export SDK types and classes
export {ParseError} from "./errors"
export type {FileReader} from "./parser"
export {bunFileReader} from "./parser"
export * from "./types"
