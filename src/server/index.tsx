#!/usr/bin/env bun
import {serve} from "bun"
import {dirname} from "node:path"
import {parseArgs} from "util"
import index from "../frontend/index.html"
import {Claude} from "../lib/claude"
import {directoriesHandler} from "./routes/directories"
import {sessionHandler} from "./routes/session"
import {sessionDeleteHandler} from "./routes/session-delete"
import {sessionsHandler} from "./routes/sessions"

async function main() {
	// Parse CLI arguments
	const {values} = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			session: {type: "string", short: "s"},
			help: {type: "boolean", short: "h"},
		},
		strict: false,
	})

	if (values.help) {
		console.log(`cc-inspect - Visualize Claude Code session logs

Usage: cc-inspect [--session <path-to-session.jsonl>]

Options:
  --session, -s  Path to session log file (optional - can select via UI)
  --help, -h     Show this help message

Examples:
  cc-inspect                                        # Start server with UI selector
  cc-inspect -s ~/.claude/projects/-Users-foo/session-id.jsonl  # Load specific session
`)
		process.exit(0)
	}

	// Track CLI-provided session path
	let cliSessionPath: string | undefined

	// Pre-load session if provided via CLI (for validation)
	if (values.session) {
		cliSessionPath = values.session as string
		console.log(`📖 Validating session logs: ${cliSessionPath}`)
		try {
			// Extract components from the session path
			const projectDir = dirname(cliSessionPath)
			const filename = cliSessionPath.split("/").pop() || ""
			const sessionId = filename.replace(".jsonl", "")

			// Construct SessionHandle
			const sessionHandle = {
				filename,
				path: cliSessionPath,
				sessionId,
				modifiedAt: new Date(),
				size: 0,
			}

			// Initialize Claude SDK and parse
			const claude = new Claude({path: dirname(projectDir)})
			const sessionData = await claude.parseSession(sessionHandle)

			console.log(
				`✅ Validated ${sessionData.allEvents.length} events from ${sessionData.mainAgent.children.length + 1} agents`,
			)
		} catch (error) {
			console.error("Failed to parse session logs:", error)
			process.exit(1)
		}
	}

	const server = serve({
		port: Number.parseInt(process.env.PORT || "5555", 10),
		routes: {
			"/api/directories": directoriesHandler,
			"/api/sessions": sessionsHandler,
			"/api/session": (req) => sessionHandler(req, cliSessionPath),
			"/api/session/delete": sessionDeleteHandler,

			// Serve index.html for all other routes
			"/*": index,
		},

		development: false,
	})

	console.log(`🚀 Server running at ${server.url}`)
	if (!values.session) {
		console.log(`📁 Select a session from the UI to view`)
	}
}

main()
