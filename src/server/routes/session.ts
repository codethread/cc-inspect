import {basename, dirname, join} from "node:path"
import type {SessionDataResponse} from "#types"
import {Claude, ParseError} from "../../lib/claude"
import {getServerLogger} from "../../lib/log/server-instance"
import {isValidSessionPath} from "../utils"

const log = () => getServerLogger("routes.session")

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
			"session parsed",
			() =>
				claude.parseSession({
					id: sessionId,
					sessionFilePath: sessionPath,
					sessionAgentDir: join(projectDir, sessionId, "subagents"),
				}),
			{path: sessionPath},
		)

		log().info("session loaded", {
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
			log().error("parse error", {
				err: err.message,
				stack: err.stack,
				data: {rawLine: err.rawLine},
			})
		} else {
			const message = err instanceof Error ? err.message : String(err)
			log().error("failed to parse session", {
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
