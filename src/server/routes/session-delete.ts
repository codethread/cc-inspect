import {rm} from "node:fs/promises"
import {basename, join, resolve} from "node:path"
import {isValidSessionPath} from "../utils"

// API endpoint to delete a session (both .jsonl file and subagents folder)
export async function sessionDeleteHandler(req: Request): Promise<Response> {
	if (req.method !== "DELETE") {
		return new Response(JSON.stringify({status: "error", error: "Method not allowed"}), {
			status: 405,
			headers: {"Content-Type": "application/json"},
		})
	}

	const url = new URL(req.url)
	const sessionPath = url.searchParams.get("path")

	if (!sessionPath) {
		return new Response(JSON.stringify({status: "error", error: "Missing path parameter"}), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	// Security: Validate session path to ensure it's within CLAUDE_PROJECTS_DIR
	if (!isValidSessionPath(sessionPath)) {
		return new Response(JSON.stringify({status: "error", error: "Invalid session path"}), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	try {
		// Extract session ID from the file path
		const filename = basename(sessionPath)
		const sessionId = filename.replace(".jsonl", "")
		const sessionDir = resolve(sessionPath, "..")
		const sessionFolder = join(sessionDir, sessionId)

		// Delete the main session .jsonl file
		console.log(`🗑️  Deleting session file: ${sessionPath}`)
		await rm(sessionPath, {force: true})

		// Delete the associated session folder (contains subagents)
		try {
			console.log(`🗑️  Deleting session folder: ${sessionFolder}`)
			await rm(sessionFolder, {recursive: true, force: true})
		} catch (_err) {
			// Folder might not exist, which is okay
			console.log(`⚠️  Session folder not found (might not have subagents): ${sessionFolder}`)
		}

		console.log(`✅ Successfully deleted session: ${sessionId}`)
		return new Response(JSON.stringify({status: "success"}), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`❌ Failed to delete session: ${message}`)
		return new Response(
			JSON.stringify({
				status: "error",
				error: `Failed to delete session: ${message}`,
			}),
			{
				status: 500,
				headers: {"Content-Type": "application/json"},
			},
		)
	}
}
