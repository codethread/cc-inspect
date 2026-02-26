import {watch, type FSWatcher} from "node:fs"
import {readdir, stat} from "node:fs/promises"
import {dirname, join} from "node:path"
import type {ServerWebSocket} from "bun"
import type {AgentNode, Event, SessionData, TailServerMessage} from "#types"
import {Claude} from "../claude"
import {
	buildAgentNode,
	createParseStateFromSession,
	type IncrementalParseState,
	parseLines,
	processAgentEntries,
	processMainEntries,
} from "../claude/incremental"
import {normalizeToolUseResult} from "../claude/parser"
import {LOG_MESSAGE, LOG_MODULE} from "../event-catalog"
import {getServerLogger} from "../log/server-instance"
import {FileTailer} from "./file-tailer"

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

export type SessionTailerState =
	| {status: "initializing"}
	| {status: "streaming"; lastWriteTime: number}
	| {status: "idle"; idleSince: number}
	| {status: "error"; error: string}
	| {status: "stopped"}

export type SessionTailerEvent =
	| {type: "snapshot_ready"}
	| {type: "lines_received"}
	| {type: "idle_timeout"}
	| {type: "no_subscribers"}
	| {type: "error"; error: string}
	| {type: "stop"}

export type SessionTailerEffect =
	| {type: "start_tailing"}
	| {type: "broadcast_snapshot"}
	| {type: "stop_all"}
	| {type: "start_idle_check"}
	| {type: "cancel_idle_check"}

// ---------------------------------------------------------------------------
// Pure transition function
// ---------------------------------------------------------------------------

export function sessionTransition(
	state: SessionTailerState,
	event: SessionTailerEvent,
): {state: SessionTailerState; effects: SessionTailerEffect[]} {
	switch (state.status) {
		case "initializing":
			switch (event.type) {
				case "snapshot_ready":
					return {
						state: {status: "streaming", lastWriteTime: Date.now()},
						effects: [{type: "start_tailing"}, {type: "broadcast_snapshot"}],
					}
				case "error":
					return {
						state: {status: "error", error: event.error},
						effects: [{type: "stop_all"}],
					}
				default:
					return {state, effects: []}
			}

		case "streaming":
			switch (event.type) {
				case "idle_timeout":
					return {
						state: {status: "idle", idleSince: Date.now()},
						effects: [],
					}
				case "error":
					return {
						state: {status: "error", error: event.error},
						effects: [{type: "stop_all"}],
					}
				case "no_subscribers":
					return {
						state: {status: "stopped"},
						effects: [{type: "stop_all"}],
					}
				default:
					return {state, effects: []}
			}

		case "idle":
			switch (event.type) {
				case "lines_received":
					return {
						state: {status: "streaming", lastWriteTime: Date.now()},
						effects: [{type: "cancel_idle_check"}],
					}
				case "no_subscribers":
					return {
						state: {status: "stopped"},
						effects: [{type: "stop_all"}],
					}
				default:
					return {state, effects: []}
			}

		case "error":
			switch (event.type) {
				case "stop":
					return {
						state: {status: "stopped"},
						effects: [{type: "stop_all"}],
					}
				default:
					return {state, effects: []}
			}

		case "stopped":
			return {state, effects: []}
	}
}

// ---------------------------------------------------------------------------
// SessionTailer class
// ---------------------------------------------------------------------------

interface SessionTailerOptions {
	sessionFilePath: string
	sessionAgentDir: string
	sessionId: string
}

const log = () => getServerLogger(LOG_MODULE.TAIL_SESSION)

export class SessionTailer {
	private lifecycle: SessionTailerState = {status: "initializing"}
	private parseState: IncrementalParseState | null = null
	private mainTailer: FileTailer | null = null
	private agentTailers: Map<string, FileTailer> = new Map()
	private subscribers: Set<ServerWebSocket<unknown>> = new Set()
	private seq = 0
	private ringBuffer: Array<{seq: number; message: TailServerMessage}> = []
	private readonly ringBufferCapacity = 1000
	private pendingEvents: Event[] = []
	private pendingAgents: AgentNode[] = []
	private coalesceTimer: Timer | null = null
	private heartbeatTimer: Timer | null = null
	private idleCheckTimer: Timer | null = null
	private lastWriteTime: number = Date.now()
	private graceTimer: Timer | null = null
	private sessionData: SessionData | null = null
	/** Byte offsets at time of snapshot parse, used to start tailers from EOF */
	private snapshotFileSizes: Map<string, number> = new Map()
	private dirWatcher: FSWatcher | null = null
	private dirWatchRetryTimer: Timer | null = null

	constructor(private options: SessionTailerOptions) {
		this.init()
	}

	private async init(): Promise<void> {
		try {
			const sessionId = this.options.sessionId
			const claude = new Claude({path: dirname(dirname(this.options.sessionFilePath))})
			const sessionData = await claude.parseSession({
				id: sessionId,
				sessionFilePath: this.options.sessionFilePath,
				sessionAgentDir: this.options.sessionAgentDir,
			})

			// Count lines and capture file sizes for main log
			const mainFile = Bun.file(this.options.sessionFilePath)
			const mainContent = await mainFile.text()
			const mainLogLineCount = mainContent.split("\n").filter((l) => l.trim()).length
			this.snapshotFileSizes.set(this.options.sessionFilePath, mainFile.size)

			// Count lines and capture file sizes for each agent log
			const agentLineCounts = new Map<string, number>()
			for (const child of sessionData.mainAgent.children) {
				try {
					const agentFile = Bun.file(child.logPath)
					const agentContent = await agentFile.text()
					agentLineCounts.set(child.id, agentContent.split("\n").filter((l) => l.trim()).length)
					this.snapshotFileSizes.set(child.logPath, agentFile.size)
				} catch {
					agentLineCounts.set(child.id, 0)
				}
			}

			this.parseState = createParseStateFromSession(sessionData, mainLogLineCount, agentLineCounts)
			this.sessionData = sessionData

			this.dispatch({type: "snapshot_ready"})
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			this.dispatch({type: "error", error: message})
		}
	}

	subscribe(ws: ServerWebSocket<unknown>, resumeAfterSeq?: number): void {
		this.subscribers.add(ws)

		if (this.graceTimer) {
			clearTimeout(this.graceTimer)
			this.graceTimer = null
		}

		log().info(LOG_MESSAGE.TAIL_SESSION_SUBSCRIBER_ADDED, {
			path: this.options.sessionFilePath,
			subscribers: this.subscribers.size,
		})

		if (this.sessionData) {
			if (resumeAfterSeq !== undefined) {
				// Try to replay from ring buffer
				const idx = this.ringBuffer.findIndex((entry) => entry.seq > resumeAfterSeq)
				if (idx !== -1) {
					// Replay all messages after the given seq
					log().info(LOG_MESSAGE.TAIL_WS_RECONNECT_REPLAY, {
						fromSeq: resumeAfterSeq,
						replayCount: this.ringBuffer.length - idx,
					})
					for (let i = idx; i < this.ringBuffer.length; i++) {
						this.sendTo(ws, this.ringBuffer[i].message)
					}
					return
				}
				// seq too old or not found, fall through to fresh snapshot
				log().info(LOG_MESSAGE.TAIL_WS_FRESH_SNAPSHOT, {
					requestedSeq: resumeAfterSeq,
					reason: "seq_not_in_buffer",
				})
			}

			// Send fresh snapshot
			const snapshotMsg: TailServerMessage = {
				type: "snapshot",
				data: this.sessionData,
				seq: this.nextSeq(),
			}
			this.sendTo(ws, snapshotMsg)
		}
	}

	unsubscribe(ws: ServerWebSocket<unknown>): void {
		this.subscribers.delete(ws)

		log().info(LOG_MESSAGE.TAIL_SESSION_SUBSCRIBER_REMOVED, {
			path: this.options.sessionFilePath,
			subscribers: this.subscribers.size,
		})

		if (this.subscribers.size === 0) {
			this.graceTimer = setTimeout(() => {
				if (this.subscribers.size === 0) {
					this.dispatch({type: "no_subscribers"})
				}
			}, 5000)
		}
	}

	getSubscriberCount(): number {
		return this.subscribers.size
	}

	private dispatch(event: SessionTailerEvent): void {
		const result = sessionTransition(this.lifecycle, event)
		this.lifecycle = result.state

		for (const effect of result.effects) {
			this.executeEffect(effect)
		}
	}

	private executeEffect(effect: SessionTailerEffect): void {
		switch (effect.type) {
			case "start_tailing":
				this.startTailing()
				break
			case "broadcast_snapshot":
				this.broadcastSnapshot()
				break
			case "stop_all":
				this.stopAll()
				break
			case "start_idle_check":
				this.startIdleCheck()
				break
			case "cancel_idle_check":
				if (this.idleCheckTimer) {
					clearInterval(this.idleCheckTimer)
					this.idleCheckTimer = null
				}
				this.broadcastActive()
				// Restart idle checking so future inactivity is detected
				this.startIdleCheck()
				break
		}
	}

	private startTailing(): void {
		if (!this.parseState) return

		// Start main file tailer from end of file (snapshot already has all existing content)
		this.mainTailer = new FileTailer({
			path: this.options.sessionFilePath,
			onLines: (lines) => this.onMainLines(lines),
			onError: (err) => this.dispatch({type: "error", error: err.message}),
			onDeleted: () => this.dispatch({type: "error", error: "Main session file deleted"}),
			initialOffset: this.snapshotFileSizes.get(this.options.sessionFilePath) ?? 0,
		})

		// Start tailers for existing agent logs from their snapshot offsets
		for (const child of this.parseState.mainAgent.children) {
			this.startAgentTailer(child.id, child.logPath)
		}

		// Watch the agent directory for new agent-*.jsonl files
		this.startDirWatcher()

		// Start heartbeat
		this.heartbeatTimer = setInterval(() => {
			const msg: TailServerMessage = {type: "heartbeat", seq: this.nextSeq()}
			this.broadcast(msg)
		}, 15000)

		// Start idle check
		this.startIdleCheck()
	}

	private startAgentTailer(agentId: string, logPath: string): void {
		if (this.agentTailers.has(agentId)) return

		const tailer = new FileTailer({
			path: logPath,
			onLines: (lines) => this.onAgentLines(agentId, lines),
			onError: (err) => {
				log().error(LOG_MESSAGE.TAIL_SESSION_CORRUPT_LINE, {
					err: err.message,
					data: {agentId},
				})
			},
			onDeleted: () => {
				// Agent log deleted is not fatal
			},
			initialOffset: this.snapshotFileSizes.get(logPath),
		})

		this.agentTailers.set(agentId, tailer)
	}

	/** Register a newly discovered agent file, guarded against duplicates. */
	private registerAgentFile(agentId: string, logPath: string): void {
		if (!this.parseState || this.parseState.knownAgentIds.has(agentId)) return

		this.parseState.knownAgentIds.add(agentId)

		const agentNode = buildAgentNode(agentId, this.parseState)
		agentNode.logPath = logPath
		this.parseState.mainAgent.children.push(agentNode)
		this.pendingAgents.push(agentNode)

		// initialOffset omitted so FileTailer starts from byte 0 (new file)
		this.startAgentTailer(agentId, logPath)

		log().info(LOG_MESSAGE.TAIL_SESSION_AGENT_DISCOVERED, {agentId, logPath, source: "dir-watcher"})

		this.scheduleCoalesce()
	}

	private startDirWatcher(): void {
		if (!this.parseState) return

		const agentDir = this.options.sessionAgentDir

		try {
			this.dirWatcher = watch(agentDir, (_eventType, filename) => {
				if (!filename) return

				// Only react to agent log files
				const match = filename.match(/^agent-(.+)\.jsonl$/)
				if (!match) return

				const agentId = match[1]
				log().info(LOG_MESSAGE.TAIL_SESSION_DIR_WATCHER_EVENT, {agentId, filename})
				this.registerAgentFile(agentId, join(agentDir, filename))
			})

			this.dirWatcher.on("error", (err) => {
				log().warn(LOG_MESSAGE.TAIL_SESSION_DIR_WATCHER_STOPPED, {
					dir: agentDir,
					err: err.message,
				})
			})

			log().info(LOG_MESSAGE.TAIL_SESSION_DIR_WATCHER_STARTED, {dir: agentDir})

			// Scan for agent files that already existed when the watcher was attached —
			// fs.watch does not emit events for files created before it starts watching.
			this.scanExistingAgentFiles(agentDir)
		} catch (err) {
			// Non-fatal: the agent directory may not exist yet when no subagents have been spawned.
			// Poll until it appears so that the first subagent is detected immediately on spawn.
			log().info(LOG_MESSAGE.TAIL_SESSION_DIR_WATCHER_STARTED, {
				dir: agentDir,
				waiting: true,
				reason: err instanceof Error ? err.message : String(err),
			})
			// Use a one-shot check cycle: cancel the timer before the async stat so only
			// one in-flight tick can ever call startDirWatcher(), preventing duplicate watchers.
			const checkDir = async (): Promise<void> => {
				// Bun.file().exists() returns false for directories; use stat instead
				const dirExists = await stat(agentDir)
					.then((s) => s.isDirectory())
					.catch(() => false)

				if (!dirExists) {
					// Schedule the next check only if we haven't been stopped
					if (this.lifecycle.status !== "stopped" && this.lifecycle.status !== "error") {
						this.dirWatchRetryTimer = setTimeout(checkDir, 1000)
					}
					return
				}

				this.dirWatchRetryTimer = null

				// Guard against in-flight callbacks that complete after stopAll() runs.
				// Check after the async stat since stopAll() may fire while awaiting.
				// Both "stopped" and "error" are terminal states where tailing must not restart.
				const status = this.lifecycle.status
				if (status !== "stopped" && status !== "error") {
					this.startDirWatcher()
				}
			}
			this.dirWatchRetryTimer = setTimeout(checkDir, 1000)
		}
	}

	private async scanExistingAgentFiles(agentDir: string): Promise<void> {
		try {
			const entries = await readdir(agentDir)
			// Guard against stopAll() completing while readdir was in flight
			const status = this.lifecycle.status
			if (status === "stopped" || status === "error") return

			for (const filename of entries) {
				const match = filename.match(/^agent-(.+)\.jsonl$/)
				if (!match) continue
				const agentId = match[1]
				this.registerAgentFile(agentId, join(agentDir, filename))
			}
		} catch {
			// Non-fatal: directory may have been removed between watcher start and scan
		}
	}

	private startIdleCheck(): void {
		if (this.idleCheckTimer) {
			clearInterval(this.idleCheckTimer)
		}
		this.idleCheckTimer = setInterval(() => {
			// Only transition to idle from streaming; once idle, stop checking
			if (this.lifecycle.status === "streaming" && Date.now() - this.lastWriteTime > 30000) {
				this.dispatch({type: "idle_timeout"})
				const msg: TailServerMessage = {type: "idle", seq: this.nextSeq()}
				this.broadcast(msg)
				log().info(LOG_MESSAGE.TAIL_SESSION_IDLE, {path: this.options.sessionFilePath})
			}
		}, 5000)
	}

	private onMainLines(lines: string[]): void {
		if (!this.parseState) return

		const filePath = this.options.sessionFilePath
		const startLine = this.parseState.lineCountPerFile.get(filePath) ?? 0
		const {entries, errors} = parseLines(lines, filePath, startLine + 1)

		// Update line count
		this.parseState.lineCountPerFile.set(filePath, startLine + lines.length)

		// Broadcast warnings for corrupt lines
		for (const err of errors) {
			const msg: TailServerMessage = {type: "warning", message: err.error, seq: this.nextSeq()}
			this.broadcast(msg)
			this.addToRingBuffer(msg)
			log().warn(LOG_MESSAGE.TAIL_SESSION_CORRUPT_LINE, {line: err.line, error: err.error})
		}

		if (entries.length === 0) return

		const {events, newAgentIds} = processMainEntries(entries, this.parseState)

		// Handle newly discovered agents
		for (const agentId of newAgentIds) {
			const agentNode = buildAgentNode(agentId, this.parseState)
			const logPath = join(this.options.sessionAgentDir, `agent-${agentId}.jsonl`)
			agentNode.logPath = logPath
			this.parseState.mainAgent.children.push(agentNode)
			this.pendingAgents.push(agentNode)
			this.startAgentTailer(agentId, logPath)

			log().info(LOG_MESSAGE.TAIL_SESSION_AGENT_DISCOVERED, {agentId, logPath})
		}

		// Refresh metadata for agents that were early-discovered (dir-watcher found the file
		// before the tool_result arrived). Those agents have name === agentId as a fallback.
		// Now that processMainEntries has appended the new entries, buildAgentNode can find
		// the real metadata from the accumulated mainLogEntries.
		for (const entry of entries) {
			const result = normalizeToolUseResult(entry.toolUseResult)
			if (!result?.agentId) continue
			const agentId = result.agentId
			// Skip agents that were just registered above via newAgentIds
			if (newAgentIds.includes(agentId)) continue
			const childIdx = this.parseState.mainAgent.children.findIndex((c) => c.id === agentId)
			if (childIdx === -1) continue
			const child = this.parseState.mainAgent.children[childIdx]
			// Only refresh if name is still the raw agentId (stale early-discovery fallback)
			if (child.name !== agentId) continue
			const updated = buildAgentNode(agentId, this.parseState)
			updated.logPath = child.logPath
			updated.events = child.events
			updated.children = child.children
			this.parseState.mainAgent.children[childIdx] = updated
			// Replace any queued entry for this agentId to avoid sending duplicates in one batch
			const pendingIdx = this.pendingAgents.findIndex((a) => a.id === agentId)
			if (pendingIdx !== -1) {
				this.pendingAgents[pendingIdx] = updated
			} else {
				this.pendingAgents.push(updated)
			}
			log().info(LOG_MESSAGE.TAIL_SESSION_AGENT_METADATA_REFRESHED, {agentId})
		}

		this.pendingEvents.push(...events)
		this.lastWriteTime = Date.now()

		if (this.lifecycle.status === "idle") {
			this.dispatch({type: "lines_received"})
		}

		this.scheduleCoalesce()
	}

	private onAgentLines(agentId: string, lines: string[]): void {
		if (!this.parseState) return

		// Find the agent's log path to look up line count
		const child = this.parseState.mainAgent.children.find((c) => c.id === agentId)
		const logPath = child?.logPath ?? ""
		const startLine = this.parseState.lineCountPerFile.get(logPath) ?? 0
		const {entries, errors} = parseLines(lines, logPath, startLine + 1)

		// Update line count
		this.parseState.lineCountPerFile.set(logPath, startLine + lines.length)

		// Broadcast warnings for corrupt lines
		for (const err of errors) {
			const msg: TailServerMessage = {type: "warning", message: err.error, seq: this.nextSeq()}
			this.broadcast(msg)
			this.addToRingBuffer(msg)
			log().warn(LOG_MESSAGE.TAIL_SESSION_CORRUPT_LINE, {line: err.line, error: err.error})
		}

		if (entries.length === 0) return

		const events = processAgentEntries(entries, agentId, this.parseState)

		this.pendingEvents.push(...events)
		this.lastWriteTime = Date.now()

		if (this.lifecycle.status === "idle") {
			this.dispatch({type: "lines_received"})
		}

		this.scheduleCoalesce()
	}

	private scheduleCoalesce(): void {
		if (this.coalesceTimer) return
		this.coalesceTimer = setTimeout(() => {
			this.coalesceTimer = null
			this.flushPending()
		}, 50)
	}

	private flushPending(): void {
		if (this.pendingEvents.length === 0 && this.pendingAgents.length === 0) return

		const msg: TailServerMessage = {
			type: "events",
			events: this.pendingEvents,
			agents: this.pendingAgents,
			seq: this.nextSeq(),
		}

		log().info(LOG_MESSAGE.TAIL_SESSION_BATCH_BROADCAST, {
			events: this.pendingEvents.length,
			agents: this.pendingAgents.length,
			subscribers: this.subscribers.size,
		})

		this.broadcast(msg)
		this.addToRingBuffer(msg)

		this.pendingEvents = []
		this.pendingAgents = []
	}

	private broadcast(message: TailServerMessage): void {
		const json = JSON.stringify(message)
		for (const ws of this.subscribers) {
			try {
				if (ws.getBufferedAmount() < 1_048_576) {
					ws.send(json)
				}
			} catch {
				// Skip congested or closed subscribers
			}
		}
	}

	private sendTo(ws: ServerWebSocket<unknown>, message: TailServerMessage): void {
		try {
			ws.send(JSON.stringify(message))
		} catch {
			// Subscriber may have disconnected
		}
	}

	private addToRingBuffer(message: TailServerMessage): void {
		this.ringBuffer.push({seq: message.seq, message})
		while (this.ringBuffer.length > this.ringBufferCapacity) {
			this.ringBuffer.shift()
		}
	}

	private nextSeq(): number {
		return ++this.seq
	}

	private broadcastSnapshot(): void {
		if (!this.sessionData) return
		const msg: TailServerMessage = {
			type: "snapshot",
			data: this.sessionData,
			seq: this.nextSeq(),
		}
		this.broadcast(msg)
		this.addToRingBuffer(msg)
	}

	private broadcastActive(): void {
		const msg: TailServerMessage = {type: "active", seq: this.nextSeq()}
		this.broadcast(msg)
		log().info(LOG_MESSAGE.TAIL_SESSION_ACTIVE, {path: this.options.sessionFilePath})
	}

	private stopAll(): void {
		if (this.mainTailer) {
			this.mainTailer.stop()
			this.mainTailer = null
		}

		for (const [, tailer] of this.agentTailers) {
			tailer.stop()
		}
		this.agentTailers.clear()

		if (this.dirWatchRetryTimer) {
			clearInterval(this.dirWatchRetryTimer)
			this.dirWatchRetryTimer = null
		}

		if (this.dirWatcher) {
			this.dirWatcher.close()
			this.dirWatcher = null
			log().info(LOG_MESSAGE.TAIL_SESSION_DIR_WATCHER_STOPPED, {dir: this.options.sessionAgentDir})
		}

		if (this.coalesceTimer) {
			clearTimeout(this.coalesceTimer)
			this.coalesceTimer = null
		}
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = null
		}
		if (this.idleCheckTimer) {
			clearInterval(this.idleCheckTimer)
			this.idleCheckTimer = null
		}
		if (this.graceTimer) {
			clearTimeout(this.graceTimer)
			this.graceTimer = null
		}
	}
}
