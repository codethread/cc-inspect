import {create} from "zustand"

interface SessionState {
	sessionPath: string
	setSessionPath: (path: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
	sessionPath: (() => {
		const params = new URLSearchParams(window.location.search)
		return params.get("session") ?? ""
	})(),
	setSessionPath: (path) => set({sessionPath: path}),
}))
