import {useQuery} from "@tanstack/react-query"
import type {
	AgentNode,
	DirectoriesResponse,
	Event,
	SessionData,
	SessionDataResponse,
	SessionHandle,
	SessionsResponse,
} from "#types"

async function fetchApi<T extends {status: string}>(url: string): Promise<T> {
	const res = await fetch(url)
	const data: T = await res.json()
	const record = data as unknown as {status: string; error?: string}
	if (record.status === "error") {
		throw new Error(record.error ?? "Unknown error")
	}
	return data
}

// JSON serialization converts Date objects to ISO strings.
// Rehydrate them at the data boundary so all consumers get real Date instances.
function rehydrateEvent(event: Event): Event {
	return {
		...event,
		timestamp: new Date(event.timestamp),
	}
}

function rehydrateAgent(agent: AgentNode): AgentNode {
	return {
		...agent,
		events: agent.events.map(rehydrateEvent),
		children: agent.children.map(rehydrateAgent),
	}
}

function rehydrateSessionData(data: SessionData): SessionData {
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
			if (data.status === "success") return data.directories
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

export function useSessionData(sessionPath: string) {
	return useQuery<SessionData>({
		queryKey: ["session", sessionPath],
		queryFn: async () => {
			const data = await fetchApi<SessionDataResponse>(`/api/session?path=${encodeURIComponent(sessionPath)}`)
			if (data.status === "success") return rehydrateSessionData(data.data)
			throw new Error("Unexpected response")
		},
		enabled: !!sessionPath,
	})
}

export function useCliSession() {
	return useQuery<SessionData | null>({
		queryKey: ["cli-session"],
		queryFn: async () => {
			try {
				const res = await fetch("/api/session")
				const data: SessionDataResponse = await res.json()
				if (data.status === "success") return rehydrateSessionData(data.data)
				return null
			} catch {
				return null
			}
		},
		retry: false,
	})
}

