import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query"
import type {
	DirectoriesResponse,
	SerializedSessionHandle,
	SessionData,
	SessionDataResponse,
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
	return useQuery<SerializedSessionHandle[]>({
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
			if (data.status === "success") return data.data
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
				if (data.status === "success") return data.data
				return null
			} catch {
				return null
			}
		},
		retry: false,
	})
}

export function useDeleteSession() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async (sessionPath: string) => {
			const res = await fetch(`/api/session/delete?path=${encodeURIComponent(sessionPath)}`, {
				method: "DELETE",
			})
			const data = await res.json()
			if (data.status === "error") {
				throw new Error(data.error || "Failed to delete session")
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({queryKey: ["sessions"]})
		},
	})
}
