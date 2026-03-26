import type {DirectoriesResponse} from "#types"
import {Claude} from "@codethread/claude-sdk"
import {CLAUDE_PROJECTS_DIR, resolveProjectDisplayName} from "../utils"

// API endpoint to get list of project directories
export async function directoriesHandler(): Promise<Response> {
	try {
		const claude = new Claude({path: CLAUDE_PROJECTS_DIR})
		const projects = await claude.listProjects()
		const directories = projects.map((p) => p.id)
		const homeDir = process.env.HOME ?? ""
		const displayNames = Object.fromEntries(
			await Promise.all(directories.map(async (id) => [id, await resolveProjectDisplayName(id, homeDir)])),
		)

		const response: DirectoriesResponse = {status: "success", directories, displayNames}
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
