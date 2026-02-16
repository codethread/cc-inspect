import {basename, dirname, join} from "node:path"
import type {SessionDataResponse} from "#types"
import {Claude, ParseError} from "../../lib/claude"
import {isValidSessionPath} from "../utils"

// API endpoint to load and parse a specific session
export async function sessionHandler(req: Request, cliSessionPath?: string): Promise<Response> {
	const url = new URL(req.url)
	const sessionPath = url.searchParams.get("path") || cliSessionPath

	if (!sessionPath) {
		const response: SessionDataResponse = {
			status: "error",
			error: "Missing path parameter",
		}
		return new Response(JSON.stringify(response), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	// Security: Validate session path to ensure it's within CLAUDE_PROJECTS_DIR
	if (!isValidSessionPath(sessionPath)) {
		const response: SessionDataResponse = {
			status: "error",
			error: "Invalid session path",
		}
		return new Response(JSON.stringify(response), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	try {
		// Parse the session
		console.log(`Parsing session logs: ${sessionPath}`)
		const sessionId = basename(sessionPath).replace(".jsonl", "")
		const projectDir = dirname(sessionPath)
		const claude = new Claude({path: dirname(projectDir)})
		const sessionData = await claude.parseSession({
			id: sessionId,
			sessionFilePath: sessionPath,
			sessionAgentDir: join(projectDir, sessionId, "subagents"),
		})
		console.log(
			`Parsed ${sessionData.allEvents.length} events from ${sessionData.mainAgent.children.length + 1} agents`,
		)

		const response: SessionDataResponse = {
			status: "success",
			data: sessionData,
		}
		return new Response(JSON.stringify(response), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		// Log detailed error information to console
		if (err instanceof ParseError) {
			console.error("Parse error with detailed information:")
			console.error(err.toString())
			console.error("\nFull raw log line:")
			console.error(err.rawLine)
		} else {
			const message = err instanceof Error ? err.message : String(err)
			console.error("Failed to parse session:", message)
			if (err instanceof Error && err.stack) {
				console.error(err.stack)
			}
		}

		// Send simple error message to frontend
		const message = err instanceof Error ? err.message : String(err)
		const response: SessionDataResponse = {
			status: "error",
			error: `Failed to parse session: ${message}`,
		}
		return new Response(JSON.stringify(response), {
			status: 500,
			headers: {"Content-Type": "application/json"},
		})
	}
}
