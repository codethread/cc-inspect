import {join} from "node:path"
import type {BunRequest} from "bun"
import {Claude, type SessionsResponse} from "#types"
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
		const claude = new Claude({path: CLAUDE_PROJECTS_DIR})
		const sessionHandles = await claude.listSessions({name: directory, path: dirPath})

		// Convert SessionHandle[] to the response format (Date -> ISO string)
		const sessions = sessionHandles.map((s) => ({
			...s,
			modifiedAt: s.modifiedAt.toISOString(),
		}))

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
