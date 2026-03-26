import type {LogLevel} from "./types"
import type {Logger} from "./logger"
import {createLogger} from "./logger"
import {type LogWriter, createLogWriter} from "./writer"

let writer: LogWriter | null = null
let minLevel: LogLevel = "info"

export function initLogging(logDir: string, level?: LogLevel): {sessionId: string; logFile: string} {
	const sessionId = crypto.randomUUID()
	const now = new Date()
	const ts = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
		"-",
		String(now.getHours()).padStart(2, "0"),
		String(now.getMinutes()).padStart(2, "0"),
		String(now.getSeconds()).padStart(2, "0"),
	].join("")
	const logFile = `${logDir}/${ts}-${sessionId}.jsonl`

	if (level) minLevel = level
	writer = createLogWriter(logFile)

	return {sessionId, logFile}
}

export function getServerLogger(mod: string): Logger {
	if (!writer) {
		throw new Error("Logging not initialized — call initLogging() before getServerLogger()")
	}
	const w = writer
	return createLogger({
		component: "server",
		mod,
		write: (entry) => w.write(entry),
		minLevel,
	})
}

export function getLogWriter(): LogWriter {
	if (!writer) {
		throw new Error("Logging not initialized — call initLogging() before getLogWriter()")
	}
	return writer
}

export function flushAll(): Promise<void> {
	if (!writer) return Promise.resolve()
	return writer.flush()
}
