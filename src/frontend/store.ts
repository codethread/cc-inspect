import {create} from "zustand"
import type {Event} from "#types"

function getUrlParams() {
	const params = new URLSearchParams(window.location.search)
	return {
		directory: params.get("directory") || "",
		sessionPath: params.get("session") || "",
	}
}

function syncUrlParams(directory: string, sessionPath: string) {
	const params = new URLSearchParams()
	if (directory) params.set("directory", directory)
	if (sessionPath) params.set("session", sessionPath)

	const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`
	window.history.replaceState({}, "", newUrl)
}

interface AppState {
	selectedDirectory: string
	selectedSession: string
	selectedEvent: Event | null
	selectDirectory: (dir: string) => void
	selectSession: (path: string) => void
	selectEvent: (event: Event | null) => void
}

const initialUrl = getUrlParams()

export const useAppStore = create<AppState>((set) => ({
	selectedDirectory: initialUrl.directory,
	selectedSession: initialUrl.sessionPath,
	selectedEvent: null,
	selectDirectory: (dir) =>
		set(() => {
			syncUrlParams(dir, "")
			return {selectedDirectory: dir, selectedSession: "", selectedEvent: null}
		}),
	selectSession: (path) =>
		set((state) => {
			syncUrlParams(state.selectedDirectory, path)
			return {selectedSession: path, selectedEvent: null}
		}),
	selectEvent: (event) => set({selectedEvent: event}),
}))
