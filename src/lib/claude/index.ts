// Claude SDK for parsing and analyzing Claude Code session logs

import {readdir, stat} from "node:fs/promises"
import {join} from "node:path"
import {bunFileReader, type FileReader, parseSessionLogs} from "./parser"
import type {ProjectHandle, SessionData, SessionHandle} from "./types"

export interface ClaudeOptions {
	/**
	 * Base path to the Claude projects directory.
	 * Typically ~/.claude/projects/
	 */
	path: string
	/**
	 * Optional FileReader implementation for reading files.
	 * Defaults to bunFileReader which uses Bun.file API.
	 */
	reader?: FileReader
}

/**
 * Main SDK class for interacting with Claude Code session logs.
 * Provides methods to list projects, list sessions, and parse session data.
 */
export class Claude {
	private readonly basePath: string
	private readonly reader: FileReader

	constructor(options: ClaudeOptions) {
		this.basePath = options.path
		this.reader = options.reader ?? bunFileReader
	}

	/**
	 * List all projects (directories) in the Claude projects directory that contain session files.
	 * Returns an array of ProjectHandle objects with name and path.
	 */
	async listProjects(): Promise<ProjectHandle[]> {
		const entries = await readdir(this.basePath, {withFileTypes: true})
		const projects: ProjectHandle[] = []

		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const projectPath = join(this.basePath, entry.name)

			// Check if this directory contains any .jsonl files (session logs)
			try {
				const files = await readdir(projectPath)
				const hasSessionFiles = files.some((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))

				if (hasSessionFiles) {
					projects.push({
						name: entry.name,
						path: projectPath,
					})
				}
			} catch {}
		}

		return projects
	}

	/**
	 * List all sessions in a given project.
	 * Returns an array of SessionHandle objects sorted by modification time (newest first).
	 * Excludes agent log files (agent-*.jsonl).
	 */
	async listSessions(project: ProjectHandle): Promise<SessionHandle[]> {
		const entries = await readdir(project.path)
		const sessions: SessionHandle[] = []

		for (const filename of entries) {
			// Skip agent logs and non-jsonl files
			if (!filename.endsWith(".jsonl") || filename.startsWith("agent-")) {
				continue
			}

			const filePath = join(project.path, filename)

			try {
				const stats = await stat(filePath)
				const sessionId = filename.replace(".jsonl", "")

				sessions.push({
					filename,
					path: filePath,
					sessionId,
					modifiedAt: stats.mtime,
					size: stats.size,
				})
			} catch {}
		}

		// Sort by modification time, newest first
		sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())

		return sessions
	}

	/**
	 * Parse a session and return the full SessionData structure.
	 * This includes the agent tree, all events, and session metadata.
	 */
	async parseSession(session: SessionHandle): Promise<SessionData> {
		// The session's agent directory is <project-path>/<session-id>/subagents/
		const sessionId = session.sessionId
		const projectPath = join(session.path, "..")
		const sessionAgentDir = join(projectPath, sessionId, "subagents")

		return await parseSessionLogs(session.path, sessionAgentDir, this.reader)
	}
}

// Re-export public types and utilities
export type {FileReader, ProjectHandle, SessionHandle, SessionData}
export {ParseError} from "./errors"
export {bunFileReader} from "./parser"
export * from "./types"
