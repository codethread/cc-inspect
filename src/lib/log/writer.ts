import type {LogEntry} from "./types"

export interface LogWriter {
	write(entry: LogEntry): void
	flush(): Promise<void>
}

export function createLogWriter(filePath: string): LogWriter {
	const file = Bun.file(filePath)
	const writer = file.writer()

	return {
		write(entry: LogEntry): void {
			writer.write(`${JSON.stringify(entry)}\n`)
		},
		async flush(): Promise<void> {
			await writer.flush()
		},
	}
}
