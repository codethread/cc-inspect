import {readdir} from "node:fs/promises"
import {join} from "node:path"
import type {DirectoriesResponse} from "#types"
import {CLAUDE_PROJECTS_DIR} from "../utils"

// API endpoint to get list of project directories
export async function directoriesHandler(): Promise<Response> {
	try {
		const entries = await readdir(CLAUDE_PROJECTS_DIR, {withFileTypes: true})
		const directories = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()

		// Filter to only directories that contain session files
		const validDirectories: string[] = []
		for (const dir of directories) {
			const dirPath = join(CLAUDE_PROJECTS_DIR, dir)
			try {
				const files = await readdir(dirPath)
				const hasSessionFiles = files.some((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))
				if (hasSessionFiles) {
					validDirectories.push(dir)
				}
			} catch {}
		}

		const response: DirectoriesResponse = {status: "success", directories: validDirectories}
		return new Response(JSON.stringify(response), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		const response: DirectoriesResponse = {
			status: "error",
			error: `Failed to read directories: ${message}`,
		}
		return new Response(JSON.stringify(response), {
			status: 500,
			headers: {"Content-Type": "application/json"},
		})
	}
}
