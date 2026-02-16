import type {DirectoriesResponse} from "#types"
import {Claude} from "../../lib/claude"
import {CLAUDE_PROJECTS_DIR} from "../utils"

// API endpoint to get list of project directories
export async function directoriesHandler(): Promise<Response> {
	try {
		const claude = new Claude({path: CLAUDE_PROJECTS_DIR})
		const projects = await claude.listProjects()
		const directories = projects.map((p) => p.id)

		const response: DirectoriesResponse = {status: "success", directories}
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
