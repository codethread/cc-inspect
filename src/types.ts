// App-level types: re-exports SDK types + API response schemas

import {z} from "zod"
import {SessionDataSchema, SessionHandleSchema} from "./lib/claude/types"

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
