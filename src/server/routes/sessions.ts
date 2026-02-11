import {readdir, stat} from "node:fs/promises"
import {join} from "node:path"
import type {BunRequest} from "bun"
import type {SessionsResponse} from "#types"
import {CLAUDE_PROJECTS_DIR, isValidDirectory} from "../utils"

// API endpoint to get list of session files in a directory
export async function sessionsHandler(req: BunRequest<"/api/session">): Promise<Response> {
	const url = new URL(req.url)
	const directory = url.searchParams.get("directory")

	if (!directory) {
		const response: SessionsResponse = {
			status: "error",
			error: "Missing directory parameter",
		}
		return new Response(JSON.stringify(response), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	// Security: Validate directory parameter to prevent path traversal
	if (!isValidDirectory(directory)) {
		const response: SessionsResponse = {
			status: "error",
			error: "Invalid directory parameter",
		}
		return new Response(JSON.stringify(response), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	try {
		const dirPath = join(CLAUDE_PROJECTS_DIR, directory)
		const files = await readdir(dirPath)

		// Filter for session files (exclude agent logs)
		const sessionFiles = files.filter((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))

		// Get file stats for each session
		const sessions = await Promise.all(
			sessionFiles.map(async (file) => {
				const filePath = join(dirPath, file)
				const stats = await stat(filePath)
				return {
					filename: file,
					path: filePath,
					sessionId: file.replace(".jsonl", ""),
					modifiedAt: stats.mtime.toISOString(),
					size: stats.size,
				}
			}),
		)

		// Sort by modification time, most recent first
		sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())

		const response: SessionsResponse = {status: "success", sessions}
		return new Response(JSON.stringify(response), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		const response: SessionsResponse = {
			status: "error",
			error: `Failed to read sessions: ${message}`,
		}
		return new Response(JSON.stringify(response), {
			status: 500,
			headers: {"Content-Type": "application/json"},
		})
	}
}
