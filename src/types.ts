// App-level types that extend the Claude SDK

import {z} from "zod"
import {SessionDataSchema} from "./lib/claude/types"

// Re-export all SDK types
export * from "./lib/claude"

// Serialized session for API responses (Date -> string for JSON)
export const SerializedSessionHandleSchema = z.object({
	filename: z.string(),
	path: z.string(),
	sessionId: z.string(),
	modifiedAt: z.string(), // ISO string when serialized
	size: z.number(),
})

// API Response Types (Discriminated Unions)
export const DirectoriesResponseSchema = z.discriminatedUnion("status", [
	z.object({status: z.literal("success"), directories: z.array(z.string())}),
	z.object({status: z.literal("error"), error: z.string()}),
])

export const SessionsResponseSchema = z.discriminatedUnion("status", [
	z.object({status: z.literal("success"), sessions: z.array(SerializedSessionHandleSchema)}),
	z.object({status: z.literal("error"), error: z.string()}),
])

export const SessionDataResponseSchema = z.discriminatedUnion("status", [
	z.object({status: z.literal("success"), data: SessionDataSchema}),
	z.object({status: z.literal("error"), error: z.string()}),
])

// TypeScript types inferred from schemas
export type SerializedSessionHandle = z.infer<typeof SerializedSessionHandleSchema>
export type DirectoriesResponse = z.infer<typeof DirectoriesResponseSchema>
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>
export type SessionDataResponse = z.infer<typeof SessionDataResponseSchema>
