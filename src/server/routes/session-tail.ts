import {basename, dirname, join} from "node:path"
import type {ServerWebSocket} from "bun"
import {LOG_MESSAGE, LOG_MODULE} from "../../lib/event-catalog"
import {getServerLogger} from "../../lib/log/server-instance"
import {TailerRegistry} from "../../lib/tail/registry"
import {isValidSessionPath} from "../utils"

const log = () => getServerLogger(LOG_MODULE.ROUTES_TAIL)

// Singleton registry
const registry = new TailerRegistry()

// WebSocket data attached to each connection
export interface TailWsData {
	sessionPath: string | null
	subscribed: boolean
}

export function handleTailUpgrade(
	req: Request,
	server: {upgrade: (req: Request, opts?: object) => boolean},
): Response | undefined {
	if (server.upgrade(req, {data: {sessionPath: null, subscribed: false} as TailWsData})) {
		return undefined
	}
	return new Response("Upgrade failed", {status: 400})
}

export function handleTailMessage(ws: ServerWebSocket<TailWsData>, msg: string | Buffer): void {
	try {
		const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg)
		const parsed = JSON.parse(text)
		const path = parsed.path as string

		if (!path || typeof path !== "string") {
			ws.send(JSON.stringify({type: "error", message: "Missing path", seq: 0}))
			ws.close()
			return
		}

		if (!isValidSessionPath(path)) {
			log().warn(LOG_MESSAGE.TAIL_WS_PATH_INVALID, {path})
			ws.send(JSON.stringify({type: "error", message: "Invalid session path", seq: 0}))
			ws.close()
			return
		}

		const sessionId = basename(path).replace(".jsonl", "")
		const projectDir = dirname(path)
		const sessionAgentDir = join(projectDir, sessionId, "subagents")

		const tailer = registry.getOrCreate({
			sessionFilePath: path,
			sessionAgentDir,
			sessionId,
		})

		if (!tailer) {
			ws.send(JSON.stringify({type: "error", message: "Too many active tail sessions", seq: 0}))
			ws.close()
			return
		}

		ws.data.sessionPath = path
		ws.data.subscribed = true

		// Handle reconnection
		const resumeAfterSeq = typeof parsed.resumeAfterSeq === "number" ? parsed.resumeAfterSeq : undefined
		tailer.subscribe(ws, resumeAfterSeq)

		log().info(LOG_MESSAGE.TAIL_WS_OPENED, {path, resumeAfterSeq})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		ws.send(JSON.stringify({type: "error", message, seq: 0}))
		ws.close()
	}
}

export function handleTailClose(ws: ServerWebSocket<TailWsData>): void {
	if (ws.data.subscribed && ws.data.sessionPath) {
		registry.release(ws.data.sessionPath, ws)
		log().info(LOG_MESSAGE.TAIL_WS_CLOSED, {path: ws.data.sessionPath})
	}
}
