import {watch, type FSWatcher} from "node:fs"
import {LOG_MESSAGE, LOG_MODULE} from "../event-catalog"
import {getServerLogger} from "../log/server-instance"

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

export type FileTailerState =
	| {status: "waiting"; path: string}
	| {status: "watching"; path: string}
	| {status: "polling_fallback"; path: string}
	| {status: "deleted"; path: string}
	| {status: "stopped"}

export type FileTailerEvent =
	| {type: "file_appeared"}
	| {type: "watch_error"; error: Error}
	| {type: "file_deleted"}
	| {type: "watch_restored"}
	| {type: "stop"}

export type FileTailerEffect =
	| {type: "start_watcher"; path: string}
	| {type: "start_poll_interval"}
	| {type: "stop_watcher"}
	| {type: "stop_poll_interval"}
	| {type: "read_new_bytes"; path: string; offset: number}
	| {type: "emit_deleted"}
	| {type: "clear_timers"}

// ---------------------------------------------------------------------------
// Pure transition function
// ---------------------------------------------------------------------------

export function transition(
	state: FileTailerState,
	event: FileTailerEvent,
): {state: FileTailerState; effects: FileTailerEffect[]} {
	switch (state.status) {
		case "waiting":
			switch (event.type) {
				case "file_appeared":
					return {
						state: {status: "watching", path: state.path},
						effects: [
							{type: "start_watcher", path: state.path},
							{type: "read_new_bytes", path: state.path, offset: 0},
						],
					}
				case "stop":
					return {state: {status: "stopped"}, effects: [{type: "clear_timers"}]}
				default:
					return {state, effects: []}
			}

		case "watching":
			switch (event.type) {
				case "watch_error":
					return {
						state: {status: "polling_fallback", path: state.path},
						effects: [{type: "stop_watcher"}, {type: "start_poll_interval"}],
					}
				case "file_deleted":
					return {
						state: {status: "deleted", path: state.path},
						effects: [{type: "stop_watcher"}, {type: "emit_deleted"}],
					}
				case "stop":
					return {state: {status: "stopped"}, effects: [{type: "stop_watcher"}, {type: "clear_timers"}]}
				default:
					return {state, effects: []}
			}

		case "polling_fallback":
			switch (event.type) {
				case "watch_restored":
					return {
						state: {status: "watching", path: state.path},
						effects: [{type: "stop_poll_interval"}, {type: "start_watcher", path: state.path}],
					}
				case "file_deleted":
					return {
						state: {status: "deleted", path: state.path},
						effects: [{type: "stop_poll_interval"}, {type: "emit_deleted"}],
					}
				case "stop":
					return {state: {status: "stopped"}, effects: [{type: "stop_poll_interval"}, {type: "clear_timers"}]}
				default:
					return {state, effects: []}
			}

		case "deleted":
			switch (event.type) {
				case "stop":
					return {state: {status: "stopped"}, effects: []}
				default:
					return {state, effects: []}
			}

		case "stopped":
			return {state, effects: []}
	}
}

// ---------------------------------------------------------------------------
// FileTailer class
// ---------------------------------------------------------------------------

interface FileTailerOptions {
	path: string
	onLines: (lines: string[]) => void
	onError: (error: Error) => void
	onDeleted: () => void
	/** Start reading from this byte offset instead of 0 (e.g. after a snapshot parse) */
	initialOffset?: number
}

const log = () => getServerLogger(LOG_MODULE.TAIL_FILE)

export class FileTailer {
	private state: FileTailerState
	private watcher: FSWatcher | null = null
	private pollTimer: Timer | null = null
	private waitTimer: Timer | null = null
	private debounceTimer: Timer | null = null

	private offset = 0
	private carryBuffer = Buffer.alloc(0)
	private reading = false

	constructor(private options: FileTailerOptions) {
		this.offset = options.initialOffset ?? 0
		this.state = {status: "waiting", path: options.path}
		this.init()
	}

	private async init(): Promise<void> {
		const exists = await Bun.file(this.options.path).exists()
		if (exists) {
			this.dispatch({type: "file_appeared"})
		} else {
			log().info(LOG_MESSAGE.TAIL_FILE_NOT_FOUND, {path: this.options.path})
			this.waitTimer = setInterval(() => this.checkFileAppeared(), 500)
		}
	}

	private async checkFileAppeared(): Promise<void> {
		try {
			const exists = await Bun.file(this.options.path).exists()
			if (exists) {
				if (this.waitTimer) {
					clearInterval(this.waitTimer)
					this.waitTimer = null
				}
				this.dispatch({type: "file_appeared"})
			}
		} catch {
			// ignore — will retry on next tick
		}
	}

	dispatch(event: FileTailerEvent): void {
		const result = transition(this.state, event)
		this.state = result.state
		for (const effect of result.effects) {
			this.executeEffect(effect)
		}
	}

	stop(): void {
		this.dispatch({type: "stop"})
	}

	getStatus(): FileTailerState["status"] {
		return this.state.status
	}

	private executeEffect(effect: FileTailerEffect): void {
		switch (effect.type) {
			case "start_watcher":
				this.startWatcher(effect.path)
				break
			case "start_poll_interval":
				this.pollTimer = setInterval(() => this.readNewBytes(), 1000)
				break
			case "stop_watcher":
				if (this.watcher) {
					this.watcher.close()
					this.watcher = null
				}
				// Also clear the safety-net poll that accompanies the watcher
				if (this.pollTimer) {
					clearInterval(this.pollTimer)
					this.pollTimer = null
				}
				break
			case "stop_poll_interval":
				if (this.pollTimer) {
					clearInterval(this.pollTimer)
					this.pollTimer = null
				}
				break
			case "read_new_bytes":
				this.readNewBytes()
				break
			case "emit_deleted":
				log().info(LOG_MESSAGE.TAIL_FILE_DELETED, {path: this.options.path})
				this.options.onDeleted()
				break
			case "clear_timers":
				this.clearAllTimers()
				break
		}
	}

	private startWatcher(path: string): void {
		try {
			this.watcher = watch(path, (_eventType) => {
				if (this.debounceTimer) clearTimeout(this.debounceTimer)
				this.debounceTimer = setTimeout(() => this.readNewBytes(), 50)
			})

			this.watcher.on("error", (err) => {
				this.dispatch({type: "watch_error", error: err})
			})

			// Safety-net poll: fs.watch can miss events on some platforms/filesystems.
			// A 2s interval ensures eventual consistency without excessive I/O.
			this.pollTimer = setInterval(() => this.readNewBytes(), 2000)

			log().info(LOG_MESSAGE.TAIL_FILE_WATCH_STARTED, {path})
		} catch (err) {
			this.dispatch({type: "watch_error", error: err instanceof Error ? err : new Error(String(err))})
		}
	}

	private async readNewBytes(): Promise<void> {
		if (this.reading) return
		this.reading = true
		try {
			const file = Bun.file(this.options.path)
			const exists = await file.exists()
			if (!exists) {
				this.dispatch({type: "file_deleted"})
				return
			}

			const size = file.size
			if (size < this.offset) {
				log().warn(LOG_MESSAGE.TAIL_FILE_TRUNCATION_DETECTED, {
					path: this.options.path,
					oldOffset: this.offset,
					newSize: size,
				})
				this.offset = 0
				this.carryBuffer = Buffer.alloc(0)
			}

			if (size === this.offset) return

			const slice = file.slice(this.offset, size)
			const newBytes = Buffer.from(await slice.arrayBuffer())

			const combined = this.carryBuffer.length > 0 ? Buffer.concat([this.carryBuffer, newBytes]) : newBytes

			const segments: string[] = []
			let start = 0
			for (let i = 0; i < combined.length; i++) {
				if (combined.at(i) === 0x0a) {
					segments.push(combined.subarray(start, i).toString("utf-8"))
					start = i + 1
				}
			}

			// Remaining bytes after the last newline become the carry buffer
			this.carryBuffer = start < combined.length ? Buffer.from(combined.subarray(start)) : Buffer.alloc(0)

			const bytesRead = size - this.offset
			this.offset = size

			const lines = segments.map((s) => s.replace(/\r/g, "")).filter((s) => s.length > 0)

			log().debug(LOG_MESSAGE.TAIL_FILE_POLL_READ, {
				path: this.options.path,
				bytesRead,
				linesEmitted: lines.length,
			})

			if (lines.length > 0) {
				this.options.onLines(lines)
			}
		} catch (err) {
			this.options.onError(err instanceof Error ? err : new Error(String(err)))
		} finally {
			this.reading = false
		}
	}

	private clearAllTimers(): void {
		log().info(LOG_MESSAGE.TAIL_FILE_WATCH_STOPPED, {path: this.options.path})

		if (this.watcher) {
			this.watcher.close()
			this.watcher = null
		}
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		if (this.waitTimer) {
			clearInterval(this.waitTimer)
			this.waitTimer = null
		}
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
	}
}
