#!/usr/bin/env bun
import {mkdir} from "node:fs/promises"
import {basename, dirname, join} from "node:path"
import {parseArgs} from "util"
import type {ServerWebSocket} from "bun"
import envPaths from "env-paths"
import index from "../frontend/index.html"
import {Claude} from "../lib/claude"
import {LOG_MESSAGE, LOG_MODULE} from "../lib/event-catalog"
import {LogEntrySchema} from "../lib/log/types"
import {flushAll, getLogWriter, getServerLogger, initLogging} from "../lib/log/server-instance"
import type {LogLevel} from "../lib/log/types"
import {directoriesHandler} from "./routes/directories"
import {logHandler} from "./routes/log"
import {sessionHandler} from "./routes/session"
import {sessionDeleteHandler} from "./routes/session-delete"
import {handleTailClose, handleTailMessage, handleTailUpgrade, type TailWsData} from "./routes/session-tail"
import {sessionsHandler} from "./routes/sessions"

async function main() {
	const {values} = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			session: {type: "string", short: "s"},
			tail: {type: "boolean", short: "t"},
			host: {type: "string"},
			port: {type: "string", short: "p"},
			help: {type: "boolean", short: "h"},
		},
		strict: false,
	})

	if (values.help) {
		console.log(`cc-inspect - Visualize Claude Code session logs

Usage: cc-inspect [--session <path-to-session.jsonl>] [--tail] [--host <host>] [--port <port>]

Options:
  --session, -s  Path to session log file (optional - can select via UI)
  --tail, -t     Enable live tailing mode (requires --session)
  --host         Host/interface to bind (default: HOST env var or 0.0.0.0)
  --port, -p     Port to bind (default: PORT env var or 5555)
  --help, -h     Show this help message

Examples:
  cc-inspect                                        # Start server with UI selector
  cc-inspect -s ~/.claude/projects/-Users-foo/session-id.jsonl  # Load specific session
  cc-inspect -s ~/.claude/projects/-Users-foo/session-id.jsonl -t  # Live tail session
  cc-inspect --host 0.0.0.0 --port 5555            # Expose on local network
`)
		process.exit(0)
	}

	const hostname = typeof values.host === "string" ? values.host : (process.env.HOST ?? "0.0.0.0")
	const portValue = typeof values.port === "string" ? values.port : (process.env.PORT ?? "5555")
	const port = Number.parseInt(portValue, 10)

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		console.error(`Invalid port: ${portValue}. Expected an integer between 1 and 65535.`)
		process.exit(1)
	}

	// Initialize logging
	const isLocal = process.env.IS_LOCAL === "1"
	const logDir = isLocal ? join(process.cwd(), ".logs") : join(envPaths("cc-inspect").data, "logs")
	await mkdir(logDir, {recursive: true})

	const minLevel = (process.env.CC_INSPECT_LOG_LEVEL as LogLevel) || "info"
	const {sessionId, logFile} = initLogging(logDir, minLevel)

	const log = getServerLogger(LOG_MODULE.SERVER)

	// Pre-load session if provided via CLI (for validation)
	let cliSessionPath: string | undefined

	if (values.session) {
		cliSessionPath = values.session as string
		log.info(LOG_MESSAGE.SERVER_VALIDATING_SESSION_LOGS, {path: cliSessionPath})
		try {
			const sid = basename(cliSessionPath).replace(".jsonl", "")
			const projectDir = dirname(cliSessionPath)
			const claude = new Claude({path: dirname(projectDir)})
			const sessionData = await claude.parseSession({
				id: sid,
				sessionFilePath: cliSessionPath,
				sessionAgentDir: join(projectDir, sid, "subagents"),
			})
			log.info(LOG_MESSAGE.SERVER_SESSION_VALIDATED, {
				events: sessionData.allEvents.length,
				agents: sessionData.mainAgent.children.length + 1,
			})
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			log.error(LOG_MESSAGE.SERVER_FAILED_TO_PARSE_SESSION_LOGS, {
				err: msg,
				stack: error instanceof Error ? error.stack : undefined,
			})
			process.exit(1)
		}
	}

	const server = Bun.serve({
		hostname,
		port,
		development: isLocal,

		routes: {
			"/ws/log": (req, server) => {
				if (server.upgrade(req)) {
					return
				}
				return new Response("Upgrade failed", {status: 400})
			},
			"/ws/session/tail": (req, server) => {
				return handleTailUpgrade(req, server)
			},
			"/api/directories": directoriesHandler,
			"/api/sessions": sessionsHandler,
			"/api/session": (req) => sessionHandler(req, cliSessionPath),
			"/api/session/delete": sessionDeleteHandler,
			"/api/log": logHandler,
			"/api/config": () => {
				const tailEnabled = !!(values.tail && values.session)
				return new Response(
					JSON.stringify({
						tailEnabled,
						sessionPath: cliSessionPath,
					}),
					{headers: {"Content-Type": "application/json"}},
				)
			},

			"/*": index,
		},

		websocket: {
			message(ws, msg) {
				// Tail WebSocket — identified by the TailWsData shape set during upgrade
				if (ws.data && typeof ws.data === "object" && "sessionPath" in (ws.data as object)) {
					handleTailMessage(ws as ServerWebSocket<TailWsData>, msg as string)
					return
				}

				// Log WebSocket (existing behavior)
				try {
					const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg)
					const entries = JSON.parse(text)
					const list = Array.isArray(entries) ? entries : [entries]
					const writer = getLogWriter()

					for (const raw of list) {
						const parsed = LogEntrySchema.safeParse({...raw, component: "web"})
						if (parsed.success) {
							writer.write(parsed.data)
						}
					}
				} catch {
					// silently drop malformed client log messages
				}
			},
			close(ws) {
				if (ws.data && typeof ws.data === "object" && "sessionPath" in (ws.data as object)) {
					handleTailClose(ws as ServerWebSocket<TailWsData>)
				}
			},
		},
	})

	log.info(LOG_MESSAGE.SERVER_STARTED, {
		url: server.url.toString(),
		sessionId,
		logFile,
	})

	console.log(`cc-inspect running at ${server.url}`)
	console.log(`  session: ${sessionId}`)
	console.log(`  log:     ${logFile}`)
	if (!values.session) {
		console.log("  Select a session from the UI to view")
	}

	// Flush logs on exit
	process.on("beforeExit", async () => {
		await flushAll()
	})
}

main()
