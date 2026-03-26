import {rm} from "node:fs/promises"
import {basename, join, resolve} from "node:path"
import {LOG_MESSAGE, LOG_MODULE} from "../../lib/event-catalog"
import {getServerLogger} from "../../lib/log/server-instance"
import {isValidSessionPath} from "../utils"

const log = () => getServerLogger(LOG_MODULE.ROUTES_SESSION_DELETE)

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

		log().info(LOG_MESSAGE.ROUTE_SESSION_DELETE_FILE, {path: sessionPath})
		await rm(sessionPath, {force: true})

		try {
			log().info(LOG_MESSAGE.ROUTE_SESSION_DELETE_FOLDER, {path: sessionFolder})
			await rm(sessionFolder, {recursive: true, force: true})
		} catch (_err) {
			log().warn(LOG_MESSAGE.ROUTE_SESSION_DELETE_FOLDER_MISSING, {path: sessionFolder})
		}

		log().info(LOG_MESSAGE.ROUTE_SESSION_DELETED, {sessionId})
		return new Response(JSON.stringify({status: "success"}), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log().error(LOG_MESSAGE.ROUTE_SESSION_DELETE_FAILED, {
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
