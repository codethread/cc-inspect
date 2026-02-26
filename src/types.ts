// App-level types: re-exports SDK types + API response schemas

import {z} from "zod"
import {AgentNodeSchema, EventSchema, SessionDataSchema, SessionHandleSchema} from "./lib/claude/types"

// Re-export all SDK types so #types alias continues to work for frontend
export * from "./lib/claude"

// App-level API response types (server <-> frontend contract)

export const DirectoriesResponseSchema = z.discriminatedUnion("status", [
	z.object({status: z.literal("success"), directories: z.array(z.string())}),
	z.object({status: z.literal("error"), error: z.string()}),
])

export const SessionsResponseSchema = z.discriminatedUnion("status", [
	z.object({status: z.literal("success"), sessions: z.array(SessionHandleSchema)}),
	z.object({status: z.literal("error"), error: z.string()}),
])

export const SessionDataResponseSchema = z.discriminatedUnion("status", [
	z.object({status: z.literal("success"), data: SessionDataSchema}),
	z.object({status: z.literal("error"), error: z.string()}),
])

export type DirectoriesResponse = z.infer<typeof DirectoriesResponseSchema>
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>
export type SessionDataResponse = z.infer<typeof SessionDataResponseSchema>

// WebSocket tail protocol types

export const TailClientMessageSchema = z.union([
	z.object({path: z.string()}),
	z.object({path: z.string(), resumeAfterSeq: z.number()}),
])

export type TailClientMessage = z.infer<typeof TailClientMessageSchema>

export const TailSnapshotMessageSchema = z.object({
	type: z.literal("snapshot"),
	data: SessionDataSchema,
	seq: z.number(),
})

export const TailEventsMessageSchema = z.object({
	type: z.literal("events"),
	events: z.array(EventSchema),
	agents: z.array(AgentNodeSchema),
	seq: z.number(),
})

export const TailWarningMessageSchema = z.object({
	type: z.literal("warning"),
	message: z.string(),
	seq: z.number(),
})

export const TailErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
	seq: z.number(),
})

export const TailHeartbeatMessageSchema = z.object({
	type: z.literal("heartbeat"),
	seq: z.number(),
})

export const TailIdleMessageSchema = z.object({
	type: z.literal("idle"),
	seq: z.number(),
})

export const TailActiveMessageSchema = z.object({
	type: z.literal("active"),
	seq: z.number(),
})

export const TailServerMessageSchema = z.discriminatedUnion("type", [
	TailSnapshotMessageSchema,
	TailEventsMessageSchema,
	TailWarningMessageSchema,
	TailErrorMessageSchema,
	TailHeartbeatMessageSchema,
	TailIdleMessageSchema,
	TailActiveMessageSchema,
])

export type TailSnapshotMessage = z.infer<typeof TailSnapshotMessageSchema>
export type TailEventsMessage = z.infer<typeof TailEventsMessageSchema>
export type TailWarningMessage = z.infer<typeof TailWarningMessageSchema>
export type TailErrorMessage = z.infer<typeof TailErrorMessageSchema>
export type TailHeartbeatMessage = z.infer<typeof TailHeartbeatMessageSchema>
export type TailIdleMessage = z.infer<typeof TailIdleMessageSchema>
export type TailActiveMessage = z.infer<typeof TailActiveMessageSchema>
export type TailServerMessage = z.infer<typeof TailServerMessageSchema>
