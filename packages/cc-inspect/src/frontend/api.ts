import {useQuery} from "@tanstack/react-query"
import type {
	AgentNode,
	DirectoriesResponse,
	Event,
	SessionData,
	SessionHandle,
	SessionsResponse,
} from "#types"
import {LOG_MESSAGE, LOG_MODULE} from "../lib/event-catalog"
import {createClientLogger} from "../lib/log/client"

const log = createClientLogger(LOG_MODULE.API)

async function fetchApi<T extends {status: string}>(url: string): Promise<T> {
	const res = await fetch(url)
	const data: T = await res.json()
	const record = data as unknown as {status: string; error?: string}
	if (record.status === "error") {
		log.error(LOG_MESSAGE.API_ERROR, {err: record.error ?? "Unknown error", data: {url}})
		throw new Error(record.error ?? "Unknown error")
	}
	return data
}

// JSON serialization converts Date objects to ISO strings.
// Rehydrate them at the data boundary so all consumers get real Date instances.
export function rehydrateEvent(event: Event): Event {
	return {
		...event,
		timestamp: new Date(event.timestamp),
	}
}

export function rehydrateAgent(agent: AgentNode): AgentNode {
	return {
		...agent,
		events: agent.events.map(rehydrateEvent),
		children: agent.children.map(rehydrateAgent),
	}
}

export function rehydrateSessionData(data: SessionData): SessionData {
	return {
		...data,
		mainAgent: rehydrateAgent(data.mainAgent),
		allEvents: data.allEvents.map(rehydrateEvent),
	}
}

export function useDirectories() {
	return useQuery({
		queryKey: ["directories"],
		queryFn: async () => {
			const data = await fetchApi<DirectoriesResponse>("/api/directories")
			if (data.status === "success") return {directories: data.directories, displayNames: data.displayNames}
			throw new Error("Unexpected response")
		},
	})
}

export function useSessions(directory: string) {
	return useQuery<SessionHandle[]>({
		queryKey: ["sessions", directory],
		queryFn: async () => {
			const data = await fetchApi<SessionsResponse>(
				`/api/sessions?directory=${encodeURIComponent(directory)}`,
			)
			if (data.status === "success") return data.sessions
			throw new Error("Unexpected response")
		},
		enabled: !!directory,
	})
}

interface AppConfig {
	sessionPath?: string
}

export function useConfig() {
	return useQuery<AppConfig>({
		queryKey: ["config"],
		queryFn: async () => {
			const res = await fetch("/api/config")
			return res.json()
		},
	})
}
