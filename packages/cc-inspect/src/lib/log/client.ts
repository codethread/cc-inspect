import {type LogEntry, type LogLevel, LOG_LEVEL_ORDER} from "./types"

let ws: WebSocket | null = null
let buffer: LogEntry[] = []
let connecting = false
const minLevel: LogLevel = "info"

function getWsUrl(): string {
	const proto = location.protocol === "https:" ? "wss:" : "ws:"
	return `${proto}//${location.host}/ws/log`
}

function connect(): void {
	if (ws || connecting) return
	connecting = true

	try {
		const socket = new WebSocket(getWsUrl())

		socket.onopen = () => {
			ws = socket
			connecting = false
			if (buffer.length > 0) {
				socket.send(JSON.stringify(buffer))
				buffer = []
			}
		}

		socket.onclose = () => {
			ws = null
			connecting = false
		}

		socket.onerror = () => {
			ws = null
			connecting = false
		}
	} catch {
		connecting = false
	}
}

function send(entry: LogEntry): void {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(entry))
	} else {
		buffer.push(entry)
		connect()
	}
}

function emit(opts: {level: LogLevel; mod: string; msg: string; extra?: Partial<LogEntry>}): void {
	if (LOG_LEVEL_ORDER[opts.level] < LOG_LEVEL_ORDER[minLevel]) return
	send({
		ts: new Date().toISOString(),
		level: opts.level,
		component: "web",
		mod: opts.mod,
		msg: opts.msg,
		...opts.extra,
	})
}

// Flush buffered entries via sendBeacon on page hide
if (typeof document !== "undefined") {
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden" && buffer.length > 0) {
			try {
				navigator.sendBeacon("/api/log", JSON.stringify(buffer))
				buffer = []
			} catch {
				// silently drop
			}
		}
	})
}

export function createClientLogger(mod: string): {
	debug(msg: string, data?: Record<string, unknown>): void
	info(msg: string, data?: Record<string, unknown>): void
	warn(msg: string, data?: Record<string, unknown>): void
	error(msg: string, extra?: {err?: string; stack?: string; data?: Record<string, unknown>}): void
} {
	return {
		debug(msg, data) {
			emit({level: "debug", mod, msg, extra: data ? {data} : undefined})
		},
		info(msg, data) {
			emit({level: "info", mod, msg, extra: data ? {data} : undefined})
		},
		warn(msg, data) {
			emit({level: "warn", mod, msg, extra: data ? {data} : undefined})
		},
		error(msg, extra) {
			emit({level: "error", mod, msg, extra})
		},
	}
}
