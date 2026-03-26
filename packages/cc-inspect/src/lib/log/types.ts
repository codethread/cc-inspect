import {z} from "zod"

export const LogLevel = z.enum(["debug", "info", "warn", "error"])
export type LogLevel = z.infer<typeof LogLevel>

export const LogComponent = z.enum(["server", "web"])
export type LogComponent = z.infer<typeof LogComponent>

export const LogEntrySchema = z.object({
	ts: z.string(),
	level: LogLevel,
	component: LogComponent,
	mod: z.string(),
	msg: z.string(),
	dur_ms: z.number().optional(),
	err: z.string().optional(),
	stack: z.string().optional(),
	data: z.record(z.string(), z.unknown()).optional(),
})
export type LogEntry = z.infer<typeof LogEntrySchema>

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}
