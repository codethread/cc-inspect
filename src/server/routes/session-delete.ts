import {rm} from "node:fs/promises"
import {basename, join, resolve} from "node:path"
import {getServerLogger} from "../../lib/log/server-instance"
import {isValidSessionPath} from "../utils"

const log = () => getServerLogger("routes.session-delete")

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

	if (!isValidSessionPath(sessionPath)) {
		return new Response(JSON.stringify({status: "error", error: "Invalid session path"}), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		})
	}

	try {
		const filename = basename(sessionPath)
		const sessionId = filename.replace(".jsonl", "")
		const sessionDir = resolve(sessionPath, "..")
		const sessionFolder = join(sessionDir, sessionId)

		log().info("deleting session file", {path: sessionPath})
		await rm(sessionPath, {force: true})

		try {
			log().info("deleting session folder", {path: sessionFolder})
			await rm(sessionFolder, {recursive: true, force: true})
		} catch (_err) {
			log().warn("session folder not found (might not have subagents)", {path: sessionFolder})
		}

		log().info("session deleted", {sessionId})
		return new Response(JSON.stringify({status: "success"}), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log().error("failed to delete session", {
			err: message,
			stack: err instanceof Error ? err.stack : undefined,
		})
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
