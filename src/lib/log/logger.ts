import {type LogComponent, type LogEntry, type LogLevel, LOG_LEVEL_ORDER} from "./types"

export interface Logger {
	debug(msg: string, data?: Record<string, unknown>): void
	info(msg: string, data?: Record<string, unknown>): void
	warn(msg: string, data?: Record<string, unknown>): void
	error(msg: string, extra?: {err?: string; stack?: string; data?: Record<string, unknown>}): void
	timed<T>(msg: string, fn: () => T | Promise<T>, data?: Record<string, unknown>): Promise<T>
}

export function createLogger(config: {
	component: LogComponent
	mod: string
	write: (entry: LogEntry) => void
	minLevel?: LogLevel
}): Logger {
	const {component, mod, write, minLevel = "info"} = config
	const minOrd = LOG_LEVEL_ORDER[minLevel]

	function emit(level: LogLevel, msg: string, extra?: Partial<LogEntry>): void {
		if (LOG_LEVEL_ORDER[level] < minOrd) return
		write({
			ts: new Date().toISOString(),
			level,
			component,
			mod,
			msg,
			...extra,
		})
	}

	return {
		debug(msg, data) {
			emit("debug", msg, data ? {data} : undefined)
		},
		info(msg, data) {
			emit("info", msg, data ? {data} : undefined)
		},
		warn(msg, data) {
			emit("warn", msg, data ? {data} : undefined)
		},
		error(msg, extra) {
			emit("error", msg, extra)
		},
		async timed<T>(msg: string, fn: () => T | Promise<T>, data?: Record<string, unknown>): Promise<T> {
			const start = performance.now()
			const result = await fn()
			const dur_ms = Math.round(performance.now() - start)
			emit("info", msg, {dur_ms, ...(data ? {data} : {})})
			return result
		},
	}
}
