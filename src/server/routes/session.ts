import {basename, dirname, join} from "node:path"
import type {SessionDataResponse} from "#types"
import {Claude, ParseError} from "../../lib/claude"
import {LOG_MESSAGE, LOG_MODULE} from "../../lib/event-catalog"
import {getServerLogger} from "../../lib/log/server-instance"
import {isValidSessionPath} from "../utils"

const log = () => getServerLogger(LOG_MODULE.ROUTES_SESSION)

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
		const sessionId = basename(sessionPath).replace(".jsonl", "")
		const projectDir = dirname(sessionPath)
		const claude = new Claude({path: dirname(projectDir)})

		const sessionData = await log().timed(
			LOG_MESSAGE.ROUTE_SESSION_PARSED,
			() =>
				claude.parseSession({
					id: sessionId,
					sessionFilePath: sessionPath,
					sessionAgentDir: join(projectDir, sessionId, "subagents"),
				}),
			{path: sessionPath},
		)

		log().info(LOG_MESSAGE.ROUTE_SESSION_LOADED, {
			events: sessionData.allEvents.length,
			agents: sessionData.mainAgent.children.length + 1,
		})

		const response: SessionDataResponse = {
			status: "success",
			data: sessionData,
		}
		return new Response(JSON.stringify(response), {
			headers: {"Content-Type": "application/json"},
		})
	} catch (err) {
		if (err instanceof ParseError) {
			log().error(LOG_MESSAGE.ROUTE_SESSION_PARSE_ERROR, {
				err: err.message,
				stack: err.stack,
				data: {rawLine: err.rawLine},
			})
		} else {
			const message = err instanceof Error ? err.message : String(err)
			log().error(LOG_MESSAGE.ROUTE_SESSION_FAILED_TO_PARSE, {
				err: message,
				stack: err instanceof Error ? err.stack : undefined,
			})
		}

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
